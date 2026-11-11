import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRestore } from "../commands.js";
import { openVerifiedArchive, readEntryText, verifyArchive } from "./archive-reader.js";
import { ArchiveWriter } from "./archive-writer.js";
import { FORMAT_VERSION } from "./manifest.js";

describe("verified archive reuse", () => {
  let directory: string, archivePath: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-verified-tar-test-"));
    archivePath = join(directory, "source.bbdump");
    vi.stubEnv("TMPDIR", directory);
    const writer = ArchiveWriter.create(archivePath);
    await writer.addBuffer(
      "tree/nodes.ndjson",
      `${JSON.stringify({ id: "source-root", parentId: null, type: "folder", name: "Verified original" })}\n`,
    );
    await writer.finalize({
      formatVersion: FORMAT_VERSION,
      toolVersion: "test",
      exportedAt: "2026-11-11T00:00:00Z",
      spaceId: "source",
      sourceHost: "http://source.invalid",
      fidelity: "full",
      excludesSecrets: true,
      tables: { nodes: 1 },
      blobCount: 0,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  const temporaryDirectories = async () =>
    (await readdir(directory)).filter((name) => name.startsWith("busabase-restore-"));

  it("replays the exact verified private bytes when the compressed source changes", async () => {
    const verified = await openVerifiedArchive(archivePath);
    expect(await temporaryDirectories()).toHaveLength(1);
    await writeFile(archivePath, "replaced after verification");
    let nodes = "";
    try {
      await verified.streamEntries(async (entry) => {
        const text = await readEntryText(entry.body);
        if (entry.path === "tree/nodes.ndjson") nodes = text;
      });
      expect(JSON.parse(nodes).name).toBe("Verified original");
    } finally {
      await verified.cleanup();
    }
    expect(await temporaryDirectories()).toEqual([]);
    await expect(verified.streamEntries(async () => {})).rejects.toThrow("already closed");
  });

  it("native restore verifies before begin and imports that snapshot after begin replaces the source", async () => {
    const calls: string[] = [];
    const imported: Array<Record<string, unknown>> = [];
    const client = {
      dump: {
        importBegin: vi.fn(async () => {
          calls.push("begin");
          await writeFile(archivePath, "compressed source no longer exists");
          return { sessionId: "session" };
        }),
        importTables: vi.fn(
          async ({ table, rows }: { table: string; rows: Array<Record<string, unknown>> }) => {
            calls.push(table);
            imported.push(...rows);
            return { inserted: rows.length };
          },
        ),
        importCommit: vi.fn(async () => {
          calls.push("commit");
          return { ok: true, warnings: [] };
        }),
        importAbort: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as BusabaseClient;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runRestore(client, { file: archivePath, json: true })).resolves.toMatchObject({
      restored: true,
    });
    expect(calls).toEqual(["begin", "nodes", "commit"]);
    expect(imported[0].name).toBe("Verified original");
    expect(await temporaryDirectories()).toEqual([]);
  });

  it("corrupt archives never start a restore and do not leak decoded temporary files", async () => {
    await writeFile(archivePath, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01]));
    const begin = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runRestore({ dump: { importBegin: begin } } as unknown as BusabaseClient, {
        file: archivePath,
        json: true,
      }),
    ).rejects.toThrow();
    expect(begin).not.toHaveBeenCalled();
    expect(await temporaryDirectories()).toEqual([]);
  });

  it("releases temporary bytes after replay errors and from integrity-only wrappers", async () => {
    const verified = await openVerifiedArchive(archivePath);
    try {
      await expect(
        verified.streamEntries(async () => {
          throw new Error("consumer failed");
        }),
      ).rejects.toThrow("consumer failed");
    } finally {
      await verified.cleanup();
    }
    expect(await temporaryDirectories()).toEqual([]);
    await expect(verifyArchive(archivePath)).resolves.toMatchObject({ tables: { nodes: 1 } });
    expect(await temporaryDirectories()).toEqual([]);
  });
});
