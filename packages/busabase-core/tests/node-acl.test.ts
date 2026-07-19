/**
 * Node-level access control (logic/node-acl.ts): visibility hiding, ancestor
 * inheritance, restricted-mode default, the read/changeRequest/write/manage
 * ladder, and root-node protection.
 *
 * Enforcement only kicks in when a host injects `isSpaceManager: false`
 * (open-source local mode treats everyone as a manager — no auth, no ACL), so
 * every assertion runs inside an explicit `runWithBusabaseContext` that sets
 * the actor + manager/restricted flags, mirroring how `withBusabaseContext`
 * does it in busabase-cloud.
 *
 * Honors an external PG_DATABASE_URL so it can run against real Postgres,
 * where the EXISTS-subquery ACL clauses and the cascade recompute actually
 * exercise the production query planner — see seed-scenario for the PGlite
 * default.
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

const asMember = <T>(actorId: string, fn: () => Promise<T>, opts: { restricted?: boolean } = {}) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager: false,
      restrictedVisibility: opts.restricted ?? false,
    },
    fn,
  );

describe("node ACL", () => {
  it("hides a private base from a non-granted member (list + direct get + search)", async () => {
    await seedScenario("acl-private-hide");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // Manager (alice) creates a base with a record, then marks it private.
    const { baseId, nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Finance", slug: "finance", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.bases.createField({ baseId: base.id, name: "title", slug: "title", type: "text" });
      const cr = await raw.bases.createChangeRequest({
        baseId: base.id,
        fields: { title: "Payroll Q3" },
        submittedBy: "alice",
      });
      await raw.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await raw.changeRequests.merge({ changeRequestId: cr.id });
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return { baseId: base.id, nodeId: base.nodeId };
    });

    // Manager still sees it.
    await asManager("alice", async () => {
      expect((await raw.bases.list()).some((b) => b.id === baseId)).toBe(true);
      expect(await raw.bases.get({ baseId })).toBeTruthy();
    });

    // Non-granted member (bob): base absent from list, get returns null, and a
    // record search for its content finds nothing.
    await asMember("bob", async () => {
      expect((await raw.bases.list()).some((b) => b.id === baseId)).toBe(false);
      expect(await raw.bases.get({ baseId })).toBeNull();
      const hits = await raw.search({ query: "Payroll" });
      expect(hits.results.some((r) => JSON.stringify(r).includes("Payroll"))).toBe(false);
    });

    // Grant bob read → base becomes visible, but he still can't manage it.
    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "bob",
        role: "read",
      }),
    );
    await asMember("bob", async () => {
      expect(await raw.bases.get({ baseId })).toBeTruthy();
      await expect(
        raw.nodes.principals.add({
          nodeId,
          principalType: "user",
          principalId: "carol",
          role: "read",
        }),
      ).rejects.toThrow(); // needs `manage`
    });
  });

  it("inherits a private folder's visibility onto a base created inside it", async () => {
    await seedScenario("acl-inherit");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { baseId } = await asManager("alice", async () => {
      // Create a folder, mark it private, create a base inside it.
      const folderCr = await raw.nodes.createChangeRequest({
        message: "Create private folder",
        operations: [
          { kind: "create", ref: "f", nodeType: "folder", slug: "vault", name: "Vault" },
        ],
        autoMerge: true,
      });
      const folderNodeId = folderCr.mergeSummary?.mergedNodeIds?.[0] as string;
      expect(folderNodeId).toBeTruthy();
      await raw.nodes.updateVisibility({ nodeId: folderNodeId, visibility: "private" });
      const base = await raw.bases.create({
        name: "Secrets",
        slug: "secrets",
        parentNodeId: folderNodeId,
        autoMerge: true,
      });
      if ("status" in base) throw new Error("expected materialized base");
      return { baseId: base.id };
    });

    // The base itself was never explicitly set private, but its parent folder
    // is — so a non-granted member can't see it (effectiveVisibility inherited).
    await asMember("bob", async () => {
      expect(await raw.bases.get({ baseId })).toBeNull();
    });
    await asManager("alice", async () => {
      expect(await raw.bases.get({ baseId })).toBeTruthy();
    });
  });

  it("restricted mode hides default-visibility nodes from members but not managers", async () => {
    await seedScenario("acl-restricted");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { baseId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Team", slug: "team", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      return { baseId: base.id };
    });

    // Open mode (default): member sees the un-annotated base.
    await asMember("bob", async () => {
      expect(await raw.bases.get({ baseId })).toBeTruthy();
    });
    // Restricted mode: same base, no explicit visibility → hidden from member…
    await asMember(
      "bob",
      async () => {
        expect(await raw.bases.get({ baseId })).toBeNull();
      },
      { restricted: true },
    );
    // …but a manager still sees everything even in restricted mode.
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "alice",
        isSpaceManager: true,
        restrictedVisibility: true,
      },
      async () => {
        expect(await raw.bases.get({ baseId })).toBeTruthy();
      },
    );
  });

  it("enforces the changeRequest level gate: read can view but not propose", async () => {
    await seedScenario("acl-cr-gate");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { baseId, nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Docs", slug: "docs-base", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.bases.createField({ baseId: base.id, name: "title", slug: "title", type: "text" });
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return { baseId: base.id, nodeId: base.nodeId };
    });

    // read-only grant: bob can see the base but cannot submit a CR against it.
    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "bob",
        role: "read",
      }),
    );
    await asMember("bob", async () => {
      expect(await raw.bases.get({ baseId })).toBeTruthy();
      await expect(
        raw.bases.createChangeRequest({ baseId, fields: { title: "sneaky" }, submittedBy: "bob" }),
      ).rejects.toThrow(); // FORBIDDEN — read < changeRequest
    });

    // Bump bob to changeRequest → now the proposal goes through.
    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "bob",
        role: "changeRequest",
      }),
    );
    await asMember("bob", async () => {
      const cr = await raw.bases.createChangeRequest({
        baseId,
        fields: { title: "ok now" },
        submittedBy: "bob",
      });
      expect(cr.id).toBeTruthy();
    });
  });

  it("refuses to make the workspace root private", async () => {
    const { spaceId } = await seedScenario("acl-root");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const rootId = spaceId === LOCAL_SPACE_ID ? "nod_root" : `nod_root_${spaceId}`;

    await asManager("alice", async () => {
      await expect(
        raw.nodes.updateVisibility({ nodeId: rootId, visibility: "private" }),
      ).rejects.toThrow(/root/i);
    });
  });
});
