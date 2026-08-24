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
 *
 * `openMutableTextSource` (below) adds a THIRD caller shape to the same cache
 * directory: objects that have no immutable content hash to key on (Doc
 * bodies — the Doc domain owns no DB tables, so there is no row to hang a
 * hash off) and are therefore validated against a body-free
 * `getObjectMetadata` probe instead. It deliberately lives here rather than in
 * a parallel module under `domains/doc/` so that ONE module owns every
 * invariant of this directory: the filename namespace (a Doc entry must never
 * collide with an asset entry), the single in-flight-download map (so two
 * different callers racing the same object still coalesce), the byte budget,
 * and the LRU. Splitting those across two modules would mean two independent
 * halves of one LRU over one directory, which is a footgun, and would force
 * this module's internals (`cacheDir`, `cacheMaxBytes`, `touch`, `fileExists`,
 * `inFlightDownloads`) to become public API purely to be shared.
 */
import { createHash } from "node:crypto";
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

/**
 * Evict oldest-accessed (by atime) cache files until under budget. Best-effort.
 *
 * `protectPath` is never evicted. Write-through eviction runs immediately
 * after a download renames its entry into place, and that entry's atime can
 * tie with (or, since a just-READ older entry gets its atime bumped, even
 * sort ahead of) existing ones — so without this the download could delete
 * the very file it is about to hand back to its caller, who then fails with
 * ENOENT on a file the cache reported as ready. Keeping one live entry costs
 * at most a transient overshoot of a soft byte budget; the entry becomes
 * evictable again on the next download.
 */
export const evictCacheIfOverBudget = async (
  maxBytes: number = cacheMaxBytes(),
  protectPath?: string,
): Promise<void> => {
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
    if (entry.filePath === protectPath) continue;
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
 * Ensure a remote text object is present at `filePath` in the local disk
 * cache, downloading it (bounded-memory, chunked via `readObjectInChunks`) on
 * a cache miss. Only ever called for remote storage providers — `local` never
 * reaches here.
 *
 * `coalesceKey` identifies the entry in `inFlightDownloads`. It is a separate
 * parameter (rather than `filePath` itself) only because the immutable-hash
 * callers have always coalesced on the bare hash; the two key spaces are
 * disjoint by construction (hashes are hex, mutable entries are prefixed
 * `mut-`), so one map serves both.
 */
const ensureCachedAtPath = async (
  coalesceKey: string,
  filePath: string,
  storageKey: string,
): Promise<string> => {
  if (await fileExists(filePath)) {
    await touch(filePath);
    return filePath;
  }

  const inFlight = inFlightDownloads.get(coalesceKey);
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
    await evictCacheIfOverBudget(cacheMaxBytes(), filePath);
    return filePath;
  })();
  inFlightDownloads.set(coalesceKey, download);
  try {
    return await download;
  } finally {
    inFlightDownloads.delete(coalesceKey);
  }
};

/** Immutable-hash-keyed entry point — the Files/attachment path, unchanged. */
const ensureCached = async (hash: string, storageKey: string): Promise<string> =>
  ensureCachedAtPath(hash, cachePathForHash(hash), storageKey);

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
  /**
   * Concrete on-disk path backing this source, when one exists — the local
   * storage provider's real fs path, or a remote object already pulled into
   * the size-capped disk cache via `ensureCached`. Undefined only for the
   * rare legacy no-content-hash streaming fallback below, which has no
   * on-disk file to point at. Exposed so callers (the optional
   * `rg`-accelerated grep path in `asset-grep-logic.ts`) can hand `rg` a
   * real file instead of re-fetching/re-caching through a separate
   * mechanism.
   */
  filePath?: string;
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
      filePath,
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
    filePath,
    iterateLines: (startByteOffset = 0) => iterateLinesFromFile(filePath, startByteOffset),
  };
};

// ── Mutable (no-content-hash) text objects: Doc bodies ──────────────────────

/**
 * How long a storage object's reported `lastModified` must already be in the
 * past before an entry for it may be written to (and therefore later read
 * from) the cache.
 *
 * WHY THIS EXISTS — the sub-second write hole. `getObjectMetadata` is the only
 * invalidation signal available for an object with no immutable content hash,
 * and S3's `LastModified` has 1-SECOND resolution. Comparing `size` alongside
 * it (both are baked into the cache filename below) closes most of the hole
 * cheaply: two edits landing in the same wall-clock second almost always
 * differ in byte length, and any length change is caught. What `size` does NOT
 * close is two edits in the SAME second producing the SAME byte count (e.g.
 * fixing a typo: `teh` → `the`) — the probe then reports identical metadata
 * for different bytes, and a naive cache would serve the first edit's content
 * forever.
 *
 * The settle window closes that remaining hole: an entry is only persisted
 * once the object's 1-second `lastModified` bucket is believed CLOSED, i.e.
 * no future write can still land in it and produce the same metadata. Reads
 * during the window fall back to a direct (uncached) fetch — the exact
 * behavior this whole module is replacing, so the fallback is never worse
 * than the status quo, it just forgoes the speedup for ~2s after an edit.
 *
 * Why 2s and what it actually buys — verified against a real MinIO, which
 * FLOORS `lastModified` to the second (measured at sub-second write offsets
 * of 150/450/700/950ms: every one reported the floored second, never rounded
 * up). So a stamp `L` can only be produced by writes in real `[L, L+999]`,
 * i.e. the bucket is closed from real `L+1000` onward, while this guard first
 * admits the entry at `L+2000`. The usable margin is therefore the 1000ms
 * DIFFERENCE, not the 2000ms window itself.
 *
 * That margin is what absorbs clock skew, since the guard compares a
 * server-supplied timestamp against OUR clock — best-effort, not a proof. If
 * our clock runs BEHIND the storage service's, entries simply never settle
 * and we degrade to always fetching (safe). If our clock runs more than
 * ~1000ms AHEAD, the window can close before the bucket does and the
 * same-second/same-size hole reopens. Fully closing it needs a strong
 * validator (an ETag/checksum) that `StorageObjectMetadata` does not
 * currently expose.
 */
const MUTABLE_CACHE_SETTLE_MS = 2_000;

/**
 * Cache filename for a mutable object. The validating metadata is encoded IN
 * THE NAME rather than kept in a sidecar file, so a metadata mismatch is
 * simply a different filename — a miss, with no window in which a data file
 * and its recorded metadata can disagree, no sidecar to be orphaned by the
 * LRU, and no cross-process coordination needed. The `mut-` prefix keeps this
 * namespace disjoint from the immutable-hash entries (`<hex>.txt`), and the
 * cache key is hashed so an arbitrary caller-supplied identity can never
 * escape the cache directory or collide after sanitization.
 */
const MUTABLE_PREFIX = "mut-";
const mutableCacheDigest = (cacheKey: string): string =>
  createHash("sha256").update(cacheKey).digest("hex");
const mutableCacheFileName = (digest: string, lastModifiedMs: number, size: number): string =>
  `${MUTABLE_PREFIX}${digest}-${lastModifiedMs}-${size}.txt`;

/**
 * Drop superseded versions of the same object after a fresh download. Without
 * this, every edit of a Doc would leave its previous body behind as a
 * permanently-unreferenced cache file, only reclaimed once the whole directory
 * blew past its budget. Matches ONLY completed entries for this digest — the
 * `\.txt$` anchor deliberately excludes another in-progress download's
 * `<name>.txt.download-*` temp file, which shares the prefix and whose removal
 * would break that download's rename.
 */
const pruneSupersededMutableEntries = async (
  digest: string,
  keepFileName: string,
): Promise<void> => {
  let names: string[];
  try {
    names = await fsp.readdir(cacheDir());
  } catch {
    return;
  }
  const completed = new RegExp(`^${MUTABLE_PREFIX}${digest}-\\d+-\\d+\\.txt$`);
  await Promise.all(
    names
      .filter((name) => name !== keepFileName && completed.test(name))
      .map((name) => fsp.unlink(path.join(cacheDir(), name)).catch(() => {})),
  );
};

/** Iterate lines of an in-memory body with `iterateLinesFromFile`'s exact conventions. */
async function* iterateLinesFromText(text: string, startByteOffset = 0): AsyncGenerator<string> {
  const buffer = Buffer.from(text, "utf8");
  const body = startByteOffset > 0 ? buffer.subarray(startByteOffset) : buffer;
  let start = 0;
  let newlineIndex = body.indexOf(NEWLINE_BYTE, start);
  while (newlineIndex !== -1) {
    yield stripTrailingCr(body.toString("utf8", start, newlineIndex));
    start = newlineIndex + 1;
    newlineIndex = body.indexOf(NEWLINE_BYTE, start);
  }
  // A trailing "\n" leaves `start === body.length` and yields no phantom final
  // empty line — matching Node `readline` (and therefore `splitDocLines`).
  if (start < body.length) {
    yield stripTrailingCr(body.toString("utf8", start));
  }
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

/**
 * Build a source over a cache entry that may be UNLINKED between this function
 * returning and its caller actually reading — the cache's own
 * `pruneSupersededMutableEntries` (a concurrent request that found a newer
 * `lastModified`) or `evictCacheIfOverBudget` (a concurrent request that
 * pushed the directory over budget) can both delete it. `readText` /
 * `iterateLines` open the file LAZILY, so that window is real: without the
 * fallback below, a grep racing a Doc edit throws ENOENT where the pre-cache
 * code — which simply fetched the body at read time — always succeeded. The
 * caching must not introduce a failure mode the uncached path didn't have.
 *
 * The fallback re-fetches directly from storage, i.e. it degrades to EXACTLY
 * the pre-cache behavior, so it can never be worse than the status quo.
 *
 * SEMANTICS: the fallback returns the object's CURRENT content, not the
 * content as of when this source was opened. Those genuinely differ (the
 * entry is normally pruned precisely BECAUSE the object was edited), so this
 * is a deliberate choice, not an accident:
 *   - The open-time bytes are gone. Preserving them would mean holding an open
 *     fd from the moment this function returns (POSIX keeps unlinked-but-open
 *     files readable), which leaks a descriptor for every source a caller
 *     opens and never consumes — too high a price for pinning a snapshot the
 *     caller never asked for.
 *   - Fresher is strictly better for grep: this is a search surface whose
 *     whole invalidation design exists to avoid reporting stale content.
 *     Returning current content is the same answer a retry would give.
 */
const cachedMutableSource = (filePath: string, storageKey: string): MutableTextSource => ({
  // Left exposed for the future `rg` acceleration path. NOTE for whoever
  // wires that up: this path carries the same delete-underneath-you risk, and
  // a subprocess gets no benefit from the fallbacks below — an `rg` invocation
  // that fails because the file vanished must fall back to the in-process scan
  // itself rather than surfacing the error.
  filePath,
  readText: async () => {
    try {
      return await fsp.readFile(filePath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      return (await storage.getObject(storageKey)).toString("utf8");
    }
  },
  iterateLines: async function* (startByteOffset = 0) {
    let yielded = 0;
    try {
      for await (const line of iterateLinesFromFile(filePath, startByteOffset)) {
        yielded++;
        yield line;
      }
      return;
    } catch (error) {
      // POSIX keeps an already-open fd readable after unlink, so a vanished
      // entry can only fail at OPEN — before any line is yielded. The
      // `yielded` guard enforces that invariant rather than trusting it: a
      // partially-consumed iteration must never silently restart from the top
      // and re-emit lines the caller already saw.
      if (yielded > 0 || !isMissingFileError(error)) throw error;
    }
    const text = (await storage.getObject(storageKey)).toString("utf8");
    yield* iterateLinesFromText(text, startByteOffset);
  },
});

export interface MutableTextSource extends AssetTextSource {
  /**
   * The whole object as UTF-8. Served from the local cache file (or the real
   * local-provider path) rather than a fresh remote download — this is what
   * turns a per-call network round trip into a local disk read for callers
   * that genuinely need the entire body (a Doc body is capped at ~300 KB, so
   * reading it whole is an already-made architecture decision, not a
   * regression introduced here).
   */
  readText(): Promise<string>;
}

/**
 * Open a text object that has NO immutable content hash to key a cache on —
 * currently Doc bodies, whose domain owns no DB tables and so has nowhere to
 * record one. Cache validity therefore comes from a body-free
 * `getObjectMetadata` probe (S3 HeadObject / local `fs.stat`) compared against
 * the `lastModified` + `size` recorded in the cache entry's filename. The
 * probe is mandatory on EVERY call and is the only invalidation signal: an
 * edited object must never be served from a stale entry. See
 * `MUTABLE_CACHE_SETTLE_MS` for how the 1-second resolution of that timestamp
 * is handled.
 *
 * Deliberately mirrors `openAssetTextSource`'s shape (including the optional
 * `filePath`) so the optional `rg` literal-pattern acceleration in
 * `asset-grep-logic.ts` can later be pointed at a Doc's cached body without
 * a second, separate fetch/cache mechanism.
 */
export const openMutableTextSource = async (params: {
  /** Stable identity of the object across edits (NOT its content) — e.g. `doc:<nodeId>`. */
  cacheKey: string;
  storageKey: string;
}): Promise<MutableTextSource> => {
  if (isLocalStorageProvider()) {
    // Same reasoning as `openAssetTextSource`: the object already IS a local
    // file, so there is nothing to cache and nothing that can go stale —
    // stream the real path and skip the metadata probe entirely.
    //
    // No `cachedMutableSource` fallback here, deliberately: this path hands
    // back the REAL storage object's path, which the cache never prunes or
    // evicts. It can only vanish if the object itself is deleted, and then a
    // re-fetch would fail too — the fallback would be a no-op. That failure
    // also predates this cache (the old code's eager `storage.getObject`
    // threw on a deleted object just the same), so it is not a regression.
    if (!(await storage.objectExists(params.storageKey))) {
      throw new Error(`Object not found: ${params.storageKey}`);
    }
    const filePath = getLocalStoragePath(params.storageKey);
    return {
      filePath,
      iterateLines: (startByteOffset = 0) => iterateLinesFromFile(filePath, startByteOffset),
      readText: () => fsp.readFile(filePath, "utf8"),
    };
  }

  const metadata = await storage.getObjectMetadata(params.storageKey);
  if (!metadata) {
    // Preserves the previous `storage.getObject` behavior for a missing
    // object: a throw, so grep's honest-coverage contract records the node as
    // `errored` rather than silently "scanned, empty, no match".
    throw new Error(`Object not found: ${params.storageKey}`);
  }

  const lastModifiedMs = metadata.lastModified.getTime();
  if (!Number.isFinite(lastModifiedMs) || Date.now() - lastModifiedMs < MUTABLE_CACHE_SETTLE_MS) {
    const text = (await storage.getObject(params.storageKey)).toString("utf8");
    return {
      iterateLines: (startByteOffset = 0) => iterateLinesFromText(text, startByteOffset),
      readText: async () => text,
    };
  }

  const digest = mutableCacheDigest(params.cacheKey);
  const fileName = mutableCacheFileName(digest, lastModifiedMs, metadata.size);
  const filePath = path.join(cacheDir(), fileName);
  const existed = await fileExists(filePath);
  await ensureCachedAtPath(fileName, filePath, params.storageKey);
  if (!existed) {
    await pruneSupersededMutableEntries(digest, fileName);
  }
  return cachedMutableSource(filePath, params.storageKey);
};
