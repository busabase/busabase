import "server-only";

import type { AssetContentLocation } from "./asset-content-logic";
import { readObjectInChunks } from "./object-stream";

const asciiFilename = (name: string): string =>
  name
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\\r\n]/g, "_")
    .trim() || "file";

const encodeRfc5987Value = (value: string): string =>
  encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

export const buildAssetDownloadDisposition = (fileName: string): string => {
  const safeName = fileName.replace(/[\r\n]/g, "_").trim() || "file";
  return (
    `attachment; filename="${asciiFilename(safeName)}"; ` +
    `filename*=UTF-8''${encodeRfc5987Value(safeName)}`
  );
};

export const streamAssetObject = (
  storageKey: string,
  readChunks: typeof readObjectInChunks = readObjectInChunks,
): ReadableStream<Uint8Array> => {
  const iterator = readChunks(storageKey)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        try {
          await iterator.return?.();
        } catch {
          // Preserve the read failure as the stream's error.
        }
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
};

/** Build a same-origin, ACL-gated download response without buffering the file. */
export const createAssetDownloadResponse = (
  content: AssetContentLocation,
  requestedFileName?: string | null,
  readChunks: typeof readObjectInChunks = readObjectInChunks,
): Response =>
  new Response(streamAssetObject(content.storageKey, readChunks), {
    status: 200,
    headers: {
      "Content-Type": content.mimeType || "application/octet-stream",
      "Content-Disposition": buildAssetDownloadDisposition(
        requestedFileName?.trim() || content.fileName,
      ),
      "Content-Length": String(content.sizeBytes),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
