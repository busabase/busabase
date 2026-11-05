/**
 * Attachment size limits + multipart sizing — PURE and isomorphic.
 *
 * The browser imports this (to reject an oversized file before uploading, to
 * pick single-PUT vs multipart, and to read a structured "file too large"
 * error), and the server imports it (the authoritative checks in
 * `../logic/upload-logic.ts`). It must therefore never import node-only APIs,
 * React, db or storage code — zod-free on purpose, so it costs nothing in a
 * client bundle.
 */

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

/**
 * Absolute per-file ceiling for every attachment upload (5 GB) — the size a
 * single S3/R2 object PUT accepts, and what self-hosted Busabase allows by
 * default. Hosts may tighten it per request (Busabase Cloud does, per plan, in
 * its upload policy); nothing may loosen it.
 */
export const ATTACHMENT_MAX_FILE_SIZE = 5 * GB;

/**
 * Files strictly larger than this are uploaded with multipart. Kept below the
 * smallest request-body cap of any host relay (self-hosted Busabase proxies
 * local-storage uploads with `proxyClientMaxBodySize: "100mb"`), so a
 * single-request upload never trips it.
 */
export const MULTIPART_UPLOAD_THRESHOLD = 64 * MB;

/**
 * Default multipart part size. Well above S3's 5 MB minimum, well below every
 * host relay's body cap, and gives 160 parts for a 5 GB file.
 */
export const MULTIPART_DEFAULT_PART_SIZE = 32 * MB;

/** S3: every part except the last must be at least 5 MB. */
export const MULTIPART_MIN_PART_SIZE = 5 * MB;

/** S3/R2: at most 10,000 parts per upload. */
export const MULTIPART_MAX_PARTS = 10_000;

/** Upper bound on part numbers one `signParts` call may request. */
export const MULTIPART_MAX_SIGN_BATCH = 100;

/**
 * Browsers hash a file with `SubtleCrypto.digest`, which needs the WHOLE file in
 * memory and is not streamable. Above this size the client skips the content
 * fingerprint (the upload still works; it just isn't deduplicated) rather than
 * pinning gigabytes of RAM and the main thread.
 */
export const CONTENT_HASH_MAX_BYTES = MULTIPART_UPLOAD_THRESHOLD;

/**
 * Part size the server hands out for a multipart upload of `sizeBytes`.
 *
 * Uniform for every part but the last — R2 rejects a multipart object whose
 * non-final parts differ in size. Grows past the default only when the default
 * would need more than 10,000 parts (never for files ≤ the 5 GB ceiling).
 */
export function computeMultipartPartSize(sizeBytes: number): number {
  const minimumForPartCount = Math.ceil(sizeBytes / MULTIPART_MAX_PARTS);
  // Round up to a whole MB so every non-final part has the same tidy size.
  const rounded = Math.ceil(minimumForPartCount / MB) * MB;
  return Math.max(MULTIPART_DEFAULT_PART_SIZE, MULTIPART_MIN_PART_SIZE, rounded);
}

/** Number of parts `sizeBytes` splits into at `partSize` (at least one). */
export function countMultipartParts(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

/** Should a file of this size use the multipart path? */
export function shouldUseMultipartUpload(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_UPLOAD_THRESHOLD;
}

/**
 * The tightest of several optional per-file limits (bytes). `undefined` and
 * non-positive values mean "no opinion"; the absolute ceiling always applies.
 * A per-field `maxFileSize` can therefore only tighten a host/plan limit, never
 * loosen it.
 */
export function resolveEffectiveMaxFileSize(...limits: Array<number | null | undefined>): number {
  let effective = ATTACHMENT_MAX_FILE_SIZE;
  for (const limit of limits) {
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      effective = Math.min(effective, limit);
    }
  }
  return effective;
}

/**
 * Human-readable byte size ("10 MB", "5 GB", "1.5 GB", "512 KB"). Binary units
 * (1 MB = 1024 KB), matching how every limit in this file is defined.
 */
export function formatFileSize(bytes: number): string {
  const units: Array<[number, string]> = [
    [GB, "GB"],
    [MB, "MB"],
    [KB, "KB"],
  ];
  for (const [unit, label] of units) {
    if (bytes >= unit) {
      const value = bytes / unit;
      const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
      return `${rounded} ${label}`;
    }
  }
  return `${Math.max(0, Math.round(bytes))} B`;
}

// ── Structured "file too large" error ───────────────────────────────────────

export const FILE_TOO_LARGE_ERROR_CODE = "FILE_TOO_LARGE";

/**
 * The `data` of a rejected-for-size upload error. Hosts and clients branch on
 * `code`, never on the message text.
 */
export interface FileTooLargeErrorData {
  code: typeof FILE_TOO_LARGE_ERROR_CODE;
  /** The per-file limit (bytes) that rejected the file. */
  limit: number;
  /** Size of the rejected file, when known. */
  sizeBytes?: number;
  fileName?: string;
  /**
   * A larger per-file limit the host can unlock (e.g. by upgrading a plan).
   * Absent when there is nothing to unlock — self-hosted, or already at the
   * highest tier.
   */
  upgradeLimit?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Read `FileTooLargeErrorData` off any thrown value: an `ORPCError` that
 * crossed the wire (its `data`), or the client-side error from
 * {@link createFileTooLargeClientError}. `null` for anything else.
 */
export function getFileTooLargeErrorData(error: unknown): FileTooLargeErrorData | null {
  if (!isRecord(error)) return null;
  const data = error.data;
  if (!isRecord(data) || data.code !== FILE_TOO_LARGE_ERROR_CODE) return null;
  if (typeof data.limit !== "number") return null;
  return {
    code: FILE_TOO_LARGE_ERROR_CODE,
    limit: data.limit,
    ...(typeof data.sizeBytes === "number" ? { sizeBytes: data.sizeBytes } : {}),
    ...(typeof data.fileName === "string" ? { fileName: data.fileName } : {}),
    ...(typeof data.upgradeLimit === "number" ? { upgradeLimit: data.upgradeLimit } : {}),
  };
}

/** English fallback message shared by the server error and the client pre-check. */
export function fileTooLargeMessage(limit: number): string {
  return `File size exceeds the maximum allowed size of ${formatFileSize(limit)}`;
}

/**
 * The error a client throws when it rejects a file before uploading it. Same
 * `data` shape as the server's, so one presenter handles both.
 */
export function createFileTooLargeClientError(
  data: Omit<FileTooLargeErrorData, "code">,
): Error & { data: FileTooLargeErrorData } {
  const error = new Error(fileTooLargeMessage(data.limit)) as Error & {
    data: FileTooLargeErrorData;
  };
  error.name = "FileTooLargeError";
  error.data = { code: FILE_TOO_LARGE_ERROR_CODE, ...data };
  return error;
}
