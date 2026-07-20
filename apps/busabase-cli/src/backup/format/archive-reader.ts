import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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

export interface ReadArchiveResult {
  manifest: Manifest;
  /**
   * Every non-manifest entry, fully buffered by path. Fine for the manifest,
   * tree/base-schema files, and per-blob entries; a very large single
   * `records.ndjson` for a huge space is the known scaling limit of this v1
   * reader — a future version can swap this for a true streaming per-entry
   * callback without changing the on-disk format.
   */
  entries: Map<string, Buffer>;
}

/**
 * Read and integrity-verify a `.bbdump` archive: decompress, extract every
 * tar entry, recompute each entry's sha256, then recompute and check the
 * manifest's top-level `checksum` before returning anything to the caller —
 * a truncated or tampered archive throws here, before any row is imported.
 */
export async function readArchive(path: string): Promise<ReadArchiveResult> {
  const compression = await detectCompression(path);
  if (compression === "gzip") {
    throw new Error(
      "This .bbdump archive is gzip-compressed; `busabase-cli restore` only reads zstd archives in v1.",
    );
  }

  const extract = tar.extract();
  const entries = new Map<string, Buffer>();
  const checksums: EntryChecksum[] = [];
  let manifestBuf: Buffer | undefined;

  await new Promise<void>((resolvePromise, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(c as Buffer));
      stream.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (header.name === "manifest.json") {
          manifestBuf = buf;
        } else {
          const sha256 = createHash("sha256").update(buf).digest("hex");
          checksums.push({ path: header.name, sha256 });
          entries.set(header.name, buf);
        }
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });
    extract.on("finish", resolvePromise);
    extract.on("error", reject);

    createReadStream(path).pipe(new ZstdDecompress()).on("error", reject).pipe(extract);
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

  return { manifest, entries };
}
