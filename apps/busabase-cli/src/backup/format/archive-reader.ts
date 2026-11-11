import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
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

/** A streamed entry must be fully consumed or drained before the callback resolves. */
export interface StreamedArchiveEntry {
  path: string;
  body: Readable;
}

export interface VerifiedArchive {
  manifest: Manifest;
  /** Replays the same private tar bytes that passed the checksum scan. */
  streamEntries(onEntry: (entry: StreamedArchiveEntry) => Promise<void>): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Decompress to a private file rather than a live ZstdDecompress → tar pipe.
 * That live combination previously corrupted multi-GB archive row boundaries.
 */
async function decompressArchive(path: string) {
  await requireZstd(path);
  const tempDir = await mkdtemp(join(tmpdir(), "busabase-restore-"));
  const tarPath = join(tempDir, "archive.tar");
  const cleanup = () => rm(tempDir, { recursive: true, force: true });
  try {
    await pipeline(createReadStream(path), new ZstdDecompress(), createWriteStream(tarPath));
    return { tarPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Every pass opens only this private, already decompressed tar file. */
async function streamTar(tarPath: string, onEntry: (entry: StreamedArchiveEntry) => Promise<void>) {
  const extract = tar.extract();
  const input = createReadStream(tarPath);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      extract.on("entry", (header, stream, next) => {
        stream.on("error", reject);
        Promise.resolve()
          .then(() => onEntry({ path: header.name, body: stream }))
          .then(
            () => next(),
            (error) => {
              reject(error);
              input.destroy();
              extract.destroy();
            },
          );
      });
      extract.on("finish", resolvePromise);
      extract.on("error", reject);
      input.on("error", (error) => extract.destroy(error));
      input.pipe(extract);
    });
  } finally {
    input.destroy();
    extract.destroy();
    await Promise.allSettled([finished(input), finished(extract)]);
  }
}

async function verifyTar(tarPath: string): Promise<Manifest> {
  const checksums: EntryChecksum[] = [];
  let manifestBytes: Buffer | undefined;
  await streamTar(tarPath, async (entry) => {
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of entry.body) {
      hash.update(chunk);
      if (entry.path === "manifest.json") {
        size += chunk.length;
        if (size > 8 * 1024 * 1024)
          throw new Error("Archive manifest exceeds the 8 MiB metadata limit.");
        chunks.push(chunk as Buffer);
      }
    }
    if (entry.path === "manifest.json") {
      if (manifestBytes) throw new Error("Archive contains more than one manifest.json.");
      manifestBytes = Buffer.concat(chunks);
    } else checksums.push({ path: entry.path, sha256: hash.digest("hex") });
  });
  if (!manifestBytes) throw new Error("Archive is missing manifest.json.");
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const recomputed = createHash("sha256")
    .update(canonicalizeEntryChecksums(checksums))
    .digest("hex");
  if (recomputed !== manifest.checksum) {
    throw new Error(
      `Archive checksum mismatch — file may be truncated or corrupted (expected ${manifest.checksum}, got ${recomputed}).`,
    );
  }
  return manifest;
}

/**
 * Decode once, verify every entry before writes, then retain that exact private
 * tar for import. Mutating/replacing the compressed source after verification
 * cannot change the replay, and a 36GB backup is not decompressed twice.
 */
export async function openVerifiedArchive(path: string): Promise<VerifiedArchive> {
  const temporary = await decompressArchive(path);
  try {
    const manifest = await verifyTar(temporary.tarPath);
    let closed = false,
      reading = false;
    return {
      manifest,
      async streamEntries(onEntry) {
        if (closed) throw new Error("Verified archive is already closed.");
        if (reading) throw new Error("Verified archive is already being read.");
        reading = true;
        try {
          await streamTar(temporary.tarPath, onEntry);
        } finally {
          reading = false;
        }
      },
      async cleanup() {
        if (reading)
          throw new Error("Cannot remove a verified archive while its entries are being read.");
        closed = true;
        await temporary.cleanup();
      },
    };
  } catch (error) {
    await temporary.cleanup();
    throw error;
  }
}

/** Backwards-compatible integrity-only wrapper; releases temporary bytes immediately. */
export async function verifyArchive(path: string): Promise<Manifest> {
  const archive = await openVerifiedArchive(path);
  try {
    return archive.manifest;
  } finally {
    await archive.cleanup();
  }
}

/**
 * Backwards-compatible content-only wrapper for callers that verified separately.
 * Restore commands should use openVerifiedArchive to reuse the verified tar.
 */
export async function streamArchive(
  path: string,
  onEntry: (entry: StreamedArchiveEntry) => Promise<void>,
): Promise<void> {
  const temporary = await decompressArchive(path);
  try {
    await streamTar(temporary.tarPath, onEntry);
  } finally {
    await temporary.cleanup();
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
