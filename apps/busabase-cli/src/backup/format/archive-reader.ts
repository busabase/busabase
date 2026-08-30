import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZstdDecompress } from "node:zlib";
import * as tar from "tar-stream";
import {
  canonicalizeEntryChecksums,
  type EntryChecksum,
  type Manifest,
  ManifestSchema,
} from "./manifest.js";

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/** Peek the first 4 bytes of a file to pick the right decompressor (forward-compat with gzip). */
async function detectCompression(path: string): Promise<"zstd" | "gzip"> {
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path, { start: 0, end: 3 });
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(c as Buffer));
    stream.on("error", reject);
    stream.on("end", () => {
      const head = Buffer.concat(chunks);
      if (head.subarray(0, 4).equals(ZSTD_MAGIC)) resolvePromise("zstd");
      else if (head.subarray(0, 2).equals(GZIP_MAGIC)) resolvePromise("gzip");
      else reject(new Error("Unrecognized .bbdump compression (not zstd or gzip magic bytes)."));
    });
  });
}

const requireZstd = async (path: string): Promise<void> => {
  const compression = await detectCompression(path);
  if (compression === "gzip") {
    throw new Error(
      "This .bbdump archive is gzip-compressed; `busabase-cli restore` only reads zstd archives in v1.",
    );
  }
};

/**
 * Decompress the whole archive to a private temp file, then hand back a
 * fresh `tar.extract()` reading from THAT file — never a live
 * `ZstdDecompress` piped straight into `tar.extract()`.
 *
 * That live pipe is where a real, reproducible corruption was traced to on
 * a real multi-gigabyte production archive: rows arriving mangled deep into
 * a large entry (`Unterminated string in JSON`, one row split across two
 * "lines") with no invalid bytes anywhere on disk. Isolated piece by piece:
 * Node's built-in zstd decompression is byte-perfect on its own (verified
 * against the system `zstd` CLI with `cmp` — identical output), and
 * `tar-stream` parses a pre-decompressed file with zero errors — the
 * corruption only reproduced with the live pipe. This fix removes that live
 * interaction (decompress to a file, then tar-parse the file) as the
 * primary defense; `full-importer.ts` also stopped relying on `node:readline`
 * for the same entries as defense in depth, since the exact mechanism
 * inside the live pipe was never pinned down to one specific line. The
 * cost is one extra temp-file write per pass — cheap local disk I/O,
 * negligible next to the HTTP round trips a real restore/verify already
 * does.
 */
const openTarStream = async (
  path: string,
): Promise<{ extract: tar.Extract; cleanup: () => Promise<void> }> => {
  const tempDir = await mkdtemp(join(tmpdir(), "busabase-restore-"));
  const decompressedPath = join(tempDir, "archive.tar");
  const cleanup = () => rm(tempDir, { recursive: true, force: true });
  try {
    await pipeline(
      createReadStream(path),
      new ZstdDecompress(),
      createWriteStream(decompressedPath),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }

  const extract = tar.extract();
  createReadStream(decompressedPath)
    .on("error", (err) => extract.destroy(err))
    .pipe(extract);
  return { extract, cleanup };
};

/**
 * Pass 1 of 2 — integrity only, never buffers a whole entry.
 *
 * Streams every tar entry chunk-by-chunk, hashing incrementally
 * (`hash.update(chunk)` per chunk, not once over a concatenated whole-entry
 * buffer — a single `Hash.update()` call over a many-gigabyte buffer throws
 * `RangeError: data is too long`, which is exactly what a real production
 * space's attachment bytes hit here before this rewrite). Recomputes and
 * checks the manifest's top-level `checksum` before returning anything —
 * a truncated or tampered archive throws here, before `streamArchive` (pass
 * 2) is ever invoked, so "verified before a single row is written" holds
 * regardless of entry size.
 */
export async function verifyArchive(path: string): Promise<Manifest> {
  await requireZstd(path);

  const { extract, cleanup } = await openTarStream(path);
  try {
    const checksums: EntryChecksum[] = [];
    let manifestBuf: Buffer | undefined;

    await new Promise<void>((resolvePromise, reject) => {
      extract.on("entry", (header, stream, next) => {
        const hash = createHash("sha256");
        const manifestChunks: Buffer[] | undefined =
          header.name === "manifest.json" ? [] : undefined;
        stream.on("data", (chunk) => {
          hash.update(chunk);
          manifestChunks?.push(chunk as Buffer);
        });
        stream.on("end", () => {
          if (manifestChunks) {
            manifestBuf = Buffer.concat(manifestChunks);
          } else {
            checksums.push({ path: header.name, sha256: hash.digest("hex") });
          }
          next();
        });
        stream.on("error", reject);
        stream.resume();
      });
      extract.on("finish", resolvePromise);
      extract.on("error", reject);
    });

    if (!manifestBuf) {
      throw new Error("Archive is missing manifest.json.");
    }
    const manifest = ManifestSchema.parse(JSON.parse(manifestBuf.toString("utf8")));

    const recomputed = createHash("sha256")
      .update(canonicalizeEntryChecksums(checksums))
      .digest("hex");
    if (recomputed !== manifest.checksum) {
      throw new Error(
        `Archive checksum mismatch — file may be truncated or corrupted (expected ${manifest.checksum}, got ${recomputed}).`,
      );
    }

    return manifest;
  } finally {
    await cleanup();
  }
}

export interface StreamedArchiveEntry {
  path: string;
  /**
   * The entry's raw bytes, in order. The callback MUST fully consume (or
   * explicitly drain) this before its promise resolves — tar-stream can't
   * advance to the next entry until the current one's stream has ended.
   */
  body: Readable;
}

/**
 * Pass 2 of 2 — content, streamed. Call only after `verifyArchive` has
 * already succeeded for this same file. Re-opens the archive (a second,
 * independent decompress+detar pass over the local file — cheap sequential
 * disk I/O, not a network cost) and hands each entry's raw stream to
 * `onEntry` in tar-physical order, one at a time, without ever buffering a
 * whole entry in memory. Callers that need dependency-ordered processing
 * (e.g. `busabase-cli restore`'s FK-safe table order) get it for free as
 * long as the archive was WRITTEN in that order — see `full-exporter.ts`.
 */
export async function streamArchive(
  path: string,
  onEntry: (entry: StreamedArchiveEntry) => Promise<void>,
): Promise<void> {
  const { extract, cleanup } = await openTarStream(path);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      extract.on("entry", (header, stream, next) => {
        onEntry({ path: header.name, body: stream }).then(
          () => next(),
          (err) => {
            // Make sure the underlying stream doesn't dangle if the callback
            // threw without draining it, then propagate the real failure.
            stream.resume();
            reject(err);
          },
        );
      });
      extract.on("finish", resolvePromise);
      extract.on("error", reject);
    });
  } finally {
    await cleanup();
  }
}

/** Drain an entry's stream without keeping its bytes (unknown/skipped entries). */
export async function drainEntry(body: Readable): Promise<void> {
  for await (const _chunk of body) {
    // discard
  }
}

/** Read a small entry fully into a UTF-8 string (doc bodies — individually small, unlike table/blob entries). */
export async function readEntryText(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
