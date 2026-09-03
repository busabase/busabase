import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      // Mirrors the real route: a batch in, one entry per id that resolves to
      // a Doc, ids that don't resolve simply omitted (never an error).
      exportDocBodies: async ({ nodeIds }: { nodeIds: string[] }) => ({
        bodies: nodeIds
          .filter((nodeId) => nodeId in docs)
          .map((nodeId) => ({ nodeId, markdown: docs[nodeId] })),
      }),
    },
    nodes: {
      get: async () => {
        // The exporter must NOT reach for the ordinary node read path for doc
        // bodies any more — it 404s on archived Docs, which is exactly the bug
        // `dump.exportDocBodies` exists to fix.
        throw new Error("nodes.get must not be used to read doc bodies");
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

  it("spools attachment and asset-text blobs to disk instead of an in-memory array, and they still round-trip", async () => {
    // Regression coverage for a real production bug: `attachmentBlobRows`/
    // `textBlobRows` used to collect every downloaded blob into an in-memory
    // array before writing the archive entry, which blew Node's heap on a
    // real space's ~5.7GB of attachments ("JavaScript heap out of memory").
    // Fixed by spooling each row to a temp file as it's downloaded
    // (`SpooledNdjsonEntry`) — this test exercises that exact code path (the
    // fixture in the previous test deliberately leaves `assets`/`assetTexts`
    // empty and never reaches it) and confirms the bytes still arrive intact.
    const attachmentBytes = Buffer.from("attachment-bytes");
    const textBytes = Buffer.from("extracted-text-bytes");

    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.attachments = [{ id: "att_1", storageKey: "blobs/att_1.bin" }];
    // `assetTexts.assetId` is a real NOT NULL FK into `assets`, so `ast_2` has
    // to exist as an Asset for this archive to be restorable at all — a text
    // row pointing at an Asset the archive doesn't carry is exactly the drift
    // the export-side FK check drops. Two separate Assets (a binary one whose
    // bytes come from the attachment pass, a text one whose bytes come from
    // the asset-text pass) is also what makes the two blob paths distinguishable.
    tables.assets = [
      { id: "ast_1", attachmentId: "att_1" },
      { id: "ast_2", attachmentId: "att_1" },
    ];
    tables.assetTexts = [{ assetId: "ast_2" }];

    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:15419/blob/att_1") {
        return new Response(attachmentBytes, { status: 200 });
      }
      if (url === "http://localhost:15419/text/ast_2") {
        return new Response(textBytes, { status: 200 });
      }
      throw new Error(`unexpected fetch(${url})`);
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const base = createFakeExportClient(tables, {});
      const exportClient: BusabaseClient = {
        ...base,
        dump: {
          ...base.dump,
          exportAssetText: async ({ assetId }: { assetId: string }) => {
            if (assetId !== "ast_2") throw new Error(`unexpected exportAssetText(${assetId})`);
            return { downloadUrl: "/text/ast_2", textStorageKey: "text/ast_2.txt" };
          },
        },
        assets: {
          download: async ({ assetId }: { assetId: string }) => {
            if (assetId !== "ast_1") throw new Error(`unexpected assets.download(${assetId})`);
            return { downloadUrl: "/blob/att_1", mimeType: "application/octet-stream" };
          },
        },
      } as any;

      const manifest = await exportFull({
        client: exportClient,
        outPath: archivePath,
        spaceId: "spc_test",
        sourceHost: "http://localhost:15419",
        includeHistory: true,
        toolVersion: "0.1.0-test",
      });

      expect(manifest.blobCount).toBe(1);
      expect(manifest.blobBytes).toBe(attachmentBytes.length);
      expect(manifest.textBlobCount).toBe(1);
      expect(manifest.textBlobBytes).toBe(textBytes.length);
      await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

      const recorded: RecordedImport[] = [];
      const importClient = createFakeImportClient(recorded);
      const result = await importFull({
        client: importClient,
        archivePath,
        sourceSpaceId: "spc_test",
      });
      expect(result).toEqual({ ok: true, warnings: [] });

      const attachmentBlobCalls = recorded.filter((c) => c.table === "attachmentBlobs");
      expect(attachmentBlobCalls.flatMap((c) => c.rows)).toEqual([
        {
          storageKey: "blobs/att_1.bin",
          mimeType: "application/octet-stream",
          base64: attachmentBytes.toString("base64"),
        },
      ]);

      const textBlobCalls = recorded.filter((c) => c.table === "assetTextBlobs");
      expect(textBlobCalls.flatMap((c) => c.rows)).toEqual([
        { textStorageKey: "text/ast_2.txt", base64: textBytes.toString("base64") },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops a fieldValues row whose recordId isn't in this same archive's records, instead of shipping a restore-time FK crash", async () => {
    // Regression coverage for a real production bug: a backup of an
    // actively-used space took over an hour. `records` is fetched (and its
    // snapshot fixed) long before the much larger `fieldValues` table
    // finishes — a record created live in that gap was captured by
    // `fieldValues` (id-paged, not creation-time-ordered, so not confined to
    // the tail) but missed by the earlier `records` snapshot. The resulting
    // archive restored 1.1M fieldValues rows successfully and then failed on
    // the very last batch with a raw, undiagnosable "Internal server error"
    // — a real Postgres foreign-key violation on `fieldValues.recordId`.
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.bases = [{ id: "bse_1" }];
    tables.commits = [{ id: "cmt_1" }];
    tables.records = [{ id: "rec_exported" }];
    tables.fieldValues = [
      {
        id: "fvl_ok",
        baseId: "bse_1",
        commitId: "cmt_1",
        recordId: "rec_exported",
        fieldSlug: "a",
      },
      {
        id: "fvl_orphaned",
        baseId: "bse_1",
        commitId: "cmt_1",
        recordId: "rec_created_after_records_was_already_exported",
        fieldSlug: "b",
      },
    ];

    const warnings: string[] = [];
    const manifest = await exportFull({
      client: createFakeExportClient(tables, {}),
      outPath: archivePath,
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      includeHistory: true,
      toolVersion: "0.1.0-test",
      onProgress: (m) => warnings.push(m),
    });

    expect(manifest.tables.fieldValues).toBe(1);
    expect(warnings.some((w) => w.includes("dropped 1 fieldValues row"))).toBe(true);
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

    const recorded: RecordedImport[] = [];
    const result = await importFull({
      client: createFakeImportClient(recorded),
      archivePath,
      sourceSpaceId: "spc_test",
    });
    expect(result).toEqual({ ok: true, warnings: [] });

    const fieldValueCalls = recorded.filter((c) => c.table === "fieldValues");
    expect(fieldValueCalls.flatMap((c) => c.rows).map((r) => r.id)).toEqual(["fvl_ok"]);
  });

  it("falls back to the legacy per-Doc read when the server predates dump.exportDocBodies", async () => {
    // The CLI ships independently of the server, so a current CLI routinely
    // talks to an older one. Reproduced live: a real backup against production
    // got `Not found` for every `dump.exportDocBodies` batch and archived ZERO
    // doc bodies — worse than the 13 the old per-Doc path managed. A missing
    // route must degrade to the old path, not to silence.
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [
      { id: "nod_root", parentId: null, type: "folder" },
      { id: "nod_live", parentId: "nod_root", type: "doc" },
      { id: "nod_archived", parentId: "nod_root", type: "doc" },
    ];

    const base = createFakeExportClient(tables, {});
    const exportClient = {
      ...base,
      dump: {
        ...base.dump,
        exportDocBodies: async () => {
          throw new Error("Not found");
        },
      },
      nodes: {
        // The legacy path: live Docs readable, archived ones refused — exactly
        // how an old server behaves.
        get: async ({ nodeId }: { nodeId: string }) => {
          if (nodeId === "nod_archived") throw new Error("Doc not found: nod_archived");
          return { type: "doc", body: "live body\n" };
        },
      },
    } as unknown as BusabaseClient;

    const messages: string[] = [];
    const manifest = await exportFull({
      client: exportClient,
      outPath: archivePath,
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      includeHistory: true,
      toolVersion: "0.1.0-test",
      onProgress: (m) => messages.push(m),
    });

    expect(messages.some((m) => m.includes("predates `dump.exportDocBodies`"))).toBe(true);
    // The archived one's absence is stated, not silent.
    expect(messages.some((m) => m.includes("nod_archived"))).toBe(true);
    expect(messages).toContain("fetched 1 doc bodies, skipped 1");
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

    // The live Doc's body genuinely reached the archive — the whole point of
    // the fallback, and the part a log line alone wouldn't prove.
    const recorded: RecordedImport[] = [];
    await importFull({
      client: createFakeImportClient(recorded),
      archivePath,
      sourceSpaceId: "spc_test",
    });
    const docBodyRows = recorded.filter((c) => c.table === "docBodies").flatMap((c) => c.rows);
    expect(docBodyRows).toEqual([{ nodeId: "nod_live", markdown: "live body\n" }]);
  });

  it("--no-history keeps the current state restorable: unfinished work stays, finished history goes", async () => {
    // The flag used to omit the history tables wholesale, producing an archive
    // that could never be restored — `records.head_commit_id` is a NOT NULL FK
    // into `commits`, so every record dangled (verified end-to-end against a
    // real database). It now fetches everything and prunes afterwards, so the
    // commits the surviving rows still point at are always carried.
    //
    // Shape mirrors the real production space: a merged change request whose
    // staged values are history, and an in-review one that is somebody's
    // unfinished work and must survive intact.
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.bases = [{ id: "bse_1" }];
    tables.records = [{ id: "rec_1", baseId: "bse_1", headCommitId: "cmt_live" }];
    tables.commits = [
      { id: "cmt_live" }, // the record's head — must survive
      { id: "cmt_merged" }, // only a finished CR points here
      { id: "cmt_open" }, // an unfinished CR's operation points here
    ];
    tables.changeRequests = [
      { id: "cr_merged", status: "merged" },
      { id: "cr_open", status: "in_review" },
    ];
    tables.operations = [
      { id: "opr_merged", changeRequestId: "cr_merged", headCommitId: "cmt_merged" },
      { id: "opr_open", changeRequestId: "cr_open", headCommitId: "cmt_open" },
    ];
    tables.fieldValues = [
      // A live cell of a live record. Its `changeRequestId` names the merged CR
      // that produced it — that column must be cleared, not used to drag the
      // finished CR back in.
      {
        id: "fvl_current",
        baseId: "bse_1",
        commitId: "cmt_live",
        recordId: "rec_1",
        changeRequestId: "cr_merged",
        fieldSlug: "a",
      },
      // Staged inside the merged CR — history, dropped.
      {
        id: "fvl_merged_staged",
        baseId: "bse_1",
        commitId: "cmt_merged",
        recordId: null,
        changeRequestId: "cr_merged",
        fieldSlug: "a",
      },
      // Staged inside the unfinished CR — kept.
      {
        id: "fvl_open_staged",
        baseId: "bse_1",
        commitId: "cmt_open",
        recordId: null,
        changeRequestId: "cr_open",
        fieldSlug: "a",
      },
    ];
    tables.reviews = [{ id: "rvw_merged", changeRequestId: "cr_merged" }];
    tables.auditEvents = [{ id: "aud_1", recordId: "rec_1" }];

    const messages: string[] = [];
    const manifest = await exportFull({
      client: createFakeExportClient(tables, {}),
      outPath: archivePath,
      spaceId: "spc_test",
      sourceHost: "http://localhost:15419",
      includeHistory: false,
      toolVersion: "0.1.0-test",
      onProgress: (m) => messages.push(m),
    });

    expect(manifest.tables.records).toBe(1);
    expect(manifest.tables.changeRequests).toBe(1); // only the unfinished one
    expect(manifest.tables.operations).toBe(1);
    expect(manifest.tables.reviews).toBe(0);
    expect(manifest.tables.auditEvents).toBe(0);
    // The record's head commit and the open CR's commit survive; the commit
    // only the merged CR referenced does not.
    expect(manifest.tables.commits).toBe(2);
    // Pruning must leave the archive self-consistent — the FK drift check runs
    // after it as a safety net and must find nothing to complain about.
    expect(messages.some((m) => m.includes("WARNING"))).toBe(false);
    await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

    const recorded: RecordedImport[] = [];
    const result = await importFull({
      client: createFakeImportClient(recorded),
      archivePath,
      sourceSpaceId: "spc_test",
    });
    expect(result).toEqual({ ok: true, warnings: [] });

    const rowsOf = (table: string) =>
      recorded.filter((c) => c.table === table).flatMap((c) => c.rows);
    expect(rowsOf("fieldValues").map((r) => r.id)).toEqual(["fvl_current", "fvl_open_staged"]);
    expect(rowsOf("commits").map((r) => r.id)).toEqual(["cmt_live", "cmt_open"]);
    // The surviving current value no longer points at the dropped merged CR.
    expect(rowsOf("fieldValues").find((r) => r.id === "fvl_current")?.changeRequestId).toBeNull();
  });

  it("downloads attachment blobs concurrently, bounded, and still writes them in order", async () => {
    // The export was strictly one-request-at-a-time: 10,486 attachments x 2
    // sequential round trips each (resolve URL, fetch bytes) is where most of
    // a multi-hour production backup went. Latency, not bandwidth, was the
    // limit. This asserts the three properties that make overlapping them safe
    // — genuinely concurrent, bounded, and order-preserving on the way out.
    const total = 24;
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.attachments = Array.from({ length: total }, (_, i) => ({
      id: `att_${i}`,
      storageKey: `blobs/att_${i}.bin`,
    }));
    tables.assets = Array.from({ length: total }, (_, i) => ({
      id: `ast_${i}`,
      attachmentId: `att_${i}`,
    }));

    let inFlight = 0;
    let peakInFlight = 0;
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Make the first item the slowest, so a strictly-ordered implementation
      // that also serialized the WORK would show a peak of 1. Take the last
      // path segment — stripping every non-digit would fold the port number in
      // (`…:15419/blob/2` -> 154192) and no item would ever match index 0.
      const index = Number(String(input).split("/").pop());
      await settle();
      if (index === 0) await settle();
      inFlight -= 1;
      return new Response(Buffer.from(`bytes-${index}`), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const base = createFakeExportClient(tables, {});
      const exportClient = {
        ...base,
        assets: {
          download: async ({ assetId }: { assetId: string }) => ({
            downloadUrl: `/blob/${assetId.replace("ast_", "")}`,
            mimeType: "application/octet-stream",
          }),
        },
      } as unknown as BusabaseClient;

      const manifest = await exportFull({
        client: exportClient,
        outPath: archivePath,
        spaceId: "spc_test",
        sourceHost: "http://localhost:15419",
        includeHistory: true,
        toolVersion: "0.1.0-test",
      });

      expect(manifest.blobCount).toBe(total);
      // Genuinely overlapping...
      expect(peakInFlight).toBeGreaterThan(1);
      // ...but bounded. Anything higher means the cap isn't being applied and a
      // real 10k-attachment space would open 10k sockets at once.
      expect(peakInFlight).toBeLessThanOrEqual(8);

      // Order preserved despite item 0 finishing last: the archive must not
      // depend on which download happened to win the race.
      const recorded: RecordedImport[] = [];
      await importFull({
        client: createFakeImportClient(recorded),
        archivePath,
        sourceSpaceId: "spc_test",
      });
      const keys = recorded
        .filter((c) => c.table === "attachmentBlobs")
        .flatMap((c) => c.rows)
        .map((r) => r.storageKey);
      expect(keys).toEqual(tables.attachments?.map((a) => a.storageKey));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("--resume reuses blobs a killed run already downloaded, and repairs its half-written last row", async () => {
    // A killed backup leaves `<archive>.attachment-blobs.part` holding the
    // blobs it finished, and — because the process died mid-write — very
    // likely a final line with no trailing newline. Appending to that as-is
    // would splice the next row onto half a row and corrupt the entry, so the
    // file is truncated back to its last complete line first.
    const total = 4;
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.attachments = Array.from({ length: total }, (_, i) => ({
      id: `att_${i}`,
      storageKey: `blobs/att_${i}.bin`,
    }));
    tables.assets = Array.from({ length: total }, (_, i) => ({
      id: `ast_${i}`,
      attachmentId: `att_${i}`,
    }));

    // Pre-seed the spool exactly as a kill would leave it: two complete rows,
    // then a truncated third with no newline.
    const spoolPath = `${archivePath}.attachment-blobs.part`;
    const complete = [0, 1]
      .map((i) =>
        JSON.stringify({
          storageKey: `blobs/att_${i}.bin`,
          mimeType: "application/octet-stream",
          base64: Buffer.from(`recovered-${i}`).toString("base64"),
        }),
      )
      .join("\n");
    writeFileSync(spoolPath, `${complete}\n{"storageKey":"blobs/att_2.bin","base6`);

    const downloaded: string[] = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      // Last path segment, not "strip every non-digit" — the latter would fold
      // the port number into the index (`…:15419/blob/2` -> 154192).
      const index = Number(String(input).split("/").pop());
      downloaded.push(`att_${index}`);
      return new Response(Buffer.from(`fresh-${index}`), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const base = createFakeExportClient(tables, {});
      const exportClient = {
        ...base,
        assets: {
          download: async ({ assetId }: { assetId: string }) => ({
            downloadUrl: `/blob/${assetId.replace("ast_", "")}`,
            mimeType: "application/octet-stream",
          }),
        },
      } as unknown as BusabaseClient;

      const messages: string[] = [];
      const manifest = await exportFull({
        client: exportClient,
        outPath: archivePath,
        spaceId: "spc_test",
        sourceHost: "http://localhost:15419",
        includeHistory: true,
        toolVersion: "0.1.0-test",
        resume: true,
        onProgress: (m) => messages.push(m),
      });

      // The two recovered blobs were NOT re-downloaded; the truncated third and
      // the untouched fourth were.
      expect(downloaded).toEqual(["att_2", "att_3"]);
      expect(messages.some((m) => m.includes("resuming: 2 attachment blob(s)"))).toBe(true);
      expect(manifest.blobCount).toBe(total);
      await expect(verifyArchive(archivePath)).resolves.toEqual(manifest);

      // Every blob is in the archive exactly once, and the recovered ones kept
      // their original bytes rather than being silently replaced.
      const recorded: RecordedImport[] = [];
      await importFull({
        client: createFakeImportClient(recorded),
        archivePath,
        sourceSpaceId: "spc_test",
      });
      const blobs = recorded
        .filter((c) => c.table === "attachmentBlobs")
        .flatMap((c) => c.rows) as Array<{ storageKey: string; base64: string }>;
      expect(blobs.map((b) => b.storageKey)).toEqual([
        "blobs/att_0.bin",
        "blobs/att_1.bin",
        "blobs/att_2.bin",
        "blobs/att_3.bin",
      ]);
      expect(Buffer.from(blobs[0].base64, "base64").toString()).toBe("recovered-0");
      expect(Buffer.from(blobs[2].base64, "base64").toString()).toBe("fresh-2");
      // The spool is cleaned up once it has been folded into the archive.
      expect(existsSync(spoolPath)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * A blob download is two round trips — `assets.download` (an oRPC POST) then
   * the byte transfer (a bare `fetch`) — and NEITHER was retried. The shared
   * `withRetry` refuses to repeat a 5xx on a POST (a repeated mutation could
   * file the same change request twice), and the bare `fetch` never went
   * through that wrapper at all. So one proxy blip on one attachment dropped
   * that attachment, logged a warning, and let the backup report success: a
   * silent hole in a disaster-recovery archive.
   */
  it("retries a blob download that fails once, instead of silently dropping the attachment", async () => {
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.attachments = [{ id: "att_1", storageKey: "blobs/att_1.bin" }];
    tables.assets = [{ id: "ast_1", attachmentId: "att_1" }];

    let byteAttempts = 0;
    const fetchStub = vi.fn(async () => {
      byteAttempts += 1;
      // Fails the first time, succeeds the second — a transient proxy blip.
      if (byteAttempts === 1) return new Response("bad gateway", { status: 502 });
      return new Response(Buffer.from("recovered-bytes"), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const base = createFakeExportClient(tables, {});
      const exportClient = {
        ...base,
        assets: {
          download: async () => ({
            downloadUrl: "/blob/att_1",
            mimeType: "application/octet-stream",
          }),
        },
      } as unknown as BusabaseClient;

      const manifest = await exportFull({
        client: exportClient,
        outPath: archivePath,
        spaceId: "spc_test",
        sourceHost: "http://localhost:15419",
        includeHistory: true,
        toolVersion: "0.1.0-test",
        retries: 1,
      });

      expect(byteAttempts).toBe(2);
      // The blob is IN the archive. Before this, blobCount was 0 and the only
      // trace was a warning line in a multi-hour log.
      expect(manifest.blobCount).toBe(1);

      const recorded: RecordedImport[] = [];
      await importFull({
        client: createFakeImportClient(recorded),
        archivePath,
        sourceSpaceId: "spc_test",
      });
      const blobs = recorded
        .filter((c) => c.table === "attachmentBlobs")
        .flatMap((c) => c.rows) as Array<{ storageKey: string; base64: string }>;
      expect(blobs).toHaveLength(1);
      expect(Buffer.from(blobs[0].base64, "base64").toString()).toBe("recovered-bytes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * `--retries` is the user-facing promise, and until now it bought the backup
   * nothing: it only ever reached the shared fetch wrapper, while the export's
   * own loops used a hard-coded 3. `0` proves the number is genuinely the one
   * in effect — with the old hard-coded constant this would still have retried.
   */
  it("honours --retries 0 by not retrying a blob download at all", async () => {
    const tables: Partial<Record<string, Array<Record<string, unknown>>>> = {};
    for (const table of DumpTableSchema.options) tables[table] = [];
    tables.nodes = [{ id: "nod_root", parentId: null, type: "folder" }];
    tables.attachments = [{ id: "att_1", storageKey: "blobs/att_1.bin" }];
    tables.assets = [{ id: "ast_1", attachmentId: "att_1" }];

    let byteAttempts = 0;
    const fetchStub = vi.fn(async () => {
      byteAttempts += 1;
      return new Response("bad gateway", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchStub);

    try {
      const base = createFakeExportClient(tables, {});
      const exportClient = {
        ...base,
        assets: {
          download: async () => ({
            downloadUrl: "/blob/att_1",
            mimeType: "application/octet-stream",
          }),
        },
      } as unknown as BusabaseClient;

      const manifest = await exportFull({
        client: exportClient,
        outPath: archivePath,
        spaceId: "spc_test",
        sourceHost: "http://localhost:15419",
        includeHistory: true,
        toolVersion: "0.1.0-test",
        retries: 0,
      });

      expect(byteAttempts).toBe(1);
      // Still a skip-with-warning rather than an abort: one unreachable
      // attachment must not throw away the other 10,485.
      expect(manifest.blobCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
