import "server-only";

/**
 * Bounded-memory "streaming" read of a storage object via repeated
 * `IStorage.getObjectRange` windows. `IStorage` only exposes `getObject`
 * (whole object) and `getObjectRange` (a Buffer window) — no Node
 * `Readable`/AsyncIterable primitive — so this is how the assets domain reads
 * a large object "in chunks" per the Drive Grep Retrieval spec (`putText`'s
 * single mandatory pass over a presigned upload; the grep cache's
 * write-through download of a remote-storage object) without ever holding
 * the whole object in memory: at most one `chunkSize` window is live at a
 * time. EOF is detected the ordinary Range-read way — a short (or empty)
 * final chunk.
 */
import { storage } from "openlib/storage";

/** 8 MB windows — large enough to amortize per-request overhead, small enough to bound memory. */
export const DEFAULT_STREAM_CHUNK_SIZE = 8 * 1024 * 1024;

export async function* readObjectInChunks(
  key: string,
  chunkSize: number = DEFAULT_STREAM_CHUNK_SIZE,
  startOffset = 0,
): AsyncGenerator<Buffer, void, unknown> {
  let start = startOffset;
  for (;;) {
    const end = start + chunkSize - 1;
    const chunk = await storage.getObjectRange(key, start, end);
    if (chunk.length === 0) {
      return;
    }
    yield chunk;
    if (chunk.length < chunkSize) {
      // Short read — we've reached EOF.
      return;
    }
    start += chunk.length;
  }
}
