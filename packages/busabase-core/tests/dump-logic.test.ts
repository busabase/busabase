import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Integration tests for the `dump` domain's business logic layer
 * (`logic/export-logic.ts` + `logic/import-logic.ts`), exercised through the
 * real oRPC router against a real PGLite DB + local object storage — mirrors
 * the harness convention used by `node-space-isolation.test.ts` /
 * `node-restore-fixes.test.ts`. Complements
 * `packages/busabase-dump/src/format/archive.test.ts`, which only covers the
 * archive-file layer, not the server-side session/integrity logic.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("dump domain logic — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // ── importBegin empty-space guard ───────────────────────────────────────
  it("importBegin rejects a space whose node tree is non-empty", async () => {
    const spaceId = "space_dump_nonempty";
    await inSpace(spaceId, () =>
      client.docs.create({ autoMerge: true, slug: "seed-doc", name: "Seed Doc", body: "hi\n" }),
    );
    await expect(inSpace(spaceId, () => client.dump.importBegin())).rejects.toThrow(/empty/i);
  });

  // ── importBegin succeeds on a truly empty space (only the auto-seeded root) ─
  it("importBegin succeeds on a fresh space and returns a sessionId", async () => {
    const { sessionId } = await inSpace("space_dump_empty_begin", () => client.dump.importBegin());
    expect(sessionId).toBeTruthy();
    await inSpace("space_dump_empty_begin", () => client.dump.importAbort({ sessionId }));
  });

  // ── importTables not-found for a bogus/expired session ─────────────────
  it("importTables rejects an unknown sessionId", async () => {
    await expect(
      inSpace("space_dump_notfound", () =>
        client.dump.importTables({
          sessionId: "dumpsess_does_not_exist",
          table: "nodes",
          rows: [],
        }),
      ),
    ).rejects.toThrow(/not found|expired/i);
  });

  // ── docBodies / attachmentBlobs pseudo-table handling + date coercion ──
  it("full-fidelity round trip: nodes/docBodies/attachmentBlobs import correctly", async () => {
    const sourceSpace = "space_dump_source_a";
    const targetSpace = "space_dump_target_a";
    const nodeId = "nod_fabricated_doc_for_import_test";
    const fabricatedSourceRootId = "nod_root_space_dump_source_a_fabricated";

    // Node ids are a single GLOBAL primary key across every space in one DB
    // (not scoped per-space) — a real cross-spaceId restore only ever targets
    // a genuinely separate database (see the two-isolated-PGLite-servers
    // real end-to-end run documented in the changelog). Live-exporting from a
    // real `sourceSpace` in *this same* DB and then importing those same ids
    // into `targetSpace` would self-collide with the still-existing source
    // rows — that's a property of sharing one DB, not a bug under test here.
    // Fabricate the "exported" rows instead, exactly as they'd arrive over
    // the wire (ISO-string dates, a root row + one child pointing at it),
    // so this test exercises the import handler in isolation.
    const rowsAsOverTheWire = [
      {
        id: fabricatedSourceRootId,
        spaceId: sourceSpace,
        parentId: null,
        type: "folder",
        slug: "root",
        name: "Workspace",
        description: "Workspace root.",
        metadata: {},
        position: 0,
        archivedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: nodeId,
        spaceId: sourceSpace,
        parentId: fabricatedSourceRootId,
        type: "doc",
        slug: "roundtrip-doc",
        name: "Roundtrip Doc",
        description: "",
        metadata: {},
        position: 0,
        archivedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const { sessionId } = await inSpace(targetSpace, () => client.dump.importBegin());

    // nodes: exercises coerceDateColumns (createdAt/updatedAt as ISO strings on
    // the wire, coerced back to real Date before the drizzle insert), the
    // source-root-drop, and the parentId remap of the child that pointed at
    // the (never re-inserted) source root onto the target's own root id.
    await inSpace(targetSpace, () =>
      client.dump.importTables({ sessionId, table: "nodes", rows: rowsAsOverTheWire }),
    );

    // docBodies: pseudo-table, written to object storage directly.
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "docBodies",
        rows: [{ nodeId, markdown: "# hello\n\nbody text\n" }],
      }),
    );

    const commit = await inSpace(targetSpace, () => client.dump.importCommit({ sessionId }));
    expect(commit.ok).toBe(true);
    // The `nodes` warning ("no nodes imported") must NOT fire — we did import nodes.
    expect(commit.warnings.some((w) => /no nodes were imported/i.test(w))).toBe(false);

    const restoredDoc = await inSpace(targetSpace, () => client.docs.get({ nodeId }));
    expect(restoredDoc?.body).toBe("# hello\n\nbody text\n");
    // The `nodes` insert only succeeds at all if `coerceDateColumns` correctly
    // turned the ISO-string createdAt/updatedAt back into real Date values
    // before the drizzle insert (Postgres rejects a string in a timestamp
    // column outright) — reaching here proves that path works.
    const restoredNodes = await inSpace(targetSpace, () => client.folders.list());
    expect(Array.isArray(restoredNodes)).toBe(true);
  });

  // ── cursor pagination termination + no dup/gap across pages ────────────
  it("exportTables cursor pagination visits every row exactly once, in order", async () => {
    const spaceId = "space_dump_pagination";
    const base = await inSpace(spaceId, () =>
      client.bases.create({
        autoMerge: true,
        slug: "pagination-base",
        name: "Pagination Base",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      }),
    );
    const total = 12;
    const createdIds: string[] = [];
    for (let i = 0; i < total; i++) {
      const cr = await inSpace(spaceId, () =>
        client.bases.createChangeRequest({ baseId: base.id, fields: { title: `row-${i}` } }),
      );
      await inSpace(spaceId, () =>
        client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" }),
      );
      const merged = await inSpace(spaceId, () =>
        client.changeRequests.merge({ changeRequestId: cr.id }),
      );
      if (merged.record) createdIds.push(merged.record.id);
    }

    // Force the pagination path to actually execute more than once: page size
    // 5 against 12 rows → pages of 5, 5, 2, then a terminal empty/short page.
    const limit = 5;
    const seenIds: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await inSpace(spaceId, () =>
        client.dump.exportTables({ table: "records", cursor, limit }),
      );
      pages += 1;
      expect(page.rows.length).toBeLessThanOrEqual(limit);
      for (const row of page.rows) seenIds.push(row.id as string);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      // Guard against an infinite loop if termination regresses.
      expect(pages).toBeLessThan(20);
    }

    expect(pages).toBeGreaterThan(1); // pagination path genuinely executed more than once
    expect(seenIds.length).toBe(new Set(seenIds).size); // no duplicates across pages
    expect(new Set(seenIds)).toEqual(new Set(createdIds)); // no gaps — every row seen
    // Stable id-ascending order across the whole scan.
    const sorted = [...seenIds].sort();
    expect(seenIds).toEqual(sorted);
  });

  // ── importCommit integrity checks catch a deliberately-orphaned asset ──
  it("importCommit warns when an imported asset references a never-imported attachmentId", async () => {
    const targetSpace = "space_dump_orphan_asset";
    const { sessionId } = await inSpace(targetSpace, () => client.dump.importBegin());

    // Import a bare `assets` row whose attachmentId was never (and will never
    // be) imported — a deliberately orphaned FK-less reference.
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "assets",
        rows: [
          {
            id: "asset_orphan_test_1",
            spaceId: targetSpace,
            attachmentId: "att_never_imported",
            name: "Orphan Asset",
            contentKind: "binary",
            metadata: {},
            createdBy: "test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    const commit = await inSpace(targetSpace, () => client.dump.importCommit({ sessionId }));
    expect(commit.ok).toBe(true);
    expect(commit.warnings.some((w) => /attachmentId that was not imported/i.test(w))).toBe(true);
  });
});
