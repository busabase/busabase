import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveWriter } from "../format/archive-writer.js";
import { importFull } from "./full-importer.js";

type Row = Record<string, unknown>;

describe("full restore node dependencies", () => {
  let directory: string;
  let archivePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-node-order-"));
    archivePath = join(directory, "space.bbdump");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function archiveNodes(rows: Row[]) {
    const writer = ArchiveWriter.create(archivePath);
    await writer.addBuffer("tree/nodes.ndjson", rows.map((row) => JSON.stringify(row)).join("\n"));
    await writer.finalize({
      formatVersion: 1,
      toolVersion: "test",
      exportedAt: "2026-11-10T00:00:00.000Z",
      spaceId: "source",
      sourceHost: "http://source.invalid",
      fidelity: "full",
      excludesSecrets: true,
      tables: { nodes: rows.length },
      blobCount: 0,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });
  }

  it("restores reversed parent chains across multiple HTTP batches", async () => {
    const source = Array.from({ length: 450 }, (_, index) => ({
      id: `node-${index}`,
      parentId: index === 0 ? null : `node-${index - 1}`,
      type: "folder",
      position: 449 - index,
    })).reverse();
    await archiveNodes(source);
    const stored = new Map<string, Row>();
    const batches: Row[][] = [];
    const importTables = vi.fn(async ({ table, rows }: { table: string; rows: Row[] }) => {
      expect(table).toBe("nodes");
      batches.push(rows);
      for (const row of rows) {
        if (row.parentId !== null) {
          // Fail the real regression shape: the parent has not been imported
          // by an earlier batch yet. It may also exist in this SQL statement.
          expect(stored.has(String(row.parentId))).toBe(true);
        }
        stored.set(String(row.id), row);
      }
      return { inserted: rows.length };
    });
    const importAbort = vi.fn();
    const client = {
      dump: {
        importBegin: vi.fn(async () => ({ sessionId: "restore-session" })),
        importTables,
        importCommit: vi.fn(async () => ({ ok: true, warnings: [] })),
        importAbort,
      },
    } as unknown as BusabaseClient;

    await expect(importFull({ client, archivePath, sourceSpaceId: "source" })).resolves.toEqual({
      ok: true,
      warnings: [],
    });
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 50]);
    expect(stored.size).toBe(source.length);
    expect([...stored.keys()]).toEqual(Array.from({ length: 450 }, (_, index) => `node-${index}`));
    for (const row of source) expect(stored.get(row.id)).toEqual(row);
    expect(importAbort).not.toHaveBeenCalled();
  });

  it.each([
    {
      rows: [{ id: "child", parentId: "absent" }],
      error: 'parent "absent" is missing from the archive',
    },
    {
      rows: [
        { id: "first", parentId: "second" },
        { id: "second", parentId: "first" },
      ],
      error: "parent cycle blocks node(s) first, second",
    },
    {
      rows: [
        { id: "duplicate", parentId: null },
        { id: "duplicate", parentId: null },
      ],
      error: 'duplicate node id "duplicate"',
    },
  ])("reports a broken node graph before sending node batches: $error", async ({ rows, error }) => {
    await archiveNodes(rows);
    const importTables = vi.fn();
    const importCommit = vi.fn();
    const importAbort = vi.fn(async () => ({ ok: true }));
    const client = {
      dump: {
        importBegin: vi.fn(async () => ({ sessionId: "restore-session" })),
        importTables,
        importCommit,
        importAbort,
      },
    } as unknown as BusabaseClient;

    await expect(importFull({ client, archivePath, sourceSpaceId: "source" })).rejects.toThrow(
      error,
    );
    expect(importTables).not.toHaveBeenCalled();
    expect(importCommit).not.toHaveBeenCalled();
    expect(importAbort).toHaveBeenCalledWith({ sessionId: "restore-session" });
  });
});
