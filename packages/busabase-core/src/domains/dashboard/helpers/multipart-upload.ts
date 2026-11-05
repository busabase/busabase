import type {
  CreateMultipartUploadVO,
  SignMultipartPartsDTO,
  SignMultipartPartsVO,
} from "open-domains/attachments/types";
import { MULTIPART_MAX_SIGN_BATCH } from "open-domains/attachments/utils";

/**
 * Browser-side multipart upload: PUT every part of a large file to the URLs the
 * server signs, with bounded concurrency, per-part retry and one aggregated
 * progress number. Transport-only — creating, completing and aborting the
 * upload stay with the caller (`completeAttachmentUpload`), so the server's
 * checks run exactly once on each side of the byte transfer.
 *
 * Memory: each in-flight part is a `Blob.slice()` of the original `File` —
 * a lazy view, never a copy — so at most `concurrency` parts are read at once.
 */

export interface PutPartRequest {
  url: string;
  body: Blob;
  signal?: AbortSignal;
  onProgress: (loadedBytes: number) => void;
}

/**
 * PUT one part; resolve when the store accepted it. No ETag is read: the
 * server lists the stored parts itself at completion, so this works even when
 * the bucket's CORS does not expose the `ETag` header.
 */
export type PutPart = (request: PutPartRequest) => Promise<void>;

export interface UploadMultipartPartsOptions {
  file: Blob;
  upload: Pick<CreateMultipartUploadVO, "storageKey" | "uploadId" | "partSize" | "partCount">;
  spaceId?: string;
  signParts: (input: SignMultipartPartsDTO) => Promise<SignMultipartPartsVO>;
  signal?: AbortSignal;
  /** Overall progress 0–100 across all parts. */
  onProgress?: (percent: number) => void;
  /** Parallel part uploads. @default 4 */
  concurrency?: number;
  /** Attempts per part (first try included). @default 3 */
  maxAttempts?: number;
  /** Backoff before retry `attempt` (1-based). @default 1s, 2s, 4s… capped at 8s */
  retryDelayMs?: (attempt: number) => number;
  putPart?: PutPart;
  sleep?: (ms: number) => Promise<void>;
}

export const MULTIPART_UPLOAD_CONCURRENCY = 4;
export const MULTIPART_UPLOAD_MAX_ATTEMPTS = 3;

/** Thrown for a cancelled upload; same shape as `createFileUploadAbortError`. */
const abortError = (): Error => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Upload cancelled", "AbortError");
  }
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const defaultRetryDelay = (attempt: number) => Math.min(8_000, 1_000 * 2 ** (attempt - 1));

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** XHR rather than `fetch`: only XHR reports upload progress. */
export const xhrPutPart: PutPart = ({ url, body, signal, onProgress }) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });
    request.addEventListener("load", () => {
      cleanup();
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Upload failed (${request.status})`));
        return;
      }
      onProgress(body.size);
      resolve();
    });
    request.addEventListener("error", () => {
      cleanup();
      reject(new Error("Upload failed (network error)"));
    });
    request.addEventListener("abort", () => {
      cleanup();
      reject(abortError());
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
    request.open("PUT", url);
    request.send(body);
  });

export async function uploadMultipartParts({
  file,
  upload,
  spaceId,
  signParts,
  signal,
  onProgress,
  concurrency = MULTIPART_UPLOAD_CONCURRENCY,
  maxAttempts = MULTIPART_UPLOAD_MAX_ATTEMPTS,
  retryDelayMs = defaultRetryDelay,
  putPart = xhrPutPart,
  sleep = defaultSleep,
}: UploadMultipartPartsOptions): Promise<void> {
  const { partSize, partCount } = upload;
  if (partCount < 1 || partSize < 1) throw new Error("Invalid multipart upload plan");

  const loaded = new Array<number>(partCount).fill(0);
  let lastPercent = -1;
  const report = () => {
    const total = loaded.reduce((sum, bytes) => sum + bytes, 0);
    const percent = file.size > 0 ? Math.min(100, Math.floor((total / file.size) * 100)) : 100;
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress?.(percent);
    }
  };

  // Part URLs are signed lazily, a batch at a time, so a slow multi-gigabyte
  // upload never PUTs to a URL that expired while earlier parts were in flight.
  const urls = new Map<number, Promise<string>>();
  const requestBatch = (fromPart: number) => {
    const partNumbers: number[] = [];
    for (
      let partNumber = fromPart;
      partNumber <= partCount && partNumbers.length < MULTIPART_MAX_SIGN_BATCH;
      partNumber++
    ) {
      if (!urls.has(partNumber)) partNumbers.push(partNumber);
    }
    const batch = signParts({
      storageKey: upload.storageKey,
      uploadId: upload.uploadId,
      partNumbers,
      ...(spaceId ? { spaceId } : {}),
    });
    for (const partNumber of partNumbers) {
      const url = batch.then((signed) => {
        const match = signed.parts.find((part) => part.partNumber === partNumber);
        if (!match) throw new Error(`Missing upload URL for part ${partNumber}`);
        return match.uploadUrl;
      });
      // Avoid an unhandled rejection for parts whose worker never awaits it.
      url.catch(() => {});
      urls.set(partNumber, url);
    }
  };
  const urlFor = (partNumber: number, fresh: boolean): Promise<string> => {
    if (fresh) urls.delete(partNumber);
    if (!urls.has(partNumber)) {
      if (fresh) {
        const url = signParts({
          storageKey: upload.storageKey,
          uploadId: upload.uploadId,
          partNumbers: [partNumber],
          ...(spaceId ? { spaceId } : {}),
        }).then((signed) => {
          const match = signed.parts[0];
          if (!match) throw new Error(`Missing upload URL for part ${partNumber}`);
          return match.uploadUrl;
        });
        urls.set(partNumber, url);
      } else {
        requestBatch(partNumber);
      }
    }
    return urls.get(partNumber) as Promise<string>;
  };

  let next = 1;
  let firstError: unknown = null;
  // One failed part (after its retries) stops the others mid-flight instead of
  // letting them finish bytes that are about to be thrown away.
  const internal = new AbortController();
  const onOuterAbort = () => internal.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  const partSignal = internal.signal;

  const uploadPart = async (partNumber: number) => {
    const start = (partNumber - 1) * partSize;
    const body = file.slice(start, Math.min(start + partSize, file.size));
    for (let attempt = 1; ; attempt++) {
      if (partSignal.aborted) throw abortError();
      try {
        // A retry re-signs: the previous URL may be the reason it failed.
        const url = await urlFor(partNumber, attempt > 1);
        await putPart({
          url,
          body,
          signal: partSignal,
          onProgress: (bytes) => {
            loaded[partNumber - 1] = Math.min(bytes, body.size);
            report();
          },
        });
        loaded[partNumber - 1] = body.size;
        report();
        return;
      } catch (error) {
        loaded[partNumber - 1] = 0;
        report();
        if (isAbortError(error) || partSignal.aborted) throw abortError();
        if (attempt >= maxAttempts) throw error;
        await sleep(retryDelayMs(attempt));
      }
    }
  };

  const worker = async () => {
    while (firstError === null && next <= partCount) {
      const partNumber = next++;
      try {
        await uploadPart(partNumber);
      } catch (error) {
        if (firstError === null) firstError = error;
        internal.abort();
        return;
      }
    }
  };

  try {
    report();
    await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, () => worker()));
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
  }
  if (signal?.aborted) throw abortError();
  if (firstError !== null) throw firstError;
}
