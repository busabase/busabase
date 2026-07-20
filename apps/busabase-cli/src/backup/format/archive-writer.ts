import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZstdCompress } from "node:zlib";
import * as tar from "tar-stream";
import { canonicalizeEntryChecksums, type EntryChecksum, type Manifest } from "./manifest.js";

/**
 * Streaming writer for a `.bbdump` archive: a tar stream of entries piped
 * through `node:zlib`'s built-in zstd compressor straight to disk. Every
 * entry's bytes are sha256'd as they're written (for the manifest's
 * per-entry + top-level checksums) without buffering the whole archive in
 * memory — entries are added one at a time, in any order, then `finalize()`
 * writes `manifest.json` last and closes the stream.
 */
export class ArchiveWriter {
  private readonly pack = tar.pack();
  private readonly entryChecksums: EntryChecksum[] = [];
  private readonly donePromise: Promise<void>;

  private constructor(outPath: string) {
    const zstd = new ZstdCompress();
    this.donePromise = pipeline(this.pack, zstd, createWriteStream(outPath));
  }

  static create(outPath: string): ArchiveWriter {
    return new ArchiveWriter(outPath);
  }

  /** Add one archive entry from an in-memory buffer/string (small entries: manifest, base.json, etc). */
  async addBuffer(path: string, data: Buffer | string): Promise<void> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const sha256 = createHash("sha256").update(buf).digest("hex");
    this.entryChecksums.push({ path, sha256 });
    await new Promise<void>((resolvePromise, reject) => {
      this.pack.entry({ name: path, size: buf.length }, buf, (err) =>
        err ? reject(err) : resolvePromise(),
      );
    });
  }

  /** Add one archive entry streamed from a Readable (large entries: records.ndjson, blobs). */
  async addStream(path: string, size: number, source: Readable): Promise<void> {
    const hash = createHash("sha256");
    const entry = this.pack.entry({ name: path, size });
    const tee = new PassThrough();
    tee.on("data", (chunk) => hash.update(chunk));
    await pipeline(source, tee, entry);
    this.entryChecksums.push({ path, sha256: hash.digest("hex") });
  }

  /**
   * Write `manifest.json` (with the top-level checksum over every other
   * entry) and close the archive. Must be called exactly once, after every
   * other entry has been added.
   */
  async finalize(manifestWithoutChecksum: Omit<Manifest, "checksum">): Promise<Manifest> {
    const checksum = createHash("sha256")
      .update(canonicalizeEntryChecksums(this.entryChecksums))
      .digest("hex");
    const manifest: Manifest = { ...manifestWithoutChecksum, checksum };
    const buf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    await new Promise<void>((resolvePromise, reject) => {
      this.pack.entry({ name: "manifest.json", size: buf.length }, buf, (err) =>
        err ? reject(err) : resolvePromise(),
      );
    });
    this.pack.finalize();
    await this.donePromise;
    return manifest;
  }
}
