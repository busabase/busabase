/**
 * Storage for converted documents (PDF/HTML output), separate from the host's
 * user-file storage.
 *
 * Shared by the converter (uploads), the convert route (re-signs and validates
 * cached outputs) and the output-file route (serves local outputs), so the
 * three always agree on where an output lives.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { IStorage } from "openlib/storage";
import { createStorage } from "openlib/storage";

/**
 * Same-origin route that serves outputs kept in local storage. Hosts mount
 * `createConversionFileRoute()` (`../http/conversion-file-route`) here.
 */
export const CONVERSION_FILE_ROUTE = "/api/convert/pdf-file";
export const STAGED_CONVERSION_SOURCE_PREFIX = "conversions/sources/";
const STAGED_SOURCE_TTL_SECONDS = 300;
const MAX_STAGED_SOURCE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_R2_ERROR_BYTES = 2_048;
const PRIVATE_RESPONSE_STATUSES = new Set([401, 403, 404]);
const SAFE_ERROR_TYPES = new Set(["Error", "TypeError", "AbortError", "TimeoutError"]);
const SAFE_PROVIDER_CODES = new Set([
  "AccessDenied",
  "Unauthorized",
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "NoSuchBucket",
  "NoSuchKey",
  "InvalidArgument",
  "ExpiredToken",
  "RequestTimeout",
  "SlowDown",
  "ServiceUnavailable",
  "InternalError",
  "CredentialsProviderError",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const LOCAL_PREFIX = /^local:(?:\/\/)?/;

type StagingDiagnostic = {
  reason: string;
  status?: number;
  errorType?: string;
  providerCode?: string;
};

class StagingPrivacyError extends Error {
  constructor(readonly diagnostic: StagingDiagnostic) {
    super("Could not confirm staged source storage is private");
  }
}

/** Storage errors can contain signed URLs and credentials, so never log them directly. */
function stagingDiagnostic(error: unknown): StagingDiagnostic {
  if (error instanceof StagingPrivacyError) return error.diagnostic;
  const details = error as {
    name?: unknown;
    code?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  } | null;
  const status = details?.$metadata?.httpStatusCode;
  const providerCode = [details?.name, details?.Code, details?.code].find(
    (value): value is string => typeof value === "string" && SAFE_PROVIDER_CODES.has(value),
  );
  return {
    reason: "operation-failed",
    errorType:
      typeof details?.name === "string" && SAFE_ERROR_TYPES.has(details.name)
        ? details.name
        : "Unknown",
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(providerCode ? { providerCode } : {}),
  };
}

/** The absolute directory of a local storage URL, or null for a remote one. */
function localRootOf(storageUrl: string): string | null {
  if (!LOCAL_PREFIX.test(storageUrl)) return null;
  const rawPath = storageUrl.replace(LOCAL_PREFIX, "").split("?")[0] ?? "";
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

/**
 * The storage URL converted documents go to.
 *
 * Resolution order:
 *   1. PREVIEWFILE_STORAGE_URL — a dedicated storage URL just for conversion output
 *   2. BUDA_DRIVE_URL          — reuse the Buda Drive storage (local or s3://)
 *   3. local://.data/conversions — zero-config local fallback
 *
 * Using a separate instance from the global `storage` singleton (which reads STORAGE_URL)
 * prevents converted PDFs from being uploaded to the main R2/S3 user-attachment bucket,
 * which has no CORS rules and produces expiring presigned URLs the browser cannot fetch.
 *
 * When the resolved storage is local://, the presignedUrl becomes a same-origin
 * CONVERSION_FILE_ROUTE path served by the host — no CORS, no expiry.
 */
export function resolveConversionStorageUrl(): string {
  const storageUrl =
    process.env.PREVIEWFILE_STORAGE_URL ||
    process.env.BUDA_DRIVE_URL ||
    "local://.data/conversions";

  const root = localRootOf(storageUrl);
  if (root === null) return storageUrl;

  // Rewritten with an absolute path: openlib reads a local root from the URL's
  // pathname, so a relative `local://.data/conversions` parses `.data` as a
  // host and writes to `/conversions` — EACCES for a non-root server, and a
  // different directory from the one the output-file route reads.
  const queryAt = storageUrl.indexOf("?");
  const params = new URLSearchParams(queryAt === -1 ? "" : storageUrl.slice(queryAt + 1));
  // The pdf-file base_url makes the returned presignedUrl a same-origin path
  // the browser can fetch without CORS issues.
  if (!params.has("base_url")) params.set("base_url", CONVERSION_FILE_ROUTE);
  return `local://${root}?${params.toString()}`;
}

let _conversionStorage: IStorage | null = null;

/** Get (or lazily create) the storage instance used exclusively for converted documents. */
export function getConversionStorage(): IStorage {
  if (_conversionStorage) return _conversionStorage;
  _conversionStorage = createStorage(resolveConversionStorageUrl());
  return _conversionStorage;
}

/** Reset the conversion storage singleton (useful for testing). */
export function resetConversionStorage(): void {
  _conversionStorage = null;
}

/**
 * The directory local outputs are written under, or null when conversion
 * storage is remote (S3/R2) and outputs are reached through presigned URLs.
 */
export function getLocalConversionRootDir(): string | null {
  return localRootOf(resolveConversionStorageUrl());
}

/**
 * Extract the storage key from an upload URI.
 *
 * LocalStorage.uploadFileToKey() returns uri as `local://<key>` (no host),
 * e.g. `local://conversions/hash.pdf` → key = `conversions/hash.pdf`.
 *
 * S3Storage.uploadFileToKey() returns uri as `s3://<bucket>/<key>`,
 * e.g. `s3://buda/conversions/hash.pdf` → key = `conversions/hash.pdf`.
 */
function storageKeyFromUri(uri: string): string {
  if (uri.startsWith("local://")) {
    // local://<key> — no hostname, the path IS the key
    return uri.slice("local://".length);
  }
  if (uri.includes("://")) {
    // s3://bucket/key or r2://bucket/key — strip protocol + bucket
    return uri.replace(/^[a-z0-9+.-]+:\/\/[^/]+\//, "");
  }
  return uri;
}

/**
 * Get a URL for accessing a converted file.
 * For local storage this returns a same-origin path; for S3/R2 it returns a presigned URL.
 */
export async function getConversionFileUrl(uri: string, expiresIn: number): Promise<string> {
  return getConversionStorage().generatePresignedUrl(storageKeyFromUri(uri), expiresIn);
}

/** Match only the configured R2 API object, never a CDN or an arbitrary S3-compatible host. */
function isConfiguredR2ObjectUrl(candidate: URL, key: string): boolean {
  const configured = new URL(resolveConversionStorageUrl());
  if (
    !["s3:", "r2:"].includes(configured.protocol) ||
    !/^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(configured.hostname) ||
    configured.searchParams.get("ssl") === "false" ||
    configured.port ||
    candidate.protocol !== "https:" ||
    candidate.port ||
    candidate.username ||
    candidate.password
  ) {
    return false;
  }
  const bucket = configured.pathname.slice(1);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return (
    (candidate.hostname === configured.hostname &&
      candidate.pathname === `/${bucket}/${encodedKey}`) ||
    (candidate.hostname === `${bucket}.${configured.hostname}` &&
      candidate.pathname === `/${encodedKey}`)
  );
}

async function hasR2AuthorizationDenial(response: Response): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  try {
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_R2_ERROR_BYTES) {
      throw new StagingPrivacyError({ reason: "probe-body-too-large", status: response.status });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_R2_ERROR_BYTES) {
        throw new StagingPrivacyError({
          reason: "probe-body-too-large",
          status: response.status,
        });
      }
      chunks.push(value);
    }
    const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    // R2's unsigned S3 API reports missing authorization as 400, rather than 403.
    // Require the complete, bounded XML error, not matching text inside arbitrary content.
    return /^\s*(?:<\?xml version=["']1\.0["'](?: encoding=["'](?:UTF-8|utf-8)["'])?\s*\?>\s*)?<Error>\s*<Code>InvalidArgument<\/Code>\s*<Message>Authorization<\/Message>\s*(?:(?:<RequestId>[^<&]*<\/RequestId>|<HostId>[^<&]*<\/HostId>)\s*)*<\/Error>\s*$/.test(
      body,
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function assertAnonymousReadDenied(candidate: string, allowR2Error: boolean): Promise<void> {
  let response: Response | undefined;
  try {
    response = await fetch(candidate, {
      method: "HEAD",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (PRIVATE_RESPONSE_STATUSES.has(response.status)) return;
    if (response.status === 400 && allowR2Error) {
      await response.body?.cancel();
      response = await fetch(candidate, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 400) {
        if (await hasR2AuthorizationDenial(response)) return;
        throw new StagingPrivacyError({ reason: "unrecognized-r2-error", status: 400 });
      }
    }
    throw new StagingPrivacyError({
      reason: response.ok ? "anonymous-access" : "unexpected-probe-response",
      status: response.status,
    });
  } catch (error) {
    if (error instanceof StagingPrivacyError) throw error;
    throw new StagingPrivacyError({
      ...stagingDiagnostic(error),
      reason: "probe-request-failed",
      ...(response ? { status: response.status } : {}),
    });
  } finally {
    await response?.body?.cancel().catch(() => undefined);
  }
}

async function assertStagingIsPrivate(
  store: IStorage,
  key: string,
  signedUrl: string,
  baseUrl: string,
) {
  if (getLocalConversionRootDir() !== null) return;
  const unsigned = new URL(signedUrl, baseUrl);
  if (!unsigned.searchParams.get("X-Amz-Signature")) {
    throw new StagingPrivacyError({ reason: "missing-signature" });
  }
  unsigned.search = "";
  const isR2SignedObject = isConfiguredR2ObjectUrl(unsigned, key);
  const candidates = new Set([
    unsigned.toString(),
    new URL(store.getPublicUrl(key), baseUrl).toString(),
  ]);
  for (const candidate of candidates) {
    await assertAnonymousReadDenied(
      candidate,
      isR2SignedObject && isConfiguredR2ObjectUrl(new URL(candidate), key),
    );
  }
}

/** Short-lived read capability for already authorized bytes; never a user session. */
export async function stageConversionSource(input: {
  content: Buffer;
  mimeType: string;
  baseUrl: string;
  filename?: string;
  ttlSeconds?: number;
}): Promise<{ fetchUrl: string; cleanup: () => Promise<void> }> {
  const store = getConversionStorage();
  const requestedTtl = input.ttlSeconds ?? STAGED_SOURCE_TTL_SECONDS;
  const ttlSeconds =
    Number.isFinite(requestedTtl) && requestedTtl > 0
      ? Math.min(Math.ceil(requestedTtl), MAX_STAGED_SOURCE_TTL_SECONDS)
      : STAGED_SOURCE_TTL_SECONDS;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const extension = /\.[a-z0-9]{1,10}$/i.exec(input.filename ?? "")?.[0]?.toLowerCase() ?? "";
  const key = `${STAGED_CONVERSION_SOURCE_PREFIX}${expiresAt}-${randomUUID()}${extension}`;
  const cleanup = () => store.deleteObject(key);
  let phase: "upload" | "presign" | "privacy-check" = "upload";
  try {
    const { uri } = await store.uploadFileToKey(input.content, key, input.mimeType);
    phase = "presign";
    const url = await getConversionFileUrl(uri, ttlSeconds);
    phase = "privacy-check";
    await assertStagingIsPrivate(store, key, url, input.baseUrl);
    return { fetchUrl: new URL(url, input.baseUrl).toString(), cleanup };
  } catch (error) {
    console.error("[conversion-storage] Could not stage source in private storage", {
      phase,
      ...stagingDiagnostic(error),
    });
    try {
      await cleanup();
    } catch (cleanupError) {
      console.warn("[conversion-storage] Could not remove the staged source", {
        phase: "cleanup",
        ...stagingDiagnostic(cleanupError),
      });
    }
    throw new Error("Could not stage source in private storage");
  }
}

/**
 * The bytes of a converted file, by the `outputUri` the converter returned, or
 * null when it is no longer there. For hosts that serve outputs through their
 * own route instead of handing out storage URLs.
 */
export async function readConversionOutput(uri: string): Promise<Buffer | null> {
  const store = getConversionStorage();
  const key = storageKeyFromUri(uri);
  if (!(await store.objectExists(key))) return null;
  return store.getObject(key);
}
