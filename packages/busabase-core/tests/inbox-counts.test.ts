import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import {
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseOperations,
} from "../src/db/schema";
import { filterVisibleChangeRequestRows } from "../src/logic/cr-lifecycle";
import { busabaseRouter } from "../src/router";

/**
 * Inbox tab badge counts.
 *
 * `countChangeRequests` has two code paths: a space manager sees everything, so
 * the badges come from a SQL aggregate; a non-manager's visibility depends on
 * each change request's node scope, so that path still walks the table and
 * filters. The whole point of the aggregate is that it is EQUIVALENT — this
 * pins that, because a counting fast path that quietly disagrees with the slow
 * one shows the user wrong badges with no error anywhere.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MINE = "local-editor";
const OTHER = "local-producer";
const EXTRA_PENDING = 80;
const HIGH_FANOUT_OPERATIONS = 1_000;
const ACL_BATCH_BOUNDARY_TOTAL = 5_001;
const FIXTURE_INSERT_BATCH_SIZE = 1_000;

describe("inbox counts", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let baseNodeId = "";
  let highFanoutChangeRequestId = "";

  const insertPendingRows = async (count: number, prefix: string) => {
    const db = await getDb();
    const rows = Array.from({ length: count }, (_, index) => {
      const suffix = `${prefix}-${index}`;
      return {
        changeRequestId: `cr-${suffix}`,
        commitId: `cmt-${suffix}`,
        operationId: `op-${suffix}`,
      };
    });
    for (let offset = 0; offset < rows.length; offset += FIXTURE_INSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + FIXTURE_INSERT_BATCH_SIZE);
      await db.insert(busabaseChangeRequests).values(
        batch.map(({ changeRequestId }) => ({
          id: changeRequestId,
          spaceId: LOCAL_SPACE_ID,
          baseId,
          status: "in_review" as const,
          submittedBy: OTHER,
        })),
      );
      await db.insert(busabaseCommits).values(
        batch.map(({ commitId, operationId }) => ({
          id: commitId,
          spaceId: LOCAL_SPACE_ID,
          baseId,
          operationId,
          payload: {},
          operation: "record_create" as const,
          author: OTHER,
        })),
      );
      await db.insert(busabaseOperations).values(
        batch.map(({ changeRequestId, commitId, operationId }) => ({
          id: operationId,
          spaceId: LOCAL_SPACE_ID,
          changeRequestId,
          baseId,
          operation: "record_create" as const,
          headCommitId: commitId,
          position: 0,
        })),
      );
    }
    return rows.map((row) => row.changeRequestId);
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-counts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-counts-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "inbox-counts",
      name: "Inbox Counts",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
    baseNodeId = base.nodeId;

    const propose = async (name: string, submittedBy: string) =>
      (
        await client.bases.createChangeRequest({
          baseId,
          fields: { name },
          submittedBy,
          autoMerge: false,
        })
      ).id;

    // A deliberately uneven spread so a bug that conflates two statuses, or
    // drops the "mine" scoping, cannot coincidentally produce right numbers.
    for (let i = 0; i < 7; i++) await propose(`pending-${i}`, OTHER);
    for (let i = 0; i < 3; i++) await propose(`pending-mine-${i}`, MINE);

    for (let i = 0; i < 4; i++) {
      const id = await propose(`merged-${i}`, OTHER);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [id] });
    }
    for (let i = 0; i < 2; i++) {
      const id = await propose(`merged-mine-${i}`, MINE);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [id] });
    }

    for (let i = 0; i < 5; i++) {
      const id = await propose(`approved-${i}`, OTHER);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    }
    for (let i = 0; i < 6; i++) {
      const id = await propose(`closed-${i}`, OTHER);
      await client.changeRequests.close({ changeRequestId: id } as never);
    }

    const highFanout = await client.bases.createBulkChangeRequest({
      baseId,
      records: Array.from({ length: HIGH_FANOUT_OPERATIONS }, (_, index) => ({
        name: `bulk-${index}`,
      })),
      message: "High-fanout ACL regression",
      submittedBy: OTHER,
      autoMerge: false,
    });
    highFanoutChangeRequestId = highFanout.id;

    // Cross the former 100-row count batch boundary without paying for 80
    // complete review-first write cycles in this read-path integration test.
    await insertPendingRows(EXTRA_PENDING, "inbox-counts-extra");
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts every status across the whole space, not just one page", async () => {
    const counts = await client.changeRequests.counts({} as never);
    expect(counts).toEqual({
      // 7 + 3 seeded individually, one 1,000-operation bulk CR, plus direct fixtures.
      review: 11 + EXTRA_PENDING,
      changes: 0,
      created: 5, // 3 pending-mine + 2 merged-mine
      approved: 5,
      // 4 + 2 seeded, plus the change request that creating the Base itself
      // merged (`bases.create({ autoMerge: true })` goes through the same
      // review-first pipeline — there is no back door that writes without one).
      merged: 7,
      rejected: 6,
    });
  });

  it("the badge totals agree with what each tab's list actually returns", async () => {
    const counts = await client.changeRequests.counts({} as never);
    const walk = async (input: Record<string, unknown>) => {
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await client.changeRequests.list({ ...input, limit: 5, cursor } as never);
        for (const cr of page.changeRequests) seen.add(cr.id);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return seen.size;
    };
    expect(await walk({ status: ["in_review"] })).toBe(counts.review);
    expect(await walk({ status: ["approved"] })).toBe(counts.approved);
    expect(await walk({ status: ["merged"] })).toBe(counts.merged);
    expect(await walk({ status: ["rejected", "abandoned"] })).toBe(counts.rejected);
    expect(await walk({ mine: true })).toBe(counts.created);
  });

  // The load-bearing one. The manager path is a SQL aggregate; the non-manager
  // path walks and filters. On a space where everything is visible to both they
  // must produce identical badges — otherwise the fast path is not an
  // optimisation, it is a second, disagreeing implementation.
  it("manager aggregate and non-manager walk agree on a fully visible space", async () => {
    const asManager = await client.changeRequests.counts({} as never);
    const asMember = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MINE,
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      () => client.changeRequests.counts({} as never),
    );
    expect(asMember).toEqual(asManager);
  });

  it("scans candidates and operation scopes once beyond the old batch boundary", async () => {
    const db = await getDb();
    const selectSpy = vi.spyOn(db, "select");
    const selectDistinctSpy = vi.spyOn(db, "selectDistinct");
    try {
      const counts = await runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: MINE,
          isSpaceManager: false,
          permissionLevel: "manage",
        },
        () => client.changeRequests.counts({} as never),
      );

      const selectionKeys = selectSpy.mock.calls.map(([selection]) =>
        Object.keys(selection ?? {})
          .sort()
          .join(","),
      );
      expect(selectionKeys.filter((keys) => keys === "id,status,submittedBy")).toHaveLength(1);
      expect(
        selectionKeys.filter(
          (keys) => keys === "baseId,changeRequestId,headCommitId,operation,position",
        ),
      ).toHaveLength(1);
      const distinctSelectionKeys = selectDistinctSpy.mock.calls.map(([selection]) =>
        Object.keys(selection ?? {})
          .sort()
          .join(","),
      );
      expect(
        distinctSelectionKeys.filter((keys) => keys === "changeRequestId,nodeId"),
      ).toHaveLength(1);
      expect(
        selectionKeys.filter(
          (keys) => keys === "baseId,changeRequestId,headCommitId,nodeId,operation,position",
        ),
      ).toHaveLength(0);
      expect(counts.review).toBe(11 + EXTRA_PENDING);
    } finally {
      selectSpy.mockRestore();
      selectDistinctSpy.mockRestore();
    }
  });

  it("collapses 1,000 Base operations to one direct scope without reading commit hints", async () => {
    const db = await getDb();
    const selectSpy = vi.spyOn(db, "select");
    const selectDistinctSpy = vi.spyOn(db, "selectDistinct");
    try {
      const visibleRows = await runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: MINE,
          isSpaceManager: false,
          permissionLevel: "manage",
        },
        () => filterVisibleChangeRequestRows([{ id: highFanoutChangeRequestId }]),
      );

      const selectionKeys = selectSpy.mock.calls.map(([selection]) =>
        Object.keys(selection ?? {})
          .sort()
          .join(","),
      );
      expect(
        selectionKeys.filter(
          (keys) => keys === "baseId,changeRequestId,headCommitId,operation,position",
        ),
      ).toHaveLength(1);
      expect(
        selectDistinctSpy.mock.calls.filter(
          ([selection]) =>
            Object.keys(selection ?? {})
              .sort()
              .join(",") === "changeRequestId,nodeId",
        ),
      ).toHaveLength(1);
      const directScopes = await db
        .selectDistinct({
          changeRequestId: busabaseOperations.changeRequestId,
          nodeId: busabaseBases.nodeId,
        })
        .from(busabaseOperations)
        .innerJoin(
          busabaseBases,
          and(
            eq(busabaseBases.id, busabaseOperations.baseId),
            eq(busabaseBases.spaceId, LOCAL_SPACE_ID),
          ),
        )
        .where(
          and(
            eq(busabaseOperations.spaceId, LOCAL_SPACE_ID),
            eq(busabaseOperations.changeRequestId, highFanoutChangeRequestId),
          ),
        );
      expect(directScopes).toHaveLength(1);
      expect(directScopes[0]?.changeRequestId).toBe(highFanoutChangeRequestId);
      expect(
        selectionKeys.filter((keys) => keys === "id,parentNodeId,parentNodeRef,ref"),
      ).toHaveLength(0);
      expect(visibleRows).toEqual([{ id: highFanoutChangeRequestId }]);
    } finally {
      selectSpy.mockRestore();
      selectDistinctSpy.mockRestore();
    }
  });

  it("keeps list, detail, and counts aligned for the 1,000-operation change request", async () => {
    const result = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MINE,
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      async () => {
        const [page, detail, counts] = await Promise.all([
          client.changeRequests.list({ status: ["in_review"], limit: 100 } as never),
          client.changeRequests.get({ changeRequestId: highFanoutChangeRequestId } as never),
          client.changeRequests.counts({} as never),
        ]);
        return { page, detail, counts };
      },
    );

    const listRow = result.page.changeRequests.find(
      (changeRequest) => changeRequest.id === highFanoutChangeRequestId,
    );
    expect(listRow?.operationCount).toBe(HIGH_FANOUT_OPERATIONS);
    expect(result.detail?.operationCount).toBe(HIGH_FANOUT_OPERATIONS);
    expect(result.detail?.operations).toHaveLength(HIGH_FANOUT_OPERATIONS);
    expect(result.counts.review).toBe(11 + EXTRA_PENDING);
  });

  it("preserves multi-node, root, temp-ref, unresolved, empty, and tenant ACL semantics", async () => {
    const db = await getDb();
    const secondBase = await client.bases.create({
      slug: "inbox-scope-second",
      name: "Inbox Scope Second",
      autoMerge: true,
    });
    const otherSpaceBase = await runWithBusabaseContext(
      {
        spaceId: "spc_inbox_scope_other",
        actorId: "other-owner",
        isSpaceManager: true,
        permissionLevel: "manage",
      },
      () =>
        client.bases.create({
          slug: "inbox-scope-other",
          name: "Inbox Scope Other",
          autoMerge: true,
        }),
    );
    const multiNode = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        { kind: "rename", nodeId: baseNodeId, name: "Inbox Counts Renamed" },
        { kind: "rename", nodeId: secondBase.nodeId, name: "Inbox Scope Second Renamed" },
      ],
    });
    const rootCreate = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          nodeType: "folder",
          slug: "inbox-root-scope",
          name: "Inbox Root Scope",
        },
      ],
    });
    const tempRefCreate = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          ref: "parent",
          nodeType: "folder",
          slug: "inbox-temp-parent",
          name: "Inbox Temp Parent",
        },
        {
          kind: "create",
          parentNodeRef: "parent",
          nodeType: "folder",
          slug: "inbox-temp-child",
          name: "Inbox Temp Child",
        },
      ],
    });

    const rawRows = [
      {
        changeRequestId: "cr-inbox-scope-unresolved",
        commitId: "cmt-inbox-scope-unresolved",
        operationId: "op-inbox-scope-unresolved",
        spaceId: LOCAL_SPACE_ID,
        baseId: null,
        operation: "node_rename" as const,
      },
      {
        changeRequestId: "cr-inbox-scope-cross-space-base",
        commitId: "cmt-inbox-scope-cross-space-base",
        operationId: "op-inbox-scope-cross-space-base",
        spaceId: LOCAL_SPACE_ID,
        baseId: otherSpaceBase.id,
        operation: "record_create" as const,
      },
      {
        changeRequestId: "cr-inbox-scope-other-space",
        commitId: "cmt-inbox-scope-other-space",
        operationId: "op-inbox-scope-other-space",
        spaceId: "spc_inbox_scope_other",
        baseId,
        operation: "record_create" as const,
      },
    ];
    await db.insert(busabaseChangeRequests).values([
      ...rawRows.map((row) => ({
        id: row.changeRequestId,
        spaceId: row.spaceId,
        baseId: row.baseId,
        targetType: row.baseId ? ("base" as const) : ("node" as const),
        status: "abandoned" as const,
        submittedBy: OTHER,
      })),
      {
        id: "cr-inbox-scope-empty",
        spaceId: LOCAL_SPACE_ID,
        targetType: "node" as const,
        status: "abandoned" as const,
        submittedBy: OTHER,
      },
    ]);
    await db.insert(busabaseCommits).values(
      rawRows.map((row) => ({
        id: row.commitId,
        spaceId: row.spaceId,
        baseId: row.baseId,
        operationId: row.operationId,
        payload: {},
        operation: row.operation,
        author: OTHER,
      })),
    );
    await db.insert(busabaseOperations).values(
      rawRows.map((row) => ({
        id: row.operationId,
        spaceId: row.spaceId,
        changeRequestId: row.changeRequestId,
        baseId: row.baseId,
        operation: row.operation,
        headCommitId: row.commitId,
        position: 0,
      })),
    );

    const candidateIds = [
      multiNode.id,
      rootCreate.id,
      tempRefCreate.id,
      ...rawRows.map((row) => row.changeRequestId),
      "cr-inbox-scope-empty",
    ];
    const visibleIds = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MINE,
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      async () =>
        new Set(
          (await filterVisibleChangeRequestRows(candidateIds.map((id) => ({ id })))).map(
            (row) => row.id,
          ),
        ),
    );
    expect(visibleIds).toEqual(new Set([multiNode.id, rootCreate.id, tempRefCreate.id]));

    await client.nodes.updateVisibility({ nodeId: secondBase.nodeId, visibility: "private" });
    const hiddenMultiNode = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MINE,
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      () => filterVisibleChangeRequestRows([{ id: multiNode.id }]),
    );
    expect(hiddenMultiNode).toEqual([]);
    await client.nodes.updateVisibility({ nodeId: secondBase.nodeId, visibility: null });

    for (const changeRequestId of [multiNode.id, rootCreate.id, tempRefCreate.id]) {
      await client.changeRequests.close({ changeRequestId } as never);
    }
  });

  it("caps each operation scope query at 5,000 change requests", async () => {
    const db = await getDb();
    const existingRows = await db
      .select({ id: busabaseChangeRequests.id })
      .from(busabaseChangeRequests)
      .where(eq(busabaseChangeRequests.spaceId, LOCAL_SPACE_ID));
    const overflowRows = ACL_BATCH_BOUNDARY_TOTAL - existingRows.length;
    expect(overflowRows).toBeGreaterThan(0);
    await insertPendingRows(overflowRows, "inbox-counts-overflow");

    const selectSpy = vi.spyOn(db, "select");
    const selectDistinctSpy = vi.spyOn(db, "selectDistinct");
    try {
      const counts = await runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: MINE,
          isSpaceManager: false,
          permissionLevel: "manage",
        },
        () => client.changeRequests.counts({} as never),
      );

      const selectionKeys = selectSpy.mock.calls.map(([selection]) =>
        Object.keys(selection ?? {})
          .sort()
          .join(","),
      );
      expect(selectionKeys.filter((keys) => keys === "id,status,submittedBy")).toHaveLength(1);
      expect(
        selectionKeys.filter(
          (keys) => keys === "baseId,changeRequestId,headCommitId,operation,position",
        ),
      ).toHaveLength(2);
      const distinctSelectionKeys = selectDistinctSpy.mock.calls.map(([selection]) =>
        Object.keys(selection ?? {})
          .sort()
          .join(","),
      );
      expect(
        distinctSelectionKeys.filter((keys) => keys === "changeRequestId,nodeId"),
      ).toHaveLength(2);
      expect(counts.review).toBe(11 + EXTRA_PENDING + overflowRows);
    } finally {
      selectSpy.mockRestore();
      selectDistinctSpy.mockRestore();
    }
  });
});
