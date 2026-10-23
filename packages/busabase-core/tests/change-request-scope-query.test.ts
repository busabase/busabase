import type { PGlite } from "@electric-sql/pglite";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import type { getDb } from "../src/db";
import { busabaseChangeRequests, busabaseCommits, busabaseOperations } from "../src/db/schema";
import { clearChangeRequestScopeCache } from "../src/logic/change-request-scope-cache";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

const asMember = <T>(fn: () => Promise<T>, spaceId = LOCAL_SPACE_ID) =>
  runWithBusabaseContext(
    { spaceId, actorId: "scope-reader", isSpaceManager: false, permissionLevel: "write" },
    fn,
  );

// Exercise the actual oRPC comment/detail/approval paths against PostgreSQL in
// PGLite, including the real SQL result rows, rather than mocking the loader.
describe("single change-request scope queries", () => {
  const client = createRouterClient(busabaseRouter);
  let db: Awaited<ReturnType<typeof getDb>>;
  let pg: PGlite;
  let baseId: string;
  let baseNodeId: string;
  let fixtureSequence = 0;

  beforeAll(async () => {
    ({ db } = await seedScenario("single-cr-scope-query"));
    pg = (db as unknown as { $client: PGlite }).$client;
    const base = await client.bases.create({
      slug: "scope-query",
      name: "Scope query",
      fields: [{ slug: "title", name: "Title", type: "text", options: {} }],
      autoMerge: true,
    });
    if (!base.materialized || !base.nodeId) throw new Error("Expected a materialized Base");
    baseId = base.id;
    baseNodeId = base.nodeId;
  });

  beforeEach(() => clearChangeRequestScopeCache());

  const comments = (changeRequestId: string) =>
    client.comments.list({ subjectType: "change_request", subjectId: changeRequestId });

  const propose = async () => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "Scope" },
      autoMerge: false,
    });
    if (cr.materialized) throw new Error("Expected a pending change request");
    return cr;
  };

  // Raw legacy rows are intentional: API validation prevents corrupt hints,
  // while permission checks must remain fail-closed for old stored payloads.
  const hintFixture = async (
    payloads: Record<string, unknown>[],
    operation: "node_create" | "node_rename" = "node_create",
    commitSpaceId = LOCAL_SPACE_ID,
  ) => {
    const id = `qcr_scope_hints_${fixtureSequence++}`;
    await db.insert(busabaseChangeRequests).values({ id, submittedBy: "local-user" });
    for (const [position, payload] of payloads.entries()) {
      const commitId = `qco_scope_hints_${fixtureSequence++}`;
      await db.insert(busabaseCommits).values({
        id: commitId,
        spaceId: commitSpaceId,
        operation,
        payload,
        author: "local-user",
      });
      await db.insert(busabaseOperations).values({
        id: `qop_scope_hints_${fixtureSequence++}`,
        changeRequestId: id,
        operation,
        headCommitId: commitId,
        position,
      });
    }
    return id;
  };

  it.each([360, 1_000])(
    "reads one scope row and no commit payload for %i Base-backed operations",
    async (operationCount) => {
      const cr = await propose();
      const first = cr.primaryOperation;
      if (!first) throw new Error("Missing fixture operation");
      // The access path depends on operation count, not distinct payloads. Use
      // one existing commit to keep a realistic 1,000-operation fixture cheap.
      await db.insert(busabaseOperations).values(
        Array.from({ length: operationCount - 1 }, (_, i) => ({
          id: `qop_scope_bulk_${fixtureSequence++}`,
          changeRequestId: cr.id,
          baseId,
          operation: "record_create" as const,
          headCommitId: first.headCommitId,
          position: i + 1,
        })),
      );
      const spy = vi.spyOn(pg, "query");
      try {
        expect(await asMember(() => comments(cr.id))).toEqual([]);
        expect(
          await asMember(() =>
            client.comments.list({ subjectType: "operation", subjectId: first.id }),
          ),
        ).toEqual([]);
        const queries = spy.mock.calls.map(([query]) => query);
        expect(queries.some((query) => query.includes('"busabase_commits"'))).toBe(false);
        const scopeIndex = queries.findIndex((query) =>
          query.startsWith('select distinct "change_request_id", "node_id", "base_id"'),
        );
        expect(scopeIndex).toBeGreaterThanOrEqual(0);
        const result = await spy.mock.results[scopeIndex]?.value;
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]).toEqual([cr.id, null, baseId]);
      } finally {
        spy.mockRestore();
      }
      // Details still need and return all operations and their payloads.
      const detail = await asMember(() => client.changeRequests.get({ changeRequestId: cr.id }));
      expect(detail?.operations).toHaveLength(operationCount);
      expect(detail?.operations[0]?.headCommit.payload.title).toBe("Scope");
    },
  );

  it("resolves parent refs in position order and fetches only typed JSON scope hints", async () => {
    const id = await hintFixture([
      { parentNodeId: baseNodeId, ref: "parent", body: "x".repeat(400_000) },
      { parentNodeRef: "parent", ref: "child" },
      { parentNodeRef: "child" },
    ]);
    const spy = vi.spyOn(pg, "query");
    try {
      expect(await asMember(() => comments(id))).toEqual([]);
      const queries = spy.mock.calls.map(([query]) => query);
      const hintIndex = queries.findIndex((query) => query.includes("jsonb_typeof"));
      expect(hintIndex).toBeGreaterThanOrEqual(0);
      expect(queries[hintIndex]).not.toContain('select "payload"');
      const hints = await spy.mock.results[hintIndex]?.value;
      expect(hints.rows).toHaveLength(3);
      expect(JSON.stringify(hints.rows).length).toBeLessThan(1_000);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects forward or undeclared refs, malformed non-create hints and an empty CR", async () => {
    const forward = await hintFixture([
      { parentNodeRef: "later" },
      { parentNodeId: baseNodeId, ref: "later" },
    ]);
    const undeclared = await hintFixture([{ parentNodeRef: "missing" }]);
    const malformed = await hintFixture([{ parentNodeId: 42, parentNodeRef: {} }], "node_rename");
    const empty = await hintFixture([]);
    for (const id of [forward, undeclared, malformed, empty]) {
      await expect(asMember(() => comments(id))).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        asMember(() => client.changeRequests.get({ changeRequestId: id })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("does not stringify malformed create hints or read another tenant's commit hints", async () => {
    // Preserve historical create-at-root behavior for non-string hints.
    const malformed = await hintFixture([{ parentNodeId: 42, parentNodeRef: {}, ref: [] }]);
    expect(await asMember(() => comments(malformed))).toEqual([]);
    const crossTenant = await hintFixture(
      [{ parentNodeId: baseNodeId }],
      "node_rename",
      "other-space",
    );
    await expect(asMember(() => comments(crossTenant))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(asMember(() => comments(malformed), "other-space")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses a Base belonging to another tenant even if an operation references its valid id", async () => {
    const otherBase = await runWithBusabaseContext(
      { spaceId: "scope-other-space", actorId: "scope-owner", isSpaceManager: true },
      () => client.bases.create({ slug: "foreign-scope", name: "Foreign scope", autoMerge: true }),
    );
    if (!otherBase.materialized) throw new Error("Expected a materialized Base");
    const cr = await propose();
    if (!cr.primaryOperation) throw new Error("Missing fixture operation");
    await db
      .update(busabaseOperations)
      .set({ baseId: otherBase.id })
      .where(eq(busabaseOperations.id, cr.primaryOperation.id));
    await expect(asMember(() => comments(cr.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("checks every target and immediately observes revoked ACLs with a cached terminal scope", async () => {
    const privateBase = await client.bases.create({
      name: "Private scope",
      slug: "private-scope",
      autoMerge: true,
    });
    if (!privateBase.materialized || !privateBase.nodeId) {
      throw new Error("Expected a materialized Base");
    }
    const cr = await propose();
    if (!cr.primaryOperation) throw new Error("Missing fixture operation");
    await db.insert(busabaseOperations).values({
      id: `qop_scope_private_${fixtureSequence++}`,
      changeRequestId: cr.id,
      baseId: privateBase.id,
      headCommitId: cr.primaryOperation.headCommitId,
      operation: "record_create",
      position: 1,
    });
    await client.nodes.updateVisibility({ nodeId: privateBase.nodeId, visibility: "private" });
    await expect(asMember(() => comments(cr.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await client.nodes.principals.add({
      nodeId: privateBase.nodeId,
      principalType: "user",
      principalId: "scope-reader",
      role: "read",
    });
    await db
      .update(busabaseChangeRequests)
      .set({ status: "rejected", updatedAt: new Date(Date.now() - 600_000) })
      .where(eq(busabaseChangeRequests.id, cr.id));
    expect(await asMember(() => comments(cr.id))).toEqual([]);
    const spy = vi.spyOn(pg, "query");
    try {
      expect(await asMember(() => comments(cr.id))).toEqual([]);
      expect(spy.mock.calls.some(([query]) => query.includes('from "busabase_operations"'))).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
    await client.nodes.principals.remove({
      nodeId: privateBase.nodeId,
      principalType: "user",
      principalId: "scope-reader",
    });
    await expect(asMember(() => comments(cr.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asMember(() => client.changeRequests.get({ changeRequestId: cr.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not cache active scopes or reuse a terminal scope after its version changes", async () => {
    const cr = await propose();
    expect(await asMember(() => comments(cr.id))).toEqual([]);
    const spy = vi.spyOn(pg, "query");
    try {
      expect(await asMember(() => comments(cr.id))).toEqual([]);
      expect(spy.mock.calls.some(([query]) => query.startsWith("select distinct"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
    await db
      .update(busabaseChangeRequests)
      .set({ status: "rejected", updatedAt: new Date(Date.now() - 600_000) })
      .where(eq(busabaseChangeRequests.id, cr.id));
    expect(await asMember(() => comments(cr.id))).toEqual([]);
    await db
      .update(busabaseChangeRequests)
      .set({ updatedAt: new Date(Date.now() - 500_000) })
      .where(eq(busabaseChangeRequests.id, cr.id));
    const versionSpy = vi.spyOn(pg, "query");
    try {
      expect(await asMember(() => comments(cr.id))).toEqual([]);
      expect(versionSpy.mock.calls.some(([query]) => query.startsWith("select distinct"))).toBe(
        true,
      );
    } finally {
      versionSpy.mockRestore();
    }
  });

  it("approves and merges a pending root create in Restricted mode without changing reload behavior", async () => {
    const cr = await client.nodes.createChangeRequest({
      operations: [{ kind: "create", nodeType: "folder", slug: "scope-root", name: "Root" }],
      autoMerge: false,
    });
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "scope-reader",
        isSpaceManager: false,
        permissionLevel: "write",
        restrictedVisibility: true,
      },
      async () => {
        const review = await client.changeRequests.review({
          changeRequestIds: [cr.id],
          verdict: "approved",
        });
        expect(review.results[0]?.ok).toBe(true);
        const merged = await client.changeRequests.merge({ changeRequestIds: [cr.id] });
        expect(merged.results[0]?.ok).toBe(true);
        // The post-merge response is allowed, but subsequent reads evaluate
        // the newly created node's Restricted-mode ACL rather than the root.
        await expect(client.changeRequests.get({ changeRequestId: cr.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      },
    );
  });
});
