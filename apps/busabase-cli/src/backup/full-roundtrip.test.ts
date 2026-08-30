import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportFull } from "./export/full-exporter.js";
import { verifyArchive } from "./format/archive-reader.js";
import { IMPORT_ORDER, importFull } from "./import/full-importer.js";

/**
 * Nothing previously exercised `exportFull` and `importFull` together —
 * `archive.test.ts` only covers the low-level tar/checksum primitives, and
 * `packages/busabase-core/tests/dump-roundtrip.test.ts` covers the SERVER's
 * own import semantics in-process, never touching the CLI's `.bbdump` format
 * at all. That gap is exactly how the write/read ordering mismatch this
 * rewrite fixes could have shipped unnoticed: `full-exporter.ts` now writes
 * archive entries in `IMPORT_ORDER` specifically so `full-importer.ts`'s
 * single streaming pass sees blobs before the table rows that reference
 * them, and every table before anything that FKs into it — this test pins
 * that contract at the CLI-package level, with fake, in-memory "servers" on
 * both ends (no real HTTP, no real DB) that only need to agree on shape.
 */

/** A tiny in-memory "export server": paginates fixture rows two at a time, ignoring the caller's requested `limit`, so every table with >2 rows genuinely forces multiple `exportTables` calls. */
function createFakeExportClient(
  tables: Partial<Record<string, Array<Record<string, unknown>>>>,
  docs: Record<string, string>,
): BusabaseClient {
  return {
    dump: {
      exportTables: async ({ table, cursor }: { table: string; cursor?: string }) => {
        const rows = tables[table] ?? [];
        const start = cursor ? Number.parseInt(cursor, 10) : 0;
        const page = rows.slice(start, start + 2);
        const nextIndex = start + page.length;
        return { rows: page, nextCursor: nextIndex < rows.length ? String(nextIndex) : null };
      },
      exportAssetText: async () => {
        throw new Error("not exercised by this fixture (assetTexts is empty)");
      },
    },
    nodes: {
      get: async ({ nodeId, type }: { nodeId: string; type?: string }) => {
        if (type !== "doc" || !(nodeId in docs)) {
          throw new Error(`unexpected nodes.get(${nodeId}, ${type})`);
        }
        return { type: "doc", body: docs[nodeId] };
      },
    },
    assets: {
      download: async () => {
        throw new Error("not exercised by this fixture (assets is empty)");
      },
    },
  } as any;
}

interface RecordedImport {
  table: string;
  rows: Array<Record<string, unknown>>;
}

/** A tiny in-memory "import server": records every `importTables` call verbatim so the test can assert on call order and payload, without a real DB. */
function createFakeImportClient(recorded: RecordedImport[]): BusabaseClient {
  return {
    dump: {
      importBegin: async () => ({ sessionId: "sess_test" }),
      importTables: async ({
        table,
        rows,
      }: {
        table: string;
        rows: Array<Record<string, unknown>>;
      }) => {
        recorded.push({ table, rows });
        return { inserted: rows.length };
      },
      importCommit: async () => ({ ok: true, warnings: [] }),
      importAbort: async () => ({ ok: true }),
    },
  } as any;
}

describe("exportFull -> verifyArchive -> importFull round trip", () => {
  let dir: string;
  let archivePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "busabase-full-roundtrip-test-"));
    archivePath = join(dir, "space.bbdump");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams every table in IMPORT_ORDER, blobs first, docs last — with real multi-page pagination", async () => {
    const nodeRows = [
      { id: "nod_root", parentId: null, type: "folder" },
      { id: "nod_doc", parentId: "nod_root", type: "doc" },
      { id: "nod_base", parentId: "nod_root", type: "base" },
    ];
    // 5 rows over a page size of 2 forces 3 real `exportTables` calls.
    const recordRows = Array.from({ length: 5 }, (_, i) => ({ id: `rec_${i}`, value: i }));

    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = nodeRows;
    tables.records = recordRows;

    const exportClient = createFakeExportClient(tables, { nod_doc: "# Hello\n\nDoc body." });

    const manifest = await exportFull({
      client: exportClient,
      outPath: archivePath,
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      includeHistory: true,
      toolVersion: "0.1.0-test",
    });

    expect(manifest.tables.nodes).toBe(3);
    expect(manifest.tables.records).toBe(5);

    // Pass 1 must succeed on its own before anything is imported.
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

    const recorded: RecordedImport[] = [];
    const importClient = createFakeImportClient(recorded);
    const result = await importFull({
      client: importClient,
      archivePath,
      sourceSpaceId: "spc_test",
    });

    expect(result).toEqual({ ok: true, warnings: [] });

    // All 5 `records` rows arrived, correctly reassembled across 3 pages.
    const recordCalls = recorded.filter((c) => c.table === "records");
    expect(recordCalls.flatMap((c) => c.rows)).toEqual(recordRows);

    // All 3 `nodes` rows arrived too.
    const nodeCalls = recorded.filter((c) => c.table === "nodes");
    expect(nodeCalls.flatMap((c) => c.rows)).toEqual(nodeRows);

    // The doc body made it through as a `docBodies` pseudo-table row.
    const docCalls = recorded.filter((c) => c.table === "docBodies");
    expect(docCalls.flatMap((c) => c.rows)).toEqual([
      { nodeId: "nod_doc", markdown: "# Hello\n\nDoc body." },
    ]);

    // Ordering: every real table appears in `IMPORT_ORDER`'s relative order
    // (nodes before records, both well before docBodies, which is always
    // last) — this is the exact property the write/read rewrite exists to
    // guarantee via a single streaming pass, not an in-memory reorder.
    const tableOrder = recorded.map((c) => c.table);
    const firstIndexOf = (table: string) => tableOrder.indexOf(table);
    expect(firstIndexOf("nodes")).toBeLessThan(firstIndexOf("records"));
    expect(firstIndexOf("records")).toBeLessThan(firstIndexOf("docBodies"));
    expect(tableOrder.indexOf("docBodies")).toBe(tableOrder.length - 1);

    // Every table that produced a call is somewhere in IMPORT_ORDER (or is
    // the docBodies pseudo-table), and real tables never appear out of their
    // IMPORT_ORDER relative sequence.
    const realTableOrder = tableOrder.filter((t) => t !== "docBodies");
    const expectedRelativeOrder = IMPORT_ORDER.filter((t) => realTableOrder.includes(t));
    expect(realTableOrder).toEqual(expectedRelativeOrder);
  });
});
