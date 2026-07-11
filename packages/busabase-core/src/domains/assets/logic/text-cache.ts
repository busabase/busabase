import "server-only";

/**
 * Drive Grep Retrieval — the local text cache + line-iteration sources used by
 * both `grep` and `readLines`. A disk cache with two modes, deliberately not
 * Redis (see the spec's decision record):
 *
 *  - `local` storage provider: text objects already live on the local
 *    filesystem — streamed directly off that real fs path (never buffered
 *    whole via `storage.getObject`), NO cache directory involved at all.
 *  - Remote providers (S3/R2/MinIO): a size-capped, LRU-evicted cache
 *    directory keyed by the IMMUTABLE `textContentHash` — write-through on
 *    first fetch, evict oldest-accessed when over budget. Correctness relies
 *    on the hash being immutable; never invalidate by anything but eviction.
 */
import fs, { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { getLocalStoragePath, isLocalStorageProvider, storage } from "openlib/storage";
import { DEFAULT_STREAM_CHUNK_SIZE, readObjectInChunks } from "./object-stream";

/** Default cache directory — overridable for tests / deployments that want a stable path. */
export const DEFAULT_CACHE_DIR = path.join(os.tmpdir(), "busabase-grep-cache");
/** Default budget: 2 GB. */
export const DEFAULT_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

const cacheDir = (): string => process.env.BUSABASE_GREP_CACHE_DIR || DEFAULT_CACHE_DIR;
const cacheMaxBytes = (): number => {
  const raw = process.env.BUSABASE_GREP_CACHE_MAX_BYTES;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_MAX_BYTES;
};

const cachePathForHash = (hash: string): string =>
  path.join(cacheDir(), `${hash.replace(/^sha256:/, "")}.txt`);

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/** Evict oldest-accessed (by atime) cache files until under budget. Best-effort. */
export const evictCacheIfOverBudget = async (maxBytes: number = cacheMaxBytes()): Promise<void> => {
  let names: string[];
  try {
    names = await fsp.readdir(cacheDir());
  } catch {
    return;
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(cacheDir(), name);
      try {
        const stat = await fsp.stat(filePath);
        return { filePath, size: stat.size, atimeMs: stat.atimeMs };
      } catch {
        return null;
      }
    }),
  );
  const valid = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  let total = valid.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= maxBytes) return;
  valid.sort((a, b) => a.atimeMs - b.atimeMs);
  for (const entry of valid) {
    if (total <= maxBytes) break;
    await fsp.unlink(entry.filePath).catch(() => {});
    total -= entry.size;
  }
};

const touch = async (filePath: string): Promise<void> => {
  const now = new Date();
  await fsp.utimes(filePath, now, now).catch(() => {});
};

/**
 * In-flight download coalescing: concurrent `readLines`/`grep` requests for
 * the SAME uncached hash (e.g. several agents grepping the same large file at
 * once) would otherwise each independently trigger a full remote download —
 * a "cache stampede". Callers racing on the same hash instead await the one
 * download already underway.
 */
const inFlightDownloads = new Map<string, Promise<string>>();

/**
 * Ensure a remote text object is present in the local disk cache, downloading
 * it (bounded-memory, chunked via `readObjectInChunks`) on a cache miss. Only
 * ever called for remote storage providers — `local` never reaches here.
 */
const ensureCached = async (hash: string, storageKey: string): Promise<string> => {
  const filePath = cachePathForHash(hash);
  if (await fileExists(filePath)) {
    await touch(filePath);
    return filePath;
  }

  const inFlight = inFlightDownloads.get(hash);
  if (inFlight) {
    return inFlight;
  }

  const download = (async (): Promise<string> => {
    await fsp.mkdir(cacheDir(), { recursive: true });
    const tmpPath = `${filePath}.download-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const writeStream = fs.createWriteStream(tmpPath);
    try {
      for await (const chunk of readObjectInChunks(storageKey)) {
        if (!writeStream.write(chunk)) {
          await new Promise<void>((resolve) => writeStream.once("drain", resolve));
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: unknown) => (err ? reject(err) : resolve()));
      });
      await fsp.rename(tmpPath, filePath);
    } catch (error) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw error;
    }
    await evictCacheIfOverBudget();
    return filePath;
  })();
  inFlightDownloads.set(hash, download);
  try {
    return await download;
  } finally {
    inFlightDownloads.delete(hash);
  }
};

const NEWLINE_BYTE = 0x0a;
const CARRIAGE_RETURN = "\r";

const stripTrailingCr = (line: string): string =>
  line.endsWith(CARRIAGE_RETURN) ? line.slice(0, -1) : line;

/** Iterate lines from a local file, starting at `startByteOffset` — a real Node stream (small memory footprint). */
export async function* iterateLinesFromFile(
  filePath: string,
  startByteOffset = 0,
): AsyncGenerator<string> {
  const stream = createReadStream(filePath, startByteOffset > 0 ? { start: startByteOffset } : {});
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      yield line;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export interface AssetTextSource {
  /** Iterate lines starting at the given byte offset (default: from the start). */
  iterateLines(startByteOffset?: number): AsyncGenerator<string>;
}

/**
 * Open a text object for line iteration. `local` storage provider streams
 * directly off the real filesystem path (no cache dir, and — critically —
 * NEVER buffers the whole object in memory, the same bounded-memory guarantee
 * remote providers get from the disk cache); remote providers go through the
 * size-capped local cache (or, lacking a content hash to key on — a rare
 * legacy edge case — fall back to direct chunked reads with no caching).
 */
export const openAssetTextSource = async (row: {
  textStorageKey: string;
  textContentHash: string | null;
}): Promise<AssetTextSource> => {
  if (isLocalStorageProvider()) {
    if (!(await storage.objectExists(row.textStorageKey))) {
      throw new Error(`Object not found: ${row.textStorageKey}`);
    }
    const filePath = getLocalStoragePath(row.textStorageKey);
    return {
      iterateLines: (startByteOffset = 0) => iterateLinesFromFile(filePath, startByteOffset),
    };
  }

  if (!row.textContentHash) {
    // Rare legacy edge case (no content hash to key the cache on) — read
    // directly via bounded `getObjectRange` windows starting at the resolved
    // checkpoint offset, no caching.
    return {
      iterateLines: async function* (startByteOffset = 0) {
        let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
        for await (const chunk of readObjectInChunks(
          row.textStorageKey,
          DEFAULT_STREAM_CHUNK_SIZE,
          startByteOffset,
        )) {
          const combined = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
          let start = 0;
          let newlineIndex = combined.indexOf(NEWLINE_BYTE, start);
          while (newlineIndex !== -1) {
            yield stripTrailingCr(combined.toString("utf8", start, newlineIndex));
            start = newlineIndex + 1;
            newlineIndex = combined.indexOf(NEWLINE_BYTE, start);
          }
          leftover = combined.subarray(start);
        }
        if (leftover.length > 0) {
          yield stripTrailingCr(leftover.toString("utf8"));
        }
      },
    };
  }

  const filePath = await ensureCached(row.textContentHash, row.textStorageKey);
  return {
    iterateLines: (startByteOffset = 0) => iterateLinesFromFile(filePath, startByteOffset),
  };
};
