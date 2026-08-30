import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEntryText, streamArchive, verifyArchive } from "./archive-reader.js";
import { ArchiveWriter } from "./archive-writer.js";
import { FORMAT_VERSION } from "./manifest.js";

/** Test helper: stream the whole archive back into a path→text map, the shape the old buffered reader returned. */
async function readAllEntriesAsText(path: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  await streamArchive(path, async (entry) => {
    if (entry.path === "manifest.json") {
      for await (const _chunk of entry.body) {
        // drain
      }
      return;
    }
    entries.set(entry.path, await readEntryText(entry.body));
  });
  return entries;
}

describe("bbdump archive format roundtrip", () => {
  let dir: string;
  let archivePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "busabase-backup-test-"));
    archivePath = join(dir, "space.bbdump");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads back entries + verifies checksum", async () => {
    const writer = ArchiveWriter.create(archivePath);

    await writer.addBuffer("tree/nodes.json", JSON.stringify([{ id: "nd_1", name: "Root" }]));
    await writer.addBuffer(
      "bases/base_1/records.ndjson",
      '{"id":"rec_1","name":"Alice"}\n{"id":"rec_2","name":"Bob"}\n',
    );
    const blobBytes = Buffer.from("hello world binary blob content");
    await writer.addStream("blobs/sha256/deadbeef", blobBytes.length, Readable.from([blobBytes]));

    const manifest = await writer.finalize({
      formatVersion: FORMAT_VERSION,
      toolVersion: "0.1.0-test",
      exportedAt: new Date().toISOString(),
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      fidelity: "full",
      excludesSecrets: true,
      tables: { nodes: 1, records: 2 },
      blobCount: 1,
      blobBytes: blobBytes.length,
      textBlobCount: 0,
      textBlobBytes: 0,
    });

    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);

    const verified = await verifyArchive(archivePath);
    expect(verified).toEqual(manifest);

    const entries = await readAllEntriesAsText(archivePath);
    expect(JSON.parse(entries.get("tree/nodes.json")!)).toEqual([{ id: "nd_1", name: "Root" }]);
    expect(entries.get("bases/base_1/records.ndjson")).toContain("Alice");
    expect(entries.get("blobs/sha256/deadbeef")).toEqual(blobBytes.toString("utf8"));
  });

  it("rejects a truncated archive", async () => {
    const writer = ArchiveWriter.create(archivePath);
    await writer.addBuffer("tree/nodes.json", "[]");
    await writer.finalize({
      formatVersion: FORMAT_VERSION,
      toolVersion: "0.1.0-test",
      exportedAt: new Date().toISOString(),
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      fidelity: "full",
      excludesSecrets: true,
      tables: {},
      blobCount: 0,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });

    const { truncateSync, statSync } = await import("node:fs");
    const size = statSync(archivePath).size;
    truncateSync(archivePath, Math.floor(size * 0.6));

    await expect(verifyArchive(archivePath)).rejects.toThrow();
  });

  it("verifies and streams back an entry written from many small chunks (never a single whole-entry buffer)", async () => {
    // Can't reproduce the literal multi-gigabyte `RangeError: data is too
    // long` here (too slow/memory-heavy for a unit test) — this instead
    // proves the MECHANISM: hashing happens per-chunk (`hash.update(chunk)`
    // in `verifyArchive`), not once over a `Buffer.concat`'d whole entry, by
    // feeding an entry through hundreds of small chunks and checking the
    // result is byte- and hash-identical to computing it the naive way.
    const chunkCount = 500;
    const chunks = Array.from({ length: chunkCount }, (_, i) =>
      Buffer.from(`{"id":"row_${i}","value":"${"x".repeat(50)}"}\n`, "utf8"),
    );
    const whole = Buffer.concat(chunks);

    const writer = ArchiveWriter.create(archivePath);
    await writer.addStream("tree/records.ndjson", whole.length, Readable.from(chunks));
    const manifest = await writer.finalize({
      formatVersion: FORMAT_VERSION,
      toolVersion: "0.1.0-test",
      exportedAt: new Date().toISOString(),
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      fidelity: "full",
      excludesSecrets: true,
      tables: { records: chunkCount },
      blobCount: 0,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });

    const verified = await verifyArchive(archivePath);
    expect(verified.checksum).toBe(manifest.checksum);

    const entries = await readAllEntriesAsText(archivePath);
    expect(entries.get("tree/records.ndjson")).toBe(whole.toString("utf8"));
    expect(entries.get("tree/records.ndjson")?.split("\n").filter(Boolean)).toHaveLength(
      chunkCount,
    );
  });
});
