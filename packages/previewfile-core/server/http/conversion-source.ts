/**
 * The host's half of the convert route: deciding which files may be converted.
 *
 * `createConvertRoute` (./convert-route) owns everything generic — request
 * validation, the cache, the queue, error mapping. The one thing it cannot know
 * is which URLs belong to the host, so it asks `resolveSource` and only ever
 * hands the worker the `fetchUrl` that comes back. A host that returns the
 * caller's URL unchecked turns its server into an open fetch-and-convert proxy
 * (any URL, internal addresses included, comes back as a PDF), so a resolver
 * must only accept files the host itself serves.
 */

import { createHash } from "node:crypto";

/** Size + last-modified of a source file: what tells a changed file from the same one. */
export interface ConversionSourceFingerprint {
  size: number;
  modifiedAt: string;
}

/** A file the host agreed to convert. */
export interface ConversionSource {
  /** Absolute URL the worker downloads the file from. */
  fetchUrl: string;
  /** Stable identity of the file for the cache key: no time-varying signature params. */
  cacheUrl: string;
  /** Null when unknown: the conversion still runs, but bypasses the cache. */
  fingerprint: ConversionSourceFingerprint | null;
  /**
   * `public` when `fetchUrl` is an arbitrary internet address the host does not
   * serve itself: the worker then downloads it with `fetchPublicUrl`, which
   * refuses private and metadata addresses at every hop.
   */
  sourceFetch?: "public";
  /**
   * Prepare an authorized source only on cache miss. The host can stage bytes
   * without persisting a caller's Cookie or Authorization header in a job.
   */
  prepareFetch?: () => Promise<{ fetchUrl: string; cleanup: () => Promise<void> }>;
  /** Anything the host wants back in `presentOutput` (e.g. the session it resolved). */
  context?: unknown;
}

export type ConversionSourceDecision =
  | { ok: true; source: ConversionSource }
  | { ok: false; status: number; error: string };

export interface ConversionSourceRequest {
  /** As the client sent it: an absolute URL, or a path relative to the host. */
  fileUrl: string;
  fileName: string;
  mimeType: string;
  /** The whole JSON body, for host-specific fields (e.g. a share link and its password). */
  body: Record<string, unknown>;
  request: Request;
}

export type ResolveConversionSource = (
  input: ConversionSourceRequest,
) => Promise<ConversionSourceDecision>;

/** The refusal for a URL the host does not serve. */
export const UNSUPPORTED_CONVERSION_SOURCE: ConversionSourceDecision = {
  ok: false,
  status: 403,
  error: "This file cannot be converted from its current location",
};

/**
 * Drop the query string for the cache identity. Signed URLs (AWS S3,
 * Cloudflare R2, HMAC) carry time-varying params such as X-Amz-Date, exp and
 * sig, so keeping them would make every newly minted URL a cache miss even
 * when the file has not changed. The fingerprint still separates changed
 * content at the same path.
 */
export function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeModifiedAt(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return trimmed;
  return new Date(time).toISOString();
}

export function isCompleteSourceFingerprint(value: {
  size?: number | null;
  modifiedAt?: string | null;
}): value is ConversionSourceFingerprint {
  return (
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.modifiedAt === "string" &&
    value.modifiedAt.trim().length > 0
  );
}

/**
 * Fingerprint from an HTTP response's Content-Length plus its version —
 * Last-Modified, or the ETag where there is none (GitHub's raw files send only
 * an ETag) — or null when it carries neither.
 */
export function fingerprintFromHeaders(headers: Headers): ConversionSourceFingerprint | null {
  const rawSize = headers.get("content-length");
  const rawModifiedAt = headers.get("last-modified");
  const etag = headers.get("etag");
  if (!rawSize || (!rawModifiedAt && !etag)) return null;
  const candidate = {
    size: Number.parseInt(rawSize, 10),
    modifiedAt: rawModifiedAt ? normalizeModifiedAt(rawModifiedAt) : `etag:${etag}`,
  };
  return isCompleteSourceFingerprint(candidate) ? candidate : null;
}

/** What a storage adapter reports about an object (openlib's `getObjectMetadata`). */
export interface StoredObjectMetadata {
  size: number;
  lastModified: Date;
}

/**
 * The storage key a public or presigned URL path points at, or null when it
 * cannot be one. URL parsing has already resolved literal and `%2e` dot
 * segments, but an encoded slash (`..%2F`) only becomes `../` once decoded.
 */
export function storageKeyFromUrlPath(encodedPath: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  const relative = key.includes("\\") || key.split("/").some((s) => s === "." || s === "..");
  return key && !relative ? key : null;
}

const PROBE_KEY = "__previewfile_probe__";

/**
 * The storage key `url` addresses, judged by how the host's storage builds URLs
 * for its keys (`getPublicUrl`, a presigned URL, …), or null when `url` is not
 * one of them. Relative storage URLs (a same-origin dev proxy) resolve
 * against `base`.
 */
export async function storageKeyFromUrl(
  url: URL,
  urlForKey: (key: string) => string | Promise<string>,
  base: string,
): Promise<string | null> {
  const probe = await urlForKey(PROBE_KEY);
  const at = probe.indexOf(PROBE_KEY);
  if (at < 0) return null;
  const prefix = new URL(probe.slice(0, at), base);
  const prefixLocation = `${prefix.origin}${prefix.pathname}`;
  const location = `${url.origin}${url.pathname}`;
  return location.startsWith(prefixLocation)
    ? storageKeyFromUrlPath(location.slice(prefixLocation.length))
    : null;
}

/**
 * A file in the host's own storage as a conversion source. The fingerprint
 * comes from the storage adapter rather than a HEAD request, so it works on
 * every backend (dev proxies answer HEAD without size or mtime). A key that is
 * not in storage answers 404 instead of queueing a job that cannot download;
 * an adapter that cannot say leaves the conversion uncached.
 */
export async function resolveStoredSource(input: {
  key: string;
  fetchUrl: string;
  cacheUrl: string;
  getObjectMetadata: (key: string) => Promise<StoredObjectMetadata | null>;
}): Promise<ConversionSourceDecision> {
  let metadata: StoredObjectMetadata | null | undefined;
  try {
    metadata = await input.getObjectMetadata(input.key);
  } catch (err) {
    console.warn("[api/convert] Could not read source metadata; converting uncached:", err);
  }
  if (metadata === null) return { ok: false, status: 404, error: "File not found" };

  return {
    ok: true,
    source: {
      fetchUrl: input.fetchUrl,
      cacheUrl: input.cacheUrl,
      fingerprint: metadata
        ? { size: metadata.size, modifiedAt: metadata.lastModified.toISOString() }
        : null,
    },
  };
}

export interface ConversionCacheIdentity {
  /** Host-chosen namespace, bumped to invalidate every entry at once. */
  version: string;
  normalizedFileUrl: string;
  fileName: string;
  outputFormat: "pdf" | "html";
  source: ConversionSourceFingerprint;
}

export function generateConversionCacheKey(input: ConversionCacheIdentity): string {
  const data = JSON.stringify({
    version: input.version,
    normalizedFileUrl: input.normalizedFileUrl,
    fileName: input.fileName,
    outputFormat: input.outputFormat,
    sourceSize: input.source.size,
    sourceModifiedAt: input.source.modifiedAt,
  });
  return createHash("sha256").update(data).digest("hex");
}
