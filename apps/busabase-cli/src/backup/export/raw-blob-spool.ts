import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ArchiveWriter } from "../format/archive-writer.js";

export class BackupContentIntegrityError extends Error {}
export interface RawBlobMetadata {
  storageKey?: string;
  textStorageKey?: string;
  mimeType?: string;
  bytes: number;
  sha256: string;
}

type Kind = "attachments" | "asset-texts";
const keyDigest = (key: string) => createHash("sha256").update(key).digest("hex");
export const canonicalHash = (value: unknown, label: string): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(value))
    throw new BackupContentIntegrityError(
      `Unsupported registered content hash for ${label}: expected 64 hex SHA-256 characters, optionally prefixed with sha256:.`,
    );
  return value.replace(/^sha256:/i, "").toLowerCase();
};
const assertDigest = (actual: string, expected: unknown, label: string) => {
  const hash = canonicalHash(expected, label);
  if (hash && hash !== actual)
    throw new BackupContentIntegrityError(
      `Content hash mismatch for ${label} (expected sha256:${hash}, downloaded sha256:${actual}). Backup stopped; no complete archive was produced.`,
    );
};
async function digestFile(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Version 2 raw object files and atomic receipts: memory never scales with blob size. */
export class RawBlobSpool {
  private readonly entries = new Map<string, RawBlobMetadata>();
  private constructor(
    private readonly directory: string,
    private readonly kind: Kind,
  ) {}
  private key(metadata: RawBlobMetadata) {
    return (this.kind === "attachments" ? metadata.storageKey : metadata.textStorageKey) as string;
  }

  static async open(
    directory: string,
    kind: Kind,
    resume: boolean,
    registeredHashes?: ReadonlyMap<string, string>,
  ): Promise<RawBlobSpool> {
    let legacy = false;
    try {
      legacy = (await stat(directory)).isFile();
    } catch {
      /* new backup */
    }
    if (!resume) await rm(directory, { recursive: true, force: true });
    const old = `${directory}.legacy`;
    if (resume && legacy) await rename(directory, old);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const spool = new RawBlobSpool(directory, kind);
    if (resume && legacy) {
      try {
        await spool.migrateLegacy(old, registeredHashes);
        await rm(old);
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        await rename(old, directory);
        throw error;
      }
    }
    return spool;
  }

  private async migrateLegacy(path: string, hashes?: ReadonlyMap<string, string>) {
    // Old spool files held base64 in one JSON row. Migrate small complete rows
    // only; a large legacy spool must be downloaded again, never buffered until OOM.
    let pending = "";
    for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
      pending += chunk;
      if (pending.length > 16 * 1024 * 1024)
        throw new Error(
          "Legacy backup spool has a large base64 row. Run backup without --resume to create a bounded raw-object spool.",
        );
      let end: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: incremental legacy migration
      while ((end = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line);
        } catch {
          return;
        }
        const key = row[this.kind === "attachments" ? "storageKey" : "textStorageKey"];
        if (typeof key !== "string" || typeof row.base64 !== "string") continue;
        const bytes = Buffer.from(row.base64, "base64");
        await this.download(
          new Response(bytes),
          key,
          row.mimeType as string | undefined,
          [hashes?.get(key)],
          `resumed attachment ${key}`,
        );
      }
    }
    // A trailing row with no newline was interrupted and is deliberately ignored.
  }

  async recover(
    allowed: ReadonlyMap<string, string | undefined>,
  ): Promise<{ keys: Set<string>; count: number; bytes: number }> {
    const keys = new Set<string>();
    let bytes = 0;
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      let metadata: RawBlobMetadata;
      try {
        metadata = JSON.parse(await readFile(join(this.directory, name), "utf8"));
      } catch {
        continue;
      } // Receipt publication was interrupted: re-download the object.
      const key = this.key(metadata);
      if (typeof key !== "string" || !allowed.has(key) || keyDigest(key) !== name.slice(0, -5))
        continue;
      let actual: { bytes: number; sha256: string };
      try {
        actual = await digestFile(join(this.directory, `${keyDigest(key)}.bin`));
      } catch {
        continue;
      }
      if (actual.bytes !== metadata.bytes || actual.sha256 !== metadata.sha256)
        throw new BackupContentIntegrityError(
          `Content hash mismatch for resumed attachment ${key}. Backup stopped; no complete archive was produced.`,
        );
      assertDigest(actual.sha256, allowed.get(key), `resumed attachment ${key}`);
      this.entries.set(key, metadata);
      keys.add(key);
      bytes += metadata.bytes;
    }
    return { keys, count: keys.size, bytes };
  }

  async download(
    response: Response,
    key: string,
    mimeType: string | undefined,
    expectedHashes: unknown[],
    label: string,
  ): Promise<RawBlobMetadata> {
    if (!response.body) throw new Error(`Download of ${label} has no response body`);
    for (const hash of expectedHashes) canonicalHash(hash, label);
    const digest = keyDigest(key);
    const rawPath = join(this.directory, `${digest}.bin`);
    const temporary = join(this.directory, `${digest}.${randomUUID()}.downloading`);
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
        meter,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      const sha256 = hash.digest("hex");
      for (const registered of expectedHashes) assertDigest(sha256, registered, label);
      const metadata: RawBlobMetadata = {
        ...(this.kind === "attachments"
          ? { storageKey: key, mimeType: mimeType ?? "application/octet-stream" }
          : { textStorageKey: key }),
        bytes,
        sha256,
      };
      await rename(temporary, rawPath);
      const receipt = join(this.directory, `${digest}.json`);
      const receiptPart = `${receipt}.${randomUUID()}.tmp`;
      await writeFile(receiptPart, JSON.stringify(metadata), { mode: 0o600 });
      await rename(receiptPart, receipt);
      this.entries.set(key, metadata);
      return metadata;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async finish(
    writer: Pick<ArchiveWriter, "addBuffer" | "addStream">,
    orderedKeys: readonly string[],
  ): Promise<void> {
    for (const key of orderedKeys) {
      const metadata = this.entries.get(key);
      if (!metadata) continue;
      const digest = keyDigest(key);
      const prefix = `blobs/${this.kind}/${digest}`;
      await writer.addBuffer(`${prefix}.json`, `${JSON.stringify(metadata)}\n`);
      const source = createReadStream(join(this.directory, `${digest}.bin`));
      try {
        await writer.addStream(`${prefix}.bin`, metadata.bytes, source);
      } finally {
        source.destroy();
      }
    }
  }

  async cleanup(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
    await rm(`${this.directory}.legacy`, { force: true });
  }
}
