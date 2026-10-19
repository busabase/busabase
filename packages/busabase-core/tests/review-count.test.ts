import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MEMBER = "review-count-member";
const OTHER_SPACE = "review-count-other-space";
const HISTORICAL_ROWS = 2_000;

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const asMember = <T>(fn: () => Promise<T>, actorId = MEMBER, spaceId = LOCAL_SPACE_ID) =>
  runWithBusabaseContext(
    { spaceId, actorId, isSpaceManager: false, permissionLevel: "manage" },
    fn,
  );

describe("pending review badge count", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let visibleNodeId = "";
  let hiddenNodeId = "";
  let pendingIds: string[];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-review-count-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-review-count-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const visible = await client.bases.create({
      slug: "review-visible",
      name: "Visible",
      autoMerge: true,
    });
    const hidden = await client.bases.create({
      slug: "review-hidden",
      name: "Hidden",
      autoMerge: true,
    });
    visibleNodeId = visible.nodeId;
    hiddenNodeId = hidden.nodeId;
    pendingIds = [];
    for (let i = 0; i < 3; i++) {
      pendingIds.push(
        (
          await client.bases.createChangeRequest({
            baseId: visible.id,
            fields: {},
            autoMerge: false,
          })
        ).id,
      );
    }
    await client.bases.createChangeRequest({ baseId: hidden.id, fields: {}, autoMerge: false });
    await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        { kind: "rename", nodeId: visible.nodeId, name: "Visible renamed" },
        { kind: "rename", nodeId: hidden.nodeId, name: "Hidden renamed" },
      ],
    });
    await client.nodes.updateVisibility({ nodeId: hidden.nodeId, visibility: "private" });
    const db = await getDb();
    // An unresolved in-review CR must fail closed, even though it is a candidate.
    await db.insert(busabaseChangeRequests).values({
      id: "review-unresolved",
      spaceId: LOCAL_SPACE_ID,
      targetType: "node",
      status: "in_review",
      submittedBy: MEMBER,
    });
    await db.insert(busabaseChangeRequests).values({
      id: "review-other-space",
      spaceId: OTHER_SPACE,
      baseId: visible.id,
      status: "in_review",
      submittedBy: MEMBER,
    });
    for (let offset = 0; offset < HISTORICAL_ROWS; offset += 500) {
      await db.insert(busabaseChangeRequests).values(
        Array.from({ length: 500 }, (_, i) => ({
          id: `review-history-${offset + i}`,
          spaceId: LOCAL_SPACE_ID,
          baseId: visible.id,
          status: "merged" as const,
          submittedBy: MEMBER,
        })),
      );
    }
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir])
      if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("selects only IDs of in-review candidates despite a large settled history", async () => {
    const db = await getDb();
    const querySpy = vi.spyOn(db.$client as PGlite, "query");
    try {
      expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 3 });
      const candidateQueries = querySpy.mock.calls.filter(([query]) =>
        /^select .* from "busabase_change_requests" where /i.test(query),
      );
      expect(candidateQueries).toHaveLength(1);
      const candidateQuery = candidateQueries[0];
      if (!candidateQuery) throw new Error("Expected one candidate query");
      const [query, params] = candidateQuery;
      expect(query).toMatch(/^select "id" from "busabase_change_requests" where /);
      expect(query).toContain('"space_id" = $1');
      expect(query).toContain('"status" = $2');
      expect(params).toEqual([LOCAL_SPACE_ID, "in_review"]);
      expect(
        querySpy.mock.calls.some(([, params]) =>
          JSON.stringify(params).includes("review-history-"),
        ),
      ).toBe(false);
    } finally {
      querySpy.mockRestore();
    }
  });

  it("agrees with full counts and snapshots, excluding hidden, mixed and unresolved scopes", async () => {
    const [badge, counts, snapshot] = await asMember(() =>
      Promise.all([
        client.changeRequests.reviewCount(),
        client.changeRequests.counts(),
        client.changeRequests.inboxSnapshot({ status: ["in_review"], page: 1, pageSize: 50 }),
      ]),
    );
    expect(badge.review).toBe(counts.review);
    expect(badge.review).toBe(snapshot.counts.review);
    expect(badge.review).toBe(snapshot.total);
    expect(badge.review).toBe(3);
  });

  it("keeps the manager path to one SQL aggregate without scope loading", async () => {
    const db = await getDb();
    const querySpy = vi.spyOn(db.$client as PGlite, "query");
    try {
      expect(await client.changeRequests.reviewCount()).toEqual({ review: 6 });
      expect(querySpy.mock.calls).toHaveLength(1);
      expect(querySpy.mock.calls[0]?.[0]).toContain("count(*)::int");
      expect(querySpy.mock.calls[0]?.[1]).toEqual([LOCAL_SPACE_ID, "in_review"]);
    } finally {
      querySpy.mockRestore();
    }
  });

  it("rechecks visibility and actor grants on every call, including revocation", async () => {
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 3 });
    await client.nodes.principals.add({
      nodeId: hiddenNodeId,
      principalType: "user",
      principalId: MEMBER,
      role: "read",
    });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 5 });
    expect(await asMember(() => client.changeRequests.reviewCount(), "another-member")).toEqual({
      review: 3,
    });
    await client.nodes.principals.remove({
      nodeId: hiddenNodeId,
      principalType: "user",
      principalId: MEMBER,
    });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 3 });
    await client.nodes.updateVisibility({ nodeId: visibleNodeId, visibility: "private" });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 0 });
    await client.nodes.updateVisibility({ nodeId: visibleNodeId, visibility: "workspace" });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 3 });
  });

  it("never counts requests from another space, even with a foreign visible Base reference", async () => {
    expect(await asMember(() => client.changeRequests.reviewCount(), MEMBER, OTHER_SPACE)).toEqual({
      review: 0,
    });
    expect(
      await runWithBusabaseContext(
        { spaceId: OTHER_SPACE, isSpaceManager: true, actorId: MEMBER },
        () => client.changeRequests.reviewCount(),
      ),
    ).toEqual({ review: 1 });
  });

  it("updates the badge through approval, merge, requested changes and close", async () => {
    const [approved, changes, closed] = pendingIds;
    if (!approved || !changes || !closed) throw new Error("Expected three pending fixtures");
    await client.changeRequests.review({ changeRequestIds: [approved], verdict: "approved" });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 2 });
    await client.changeRequests.merge({ changeRequestIds: [approved] });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 2 });
    await client.changeRequests.review({ changeRequestIds: [changes], verdict: "rejected" });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 1 });
    await client.changeRequests.close({ changeRequestId: closed });
    expect(await asMember(() => client.changeRequests.reviewCount())).toEqual({ review: 0 });
  });

  it("matches the demo snapshot and full count in both locales", async () => {
    const demo = createRouterClient(busabaseDemoRouter);
    for (const demoLocale of ["en", "zh-CN"] as const) {
      await runWithBusabaseContext({ demoLocale }, async () => {
        const badge = await demo.changeRequests.reviewCount();
        expect(badge.review).toBe((await demo.changeRequests.counts()).review);
        expect(badge.review).toBe((await demo.changeRequests.inboxSnapshot({})).counts.review);
      });
    }
  });
});
