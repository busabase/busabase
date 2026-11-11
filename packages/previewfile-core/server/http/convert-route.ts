/**
 * POST /api/convert — convert an Office document to PDF (blocking), as a route
 * handler factory hosts mount in two lines:
 *
 *   export const { POST } = createConvertRoute({ resolveSource, ... });
 *
 * Enqueues a BullMQ job and waits for it. The worker
 * (`startConversionWorker({ queueName })`, started from the host's
 * instrumentation) handles LibreOffice, resource limits, circuit-breaking and
 * uploading the output to conversion storage. Plain `Request`/`Response`, so it
 * carries no Next.js dependency.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { ConversionCache } from "../converter/conversion-cache";
import {
  CONVERSION_FILE_ROUTE,
  getConversionFileUrl,
  getLocalConversionRootDir,
} from "../converter/conversion-storage";
import {
  type ConversionJobData,
  enqueueConversion,
  generateConversionJobId,
  waitForConversionCompletion,
} from "../queue/conversion-queue";
import {
  type ConversionSource,
  generateConversionCacheKey,
  type ResolveConversionSource,
} from "./conversion-source";

export interface ConvertRouteOptions {
  /** Which files this host converts, and where the worker fetches them. See ./conversion-source. */
  resolveSource: ResolveConversionSource;
  /** BullMQ queue; must match the host's `startConversionWorker({ queueName })`. */
  queueName: string;
  /** Redis key prefix for cached outputs, so hosts sharing a Redis never read each other's. */
  cacheKeyPrefix: string;
  /** Cache identity namespace; bump it to invalidate every cached output. */
  cacheVersion: string;
  /** How long the request waits for the worker (default 60s). */
  timeoutMs?: number;
  /**
   * The URL handed back to the client for a converted file — fresh or cached.
   * Default: the storage URL itself. Hosts that serve outputs through their own
   * route (with its own access checks) map the stable `outputUri` to it here.
   */
  presentOutput?: (output: {
    source: ConversionSource;
    outputUri: string;
    outputUrl: string;
    cached: boolean;
  }) => Promise<string>;
}

/**
 * Cached entry format — JSON-encoded and stored as the cache value string.
 * Storing the stable `uri` (s3://bucket/key) alongside the expiring `url`
 * lets us regenerate a fresh presigned URL on cache hit instead of
 * re-converting the whole document when the R2/S3 URL expires.
 */
interface CachedConversionEntry {
  /** Stable storage URI, e.g. s3://previewfile/conversions/<hash>.pdf */
  uri: string;
  /** Last-generated presigned URL (may be expired) */
  url: string;
}

function parseCachedEntry(raw: string): CachedConversionEntry | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.uri === "string" && typeof parsed.url === "string") {
      return parsed as CachedConversionEntry;
    }
  } catch {
    // Legacy plain-URL entries — treat as url-only (no uri for re-signing).
  }
  // Legacy: raw value is just a URL string
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return { uri: "", url: raw };
  }
  return null;
}

/** Regenerate a fresh presigned URL from a stable s3:// URI. */
async function refreshPresignedUrl(uri: string): Promise<string | null> {
  if (!uri) return null;

  // For local storage, no presigning needed — the URL path is stable.
  if (getLocalConversionRootDir() !== null) return null;

  try {
    return await getConversionFileUrl(uri, 3600);
  } catch (err) {
    console.warn("[api/convert] Failed to refresh presigned URL for URI:", uri, err);
    return null;
  }
}

/**
 * Validate that a cached outputUrl is still accessible.
 *
 * - Same-origin paths (CONVERSION_FILE_ROUTE): check the file exists on disk
 *   using the same root-dir resolution as the output-file route.
 * - External presigned URLs (https://...): do a lightweight HEAD request.
 *   A 4xx means the presigned URL expired or the object was deleted.
 *   IMPORTANT: when the URL is expired but we have a stable URI, we
 *   regenerate a fresh presigned URL instead of treating the entry as invalid.
 *   Network errors are treated as valid (don't re-convert on transient issues).
 */
async function validateAndRefreshCachedEntry(
  entry: CachedConversionEntry,
): Promise<{ valid: boolean; freshUrl?: string }> {
  const { url: outputUrl, uri } = entry;

  // Local file path served by the output-file route
  if (outputUrl.startsWith(`${CONVERSION_FILE_ROUTE}/`)) {
    const rootDir = getLocalConversionRootDir();
    // Remote storage — can't check locally, trust the cache
    if (rootDir === null) return { valid: true };

    const key = outputUrl.slice(`${CONVERSION_FILE_ROUTE}/`.length);
    const filePath = path.resolve(rootDir, key);

    // Same bound as the output-file route: inside conversions/, traversal included
    if (!filePath.startsWith(path.resolve(rootDir, "conversions") + path.sep)) {
      return { valid: false };
    }

    try {
      await fs.access(filePath);
      return { valid: true };
    } catch {
      return { valid: false };
    }
  }

  // External presigned URL — HEAD check
  if (outputUrl.startsWith("https://") || outputUrl.startsWith("http://")) {
    try {
      const res = await fetch(outputUrl, { method: "HEAD", cache: "no-store" });
      if (res.ok) return { valid: true };

      // URL returned an error (likely expired presigned URL).
      // If we have a stable URI, try to regenerate a fresh presigned URL
      // instead of invalidating the cache and re-converting.
      if (uri) {
        const freshUrl = await refreshPresignedUrl(uri);
        if (freshUrl) return { valid: true, freshUrl };
      }

      // No URI or refresh failed — treat as invalid
      return { valid: false };
    } catch {
      // Network error — assume valid, don't re-convert
      return { valid: true };
    }
  }

  // Unknown format — trust it
  return { valid: true };
}

interface ConvertRequest {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  outputFormat: "pdf" | "html";
  body: Record<string, unknown>;
}

interface FieldIssue {
  field: string;
  message: string;
}

function parseConvertRequest(
  body: unknown,
): { ok: true; value: ConvertRequest } | { ok: false; issues: FieldIssue[] } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const issues: FieldIssue[] = [];
  const text = (field: string, max: number): string => {
    const value = input[field];
    if (typeof value !== "string" || value.length === 0 || value.length > max) {
      issues.push({ field, message: `Must be a non-empty string of at most ${max} characters` });
      return "";
    }
    return value;
  };

  // Accept both absolute URLs (https://...) and relative internal paths (/api/...)
  const fileUrl = text("fileUrl", 2048);
  if (fileUrl && !fileUrl.startsWith("/") && !URL.canParse(fileUrl)) {
    issues.push({
      field: "fileUrl",
      message: "Must be a valid URL or an internal path starting with /",
    });
  }
  const fileName = text("fileName", 255);
  const mimeType = text("mimeType", 200);
  const outputFormat = input.outputFormat ?? "pdf";
  if (outputFormat !== "pdf" && outputFormat !== "html") {
    issues.push({ field: "outputFormat", message: 'Must be "pdf" or "html"' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      fileUrl,
      fileName,
      mimeType,
      outputFormat: outputFormat as "pdf" | "html",
      body: input,
    },
  };
}

const failure = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ success: false, error, ...extra }, { status });

export function createConvertRoute(options: ConvertRouteOptions): {
  POST: (request: Request) => Promise<Response>;
} {
  const timeoutMs = options.timeoutMs ?? 60_000;
  // One cache per route, configured here rather than through the process-wide
  // `getConversionCache()` singleton, whose config is whatever its first caller
  // passed — so the prefix can never silently fall back to the default.
  let cache: ConversionCache | null = null;
  const getCache = () => {
    cache ??= new ConversionCache({ keyPrefix: options.cacheKeyPrefix });
    return cache;
  };

  const POST = async (request: Request): Promise<Response> => {
    const startTime = Date.now();
    let prepared: Awaited<ReturnType<NonNullable<ConversionSource["prepareFetch"]>>> | undefined;

    try {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return failure(400, "Request body must be JSON");
      }
      const parsed = parseConvertRequest(body);
      if (!parsed.ok) return failure(400, "Validation error", { details: parsed.issues });
      const input = parsed.value;

      const decision = await options.resolveSource({
        fileUrl: input.fileUrl,
        fileName: input.fileName,
        mimeType: input.mimeType,
        body: input.body,
        request,
      });
      if (!decision.ok) return failure(decision.status, decision.error);
      const { source } = decision;
      const { cacheUrl, fetchUrl, fingerprint } = source;
      const present = (outputUri: string, outputUrl: string, cached: boolean) =>
        options.presentOutput
          ? options.presentOutput({ source, outputUri, outputUrl, cached })
          : Promise.resolve(outputUrl);

      const cacheKey = fingerprint
        ? generateConversionCacheKey({
            version: options.cacheVersion,
            normalizedFileUrl: cacheUrl,
            fileName: input.fileName,
            outputFormat: input.outputFormat,
            source: fingerprint,
          })
        : null;

      if (!cacheKey) {
        console.warn("[api/convert] Source metadata unavailable; bypassing conversion cache", {
          fileUrl: cacheUrl,
          fileName: input.fileName,
        });
      } else {
        const cachedRaw = await getCache().get(cacheKey);
        if (cachedRaw) {
          const entry = parseCachedEntry(cachedRaw);
          // A host that maps outputs by URI cannot use a legacy url-only entry.
          if (entry && (entry.uri || !options.presentOutput)) {
            // Validate the cached URL is still reachable before trusting it.
            // If it's an expired presigned URL but we have the stable URI, we
            // regenerate a fresh presigned URL without re-converting the document.
            const { valid, freshUrl } = await validateAndRefreshCachedEntry(entry);
            if (valid) {
              // If we refreshed the URL, update the cache so next hit is fast.
              if (freshUrl) {
                await getCache().set(cacheKey, JSON.stringify({ uri: entry.uri, url: freshUrl }));
              }
              return Response.json({
                success: true,
                cached: true,
                outputUrl: await present(entry.uri, freshUrl ?? entry.url, true),
                processingTime: Date.now() - startTime,
              });
            }
          }
          // Stale — remove so re-conversion runs below
          console.warn("[api/convert] Cached output unavailable, invalidating:", cacheKey);
          await getCache().invalidate(cacheKey);
        }
      }

      // Use the fingerprinted identity for the job ID too, so duplicate in-flight
      // jobs are de-duped for unchanged files but separated after content changes.
      const jobId = cacheKey
        ? generateConversionJobId(cacheKey, input.outputFormat)
        : generateConversionJobId(`${cacheUrl}:${Date.now()}`, input.outputFormat);
      prepared = await source.prepareFetch?.();
      const jobData: ConversionJobData = {
        jobId,
        fileUrl: prepared?.fetchUrl ?? fetchUrl,
        fileName: input.fileName,
        mimeType: input.mimeType,
        outputFormat: input.outputFormat,
        ...(source.sourceFetch ? { sourceFetch: source.sourceFetch } : {}),
      };

      const enqueued = await enqueueConversion(jobData, undefined, options.queueName);
      if (!enqueued) return failure(503, "Conversion service temporarily unavailable");

      const result = await waitForConversionCompletion(enqueued, timeoutMs, options.queueName);
      if (result === null) {
        return failure(504, `Conversion timed out after ${Math.round(timeoutMs / 1000)} seconds`);
      }
      if (!result.success) return failure(500, result.error || "Conversion failed");

      if (result.outputUrl && cacheKey) {
        // Store both the stable URI and the presigned URL so we can regenerate
        // a fresh presigned URL later without re-converting the document.
        const entry: CachedConversionEntry = {
          uri: result.outputUri ?? "",
          url: result.outputUrl,
        };
        await getCache().set(cacheKey, JSON.stringify(entry));
      }

      return Response.json({
        success: true,
        outputUrl:
          result.outputUrl && result.outputUri
            ? await present(result.outputUri, result.outputUrl, false)
            : result.outputUrl,
        processingTime: result.processingTime || Date.now() - startTime,
      });
    } catch (error) {
      console.error("[api/convert] error:", error);
      return failure(500, error instanceof Error ? error.message : "Internal server error");
    } finally {
      if (prepared) {
        try {
          await prepared.cleanup();
        } catch {
          console.warn("[api/convert] Could not remove the staged source");
        }
      }
    }
  };

  return { POST };
}
