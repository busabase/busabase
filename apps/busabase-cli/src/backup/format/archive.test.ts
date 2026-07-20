import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArchive } from "./archive-reader.js";
import { ArchiveWriter } from "./archive-writer.js";
import { FORMAT_VERSION } from "./manifest.js";

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

    const result = await readArchive(archivePath);

    expect(result.manifest).toEqual(manifest);
    expect(JSON.parse(result.entries.get("tree/nodes.json")!.toString("utf8"))).toEqual([
      { id: "nd_1", name: "Root" },
    ]);
    expect(result.entries.get("bases/base_1/records.ndjson")!.toString("utf8")).toContain("Alice");
    expect(result.entries.get("blobs/sha256/deadbeef")).toEqual(blobBytes);
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

    await expect(readArchive(archivePath)).rejects.toThrow();
  });
});
