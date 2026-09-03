import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { queryInChunks } from "../src/domains/dump/logic/import-logic";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";

describe("queryInChunks", () => {
  it("batches a large id list instead of passing it to one query — the actual bug reproduced live: committing a real production restore with 1,080,685 fieldValues rows blew the SQL query builder's call stack building one inArray(...) with all of them", async () => {
    const ids = Array.from({ length: 12_345 }, (_, i) => `id_${i}`);
    const seenChunkSizes: number[] = [];
    const rows = await queryInChunks(ids, async (idsChunk) => {
      seenChunkSizes.push(idsChunk.length);
      return idsChunk.map((id) => ({ id }));
    });

    expect(rows).toEqual(ids.map((id) => ({ id })));
    expect(seenChunkSizes.every((size) => size <= 2000)).toBe(true);
    expect(seenChunkSizes.length).toBeGreaterThan(1); // the batching path genuinely ran more than once
  });

  it("makes zero queries for an empty id list", async () => {
    let calls = 0;
    const rows = await queryInChunks([], async () => {
      calls += 1;
      return [];
    });
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });
});

/**
 * Integration tests for the `dump` domain's business logic layer
 * (`logic/export-logic.ts` + `logic/import-logic.ts`), exercised through the
 * real oRPC router against a real PGLite DB + local object storage — mirrors
 * the harness convention used by `node-space-isolation.test.ts` /
 * `node-restore-fixes.test.ts`. Complements
 * `apps/busabase-cli/src/backup/format/archive.test.ts`, which only covers the
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
    await expect(
      inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId })),
    ).rejects.toThrow(/empty/i);
  });

  // ── importBegin succeeds on a truly empty space (only the auto-seeded root) ─
  it("importBegin succeeds on a fresh space and returns a sessionId", async () => {
    const { sessionId } = await inSpace("space_dump_empty_begin", () =>
      client.dump.importBegin({ sourceSpaceId: "space_dump_empty_begin" }),
    );
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
    // A real archive's root row always has this exact deterministic id (the
    // server now computes it from `sourceSpaceId` rather than scanning rows
    // for "the one with a null parentId" — see the matching comment in
    // import-logic.ts) — fabricate the same id a real export would produce,
    // not an arbitrary one, or this test would exercise a shape no real
    // archive can ever have.
    const fabricatedSourceRootId = rootNodeIdForSpace(sourceSpace);

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

    const { sessionId } = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: sourceSpace }),
    );

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

    const restoredDoc = await inSpace(targetSpace, () => client.nodes.get({ nodeId, type: "doc" }));
    expect(restoredDoc?.body).toBe("# hello\n\nbody text\n");
    // The `nodes` insert only succeeds at all if `coerceDateColumns` correctly
    // turned the ISO-string createdAt/updatedAt back into real Date values
    // before the drizzle insert (Postgres rejects a string in a timestamp
    // column outright) — reaching here proves that path works.
    const restoredNodes = await inSpace(targetSpace, () =>
      client.nodes.list({ types: ["folder"] }),
    );
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
      const merged = await inSpace(spaceId, () =>
        client.bases.createChangeRequest({
          baseId: base.id,
          fields: { title: `row-${i}` },
          autoMerge: true,
        }),
      );
      if ("materialized" in merged && merged.materialized) createdIds.push(merged.id);
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
    const { sessionId } = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: targetSpace }),
    );

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

  // ── nodePrincipals: cross-space restore remaps a "space" grant's principalId ─
  it("importTables remaps a principalType:'space' grant's principalId to the target space", async () => {
    const sourceSpace = "space_dump_np_source";
    const targetSpace = "space_dump_np_target";
    // Must be the real deterministic root id a genuine export would produce —
    // see the matching note on the earlier fabricated-root test above.
    const sourceRootId = rootNodeIdForSpace(sourceSpace);
    const folderId = "nod_np_folder_child";

    const { sessionId } = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: sourceSpace }),
    );

    // A source root + one child folder, exactly as they'd arrive over the wire.
    // The importer drops the source root and remaps the child onto the target's
    // own root (same path the round-trip test exercises).
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "nodes",
        rows: [
          {
            id: sourceRootId,
            spaceId: sourceSpace,
            parentId: null,
            type: "folder",
            slug: "root",
            name: "Workspace",
            description: "",
            metadata: {},
            position: 0,
            effectiveVisibility: null,
            archivedAt: null,
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: folderId,
            spaceId: sourceSpace,
            parentId: sourceRootId,
            type: "folder",
            slug: "shared-folder",
            name: "Shared Folder",
            description: "",
            metadata: {},
            position: 0,
            effectiveVisibility: null,
            archivedAt: null,
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    // Two grants on the folder: a "space" grant (everyone in the SOURCE space —
    // principalId is the source space id) and a "user" grant. On restore the
    // space grant must move to the target space; the user grant is untouched.
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "nodePrincipals",
        rows: [
          {
            id: "nprin_space_grant",
            spaceId: sourceSpace,
            nodeId: folderId,
            sourceNodeId: folderId,
            principalType: "space",
            principalId: sourceSpace,
            role: "read",
            grantedBy: "local-user",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "nprin_user_grant",
            spaceId: sourceSpace,
            nodeId: folderId,
            sourceNodeId: folderId,
            principalType: "user",
            principalId: "usr_specific_person",
            role: "write",
            grantedBy: "local-user",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );

    await inSpace(targetSpace, () => client.dump.importCommit({ sessionId }));

    const principals = await inSpace(targetSpace, () =>
      client.nodes.principals.list({ nodeId: folderId }),
    );
    const spaceGrant = principals.find((p) => p.principalType === "space");
    const userGrant = principals.find((p) => p.principalType === "user");

    // The "everyone in the space" grant now names the TARGET space, not the source.
    expect(spaceGrant?.principalId).toBe(targetSpace);
    // The user grant's opaque id is space-independent — left exactly as-is.
    expect(userGrant?.principalId).toBe("usr_specific_person");
    expect(userGrant?.role).toBe("write");
  });

  // ── exportDocBodies reaches an ARCHIVED Doc, which nodes.get refuses ───
  it("exportDocBodies returns the body of an ARCHIVED Doc — the body nodes.get refuses to serve", async () => {
    // Reproduces a real production data-loss bug. `nodes.get({ type: "doc" })`
    // deliberately 404s on an archived node (Trash is a separate,
    // metadata-only read path), but the raw `nodes` table dump includes
    // archived rows by design. The exporter read bodies through `nodes.get`,
    // so every archived Doc was skipped with a warning: 75 of 88 bodies on the
    // real Vika Team space, all of which restored back EMPTY. A dump route has
    // to see the whole table, exactly like `exportTables` does.
    const spaceId = "space_dump_archived_doc";
    const approveAndMerge = (changeRequestId: string) =>
      inSpace(spaceId, () =>
        client.changeRequests
          .review({ changeRequestIds: [changeRequestId], verdict: "approved" })
          .then(() => client.changeRequests.merge({ changeRequestIds: [changeRequestId] })),
      );

    const liveDoc = await inSpace(spaceId, () =>
      client.docs.create({
        autoMerge: true,
        slug: "still-live",
        name: "Still Live",
        body: "live body\n",
      }),
    );
    const archivedDoc = await inSpace(spaceId, () =>
      client.docs.create({
        autoMerge: true,
        slug: "about-to-be-archived",
        name: "About To Be Archived",
        body: "# Archived\n\nContent that must survive a backup.\n",
      }),
    );

    // Archive it through the real path (a merged node-delete change request),
    // not by poking `archivedAt` — the point is that a genuinely archived Doc
    // behaves this way, not that a hand-set column does.
    const cr = await inSpace(spaceId, () =>
      client.nodes.createChangeRequest({
        operations: [{ kind: "delete", nodeId: archivedDoc.node.id }],
        autoMerge: false,
      }),
    );
    await approveAndMerge(cr.id);

    // Precondition: the ordinary read path really does refuse it. If this ever
    // starts succeeding, the bug this route exists for is gone and the comment
    // above is stale — better to fail loudly than to keep a route nobody needs.
    await expect(
      inSpace(spaceId, () => client.nodes.get({ nodeId: archivedDoc.node.id, type: "doc" })),
    ).rejects.toThrow();

    const { bodies } = await inSpace(spaceId, () =>
      client.dump.exportDocBodies({ nodeIds: [liveDoc.node.id, archivedDoc.node.id] }),
    );
    const byId = new Map(bodies.map((b) => [b.nodeId, b.markdown]));
    expect(byId.get(archivedDoc.node.id)).toBe(
      "# Archived\n\nContent that must survive a backup.\n",
    );
    expect(byId.get(liveDoc.node.id)).toBe("live body\n");
  });

  // ── exportDocBodies is space-scoped and Doc-scoped ────────────────────
  it("exportDocBodies omits an id belonging to another space rather than reading its body", async () => {
    // The route reads object storage by a key derived from a caller-supplied
    // id, so "is this a Doc in MY space" is load-bearing, not cosmetic — the
    // same reason `exportTableRows`'s spaceId filter is.
    const victimSpace = "space_dump_docs_victim";
    const attackerSpace = "space_dump_docs_attacker";
    const victimDoc = await inSpace(victimSpace, () =>
      client.docs.create({
        autoMerge: true,
        slug: "private-doc",
        name: "Private Doc",
        body: "secrets\n",
      }),
    );

    const { bodies } = await inSpace(attackerSpace, () =>
      client.dump.exportDocBodies({ nodeIds: [victimDoc.node.id] }),
    );
    expect(bodies).toEqual([]);
  });

  // ── fieldValues FK violation surfaces a clear CONFLICT, not a raw 500 ──
  it("importTables rejects a fieldValues row whose recordId this archive doesn't carry with a clear CONFLICT, not a raw FK crash", async () => {
    // Reproduces a real production incident: a backup of an actively-used
    // space took over an hour. `records` is fetched (and snapshotted) long
    // before the much larger `fieldValues` table finishes — a record created
    // live in that gap was captured by `fieldValues` (id-paged, not
    // creation-time-ordered, so not confined to the tail) but missed by the
    // earlier `records` snapshot. The resulting archive restored ~1.1M
    // fieldValues rows successfully and then failed on the very last batch
    // with a raw, undiagnosable "Internal server error" — a genuine Postgres
    // FK violation on `fieldValues.recordId`. `full-roundtrip.test.ts`
    // already proves the export-side fix (drop-with-warning) works; this
    // covers the import-side fix for an archive that predates that fix (or
    // any FK gap it doesn't catch) — it must fail with a clear, actionable
    // message instead of an opaque crash.
    const targetSpace = "space_dump_fk_violation";
    const nodeId = "nod_fk_violation_base_node";
    const baseId = "bse_fk_violation";
    const commitId = "cmt_fk_violation";

    const { sessionId } = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: targetSpace }),
    );

    const rootId = rootNodeIdForSpace(targetSpace);
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "nodes",
        rows: [
          {
            id: nodeId,
            spaceId: targetSpace,
            parentId: rootId,
            type: "base",
            slug: "fk-violation-base",
            name: "FK Violation Base",
            description: "",
            metadata: {},
            position: 0,
            archivedAt: null,
            deletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "bases",
        rows: [
          {
            id: baseId,
            spaceId: targetSpace,
            nodeId,
            slug: "fk-violation-base",
            name: "FK Violation Base",
            description: "",
            reviewPolicy: { kind: "single", requiredApprovals: 1 },
            createdAt: new Date().toISOString(),
            archivedAt: null,
            deletedAt: null,
          },
        ],
      }),
    );
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "commits",
        rows: [
          {
            id: commitId,
            spaceId: targetSpace,
            baseId,
            targetType: "base",
            nodeId: null,
            operationId: null,
            parentCommitId: null,
            payload: {},
            operation: "record_create",
            message: "",
            author: "test",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );

    // Deliberately DO NOT import a `records` row for "rec_never_exported" —
    // this is the exact gap the production incident hit: a fieldValues row
    // referencing a record this archive never carries.
    await expect(
      inSpace(targetSpace, () =>
        client.dump.importTables({
          sessionId,
          table: "fieldValues",
          rows: [
            {
              id: "fvl_fk_violation",
              spaceId: targetSpace,
              baseId,
              commitId,
              recordId: "rec_never_exported",
              changeRequestId: null,
              operationId: null,
              fieldId: null,
              fieldSlug: "title",
              fieldType: "text",
              valueText: "orphaned",
              valueNumber: null,
              valueBool: null,
              valueDate: null,
              valueJson: null,
              valueHash: null,
              deletedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    ).rejects.toThrow(/does not carry|kept changing while a long backup/i);
  });

  // ── resume: continue an interrupted restore instead of demanding empty ─
  it("resume continues a killed restore: non-empty space accepted, existing rows skipped, no rollback", async () => {
    // A restore that FAILS rolls itself back, so a plain re-run works. What
    // cannot roll back is a restore whose PROCESS died — Ctrl-C, OOM, a
    // dropped connection. That leaves the space holding however many rows had
    // landed, and every later attempt was refused ("requires an empty target
    // space") with no way forward except wiping it. `--resume` is that way
    // forward.
    const targetSpace = "space_dump_resume";
    const rootId = rootNodeIdForSpace(targetSpace);
    const nodeRow = (i: number) => ({
      id: `nod_resume_${i}`,
      spaceId: targetSpace,
      parentId: rootId,
      type: "folder",
      slug: `resume-${i}`,
      name: `Resume ${i}`,
      description: "",
      metadata: {},
      position: i,
      archivedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // First attempt lands two nodes, then its process "dies" — no commit, no
    // abort, session simply abandoned.
    const first = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: targetSpace }),
    );
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "nodes",
        rows: [nodeRow(0), nodeRow(1)],
      }),
    );

    // Without --resume the space is now un-restorable, and the error says what to do.
    await expect(
      inSpace(targetSpace, () => client.dump.importBegin({ sourceSpaceId: targetSpace })),
    ).rejects.toThrow(/--resume/);

    // With it, the same archive replays: the two existing rows are skipped
    // rather than colliding, and the third lands.
    const second = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: targetSpace, resume: true }),
    );
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId: second.sessionId,
        table: "nodes",
        rows: [nodeRow(0), nodeRow(1), nodeRow(2)],
      }),
    );

    const afterResume = await inSpace(targetSpace, () => client.nodes.list({ types: ["folder"] }));
    expect(afterResume.filter((n) => n.slug.startsWith("resume-"))).toHaveLength(3);

    // Aborting a resumed session must NOT roll back — it would delete the
    // progress this run recovered while leaving the killed run's rows behind,
    // moving the restore backwards.
    await inSpace(targetSpace, () => client.dump.importAbort({ sessionId: second.sessionId }));
    const afterAbort = await inSpace(targetSpace, () => client.nodes.list({ types: ["folder"] }));
    expect(afterAbort.filter((n) => n.slug.startsWith("resume-"))).toHaveLength(3);
  });

  // ── resume must not silently skip everything when ids live elsewhere ──
  it("resume refuses when the archive's ids already belong to a DIFFERENT space", async () => {
    // Caught by real end-to-end verification, not by the test above: dump ids
    // are a single GLOBAL primary key, not scoped per space. The first
    // implementation used a blanket `onConflictDoNothing()`, so restoring into
    // a second space while the SOURCE space was still live in the same
    // database made every replayed row collide with its own original — the
    // whole archive was skipped and the restore reported success over a space
    // that stayed empty. Silently doing nothing is the worst possible outcome
    // for a restore, so this must be an error.
    const liveSpace = "space_dump_resume_live";
    const otherSpace = "space_dump_resume_other";
    const nodeId = "nod_resume_collision";
    const row = (spaceId: string) => ({
      id: nodeId,
      spaceId,
      parentId: rootNodeIdForSpace(spaceId),
      type: "folder",
      slug: "collision",
      name: "Collision",
      description: "",
      metadata: {},
      position: 0,
      archivedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // The id lands in `liveSpace` first — as if that space were still live.
    const first = await inSpace(liveSpace, () =>
      client.dump.importBegin({ sourceSpaceId: liveSpace }),
    );
    await inSpace(liveSpace, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "nodes",
        rows: [row(liveSpace)],
      }),
    );
    await inSpace(liveSpace, () => client.dump.importCommit({ sessionId: first.sessionId }));

    // Now resume the same archive into a different space. The row "exists", but
    // it belongs to somebody else — that must be reported, never skipped.
    const second = await inSpace(otherSpace, () =>
      client.dump.importBegin({ sourceSpaceId: liveSpace, resume: true }),
    );
    await expect(
      inSpace(otherSpace, () =>
        client.dump.importTables({
          sessionId: second.sessionId,
          table: "nodes",
          rows: [row(liveSpace)],
        }),
      ),
    ).rejects.toThrow(/already exist in a DIFFERENT space/);
  });

  // ── importAbort deletes in chunks, not one round trip per row ─────────
  it("importAbort removes every inserted row without issuing one DELETE per id", async () => {
    // A restore of the validated production space inserts 1,473,822 rows, so
    // the old per-row `delete().where(eq(id))` loop meant that many sequential
    // round trips to undo it — hours, on the error path that runs precisely
    // when a restore has already gone wrong. Chunked `inArray` does it in
    // `ceil(n / 2000)` statements instead.
    const targetSpace = "space_dump_abort_bulk";
    const { sessionId } = await inSpace(targetSpace, () =>
      client.dump.importBegin({ sourceSpaceId: targetSpace }),
    );

    const rootId = rootNodeIdForSpace(targetSpace);
    const total = 25;
    await inSpace(targetSpace, () =>
      client.dump.importTables({
        sessionId,
        table: "nodes",
        rows: Array.from({ length: total }, (_, i) => ({
          id: `nod_abort_bulk_${i}`,
          spaceId: targetSpace,
          parentId: rootId,
          type: "folder",
          slug: `abort-bulk-${i}`,
          name: `Abort Bulk ${i}`,
          description: "",
          metadata: {},
          position: i,
          archivedAt: null,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      }),
    );

    const before = await inSpace(targetSpace, () => client.nodes.list({ types: ["folder"] }));
    expect(before.filter((n) => n.slug.startsWith("abort-bulk-"))).toHaveLength(total);

    await inSpace(targetSpace, () => client.dump.importAbort({ sessionId }));

    // Every row this session inserted is gone — the chunked delete must not
    // silently skip a partial final chunk.
    const after = await inSpace(targetSpace, () => client.nodes.list({ types: ["folder"] }));
    expect(after.filter((n) => n.slug.startsWith("abort-bulk-"))).toHaveLength(0);
  });

  // ── admin gate: full-fidelity dump is a space owner/admin operation ────────
  // `dump.exportTables` is a raw table scan that bypasses node ACLs, so a
  // non-manager member could otherwise exfiltrate private nodes. The guard reads
  // the host-injected `isSpaceManager` (busabase-cloud sets it from the real
  // owner/admin role; OSS leaves it unset = manager, so the CLI is unaffected).
  describe("admin gate (isSpaceManager)", () => {
    const asRole = <T>(
      spaceId: string,
      isSpaceManager: boolean | undefined,
      fn: () => Promise<T>,
    ): Promise<T> => runWithBusabaseContext({ spaceId, isSpaceManager }, fn);

    it("a non-manager is FORBIDDEN from exporting (no ACL-bypassing exfiltration)", async () => {
      await expect(
        asRole("space_dump_guard", false, () =>
          client.dump.exportTables({ table: "records", limit: 10 }),
        ),
      ).rejects.toThrow(/owner\/admin|access|forbidden/i);
    });

    it("a non-manager is FORBIDDEN from starting an import", async () => {
      await expect(
        asRole("space_dump_guard", false, () =>
          client.dump.importBegin({ sourceSpaceId: "space_dump_guard" }),
        ),
      ).rejects.toThrow(/owner\/admin|access|forbidden/i);
    });

    it("a manager (isSpaceManager: true) may export", async () => {
      const page = await asRole("space_dump_guard_mgr", true, () =>
        client.dump.exportTables({ table: "records", limit: 10 }),
      );
      expect(Array.isArray(page.rows)).toBe(true);
    });

    it("an unset role (OSS / CLI default) is treated as manager and may export", async () => {
      const page = await asRole("space_dump_guard_oss", undefined, () =>
        client.dump.exportTables({ table: "records", limit: 10 }),
      );
      expect(Array.isArray(page.rows)).toBe(true);
    });
  });
});
