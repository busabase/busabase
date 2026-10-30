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
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import { subscribeRealtimeMessages } from "openlib/realtime";
import { describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import type { BusabaseLiveEvent } from "../src/logic/live-events";
import { getEffectiveNodeLevel } from "../src/logic/node-acl";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const asManager = <T>(actorId: string, fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

const asMember = <T>(
  actorId: string,
  fn: () => Promise<T>,
  opts: {
    restricted?: boolean;
    permissionLevel?: ApiKeyPermissionLevel;
    permissionLevelIsCeiling?: boolean;
    credentialPermissionCeiling?: ApiKeyPermissionLevel;
  } = {},
) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager: false,
      permissionLevel: opts.permissionLevel ?? "changeRequest",
      permissionLevelIsCeiling: opts.permissionLevelIsCeiling,
      credentialPermissionCeiling: opts.credentialPermissionCeiling,
      restrictedVisibility: opts.restricted ?? false,
    },
    fn,
  );

describe("node ACL", () => {
  it("notifies already-open clients after visibility and direct grant changes", async () => {
    await seedScenario("acl-live-invalidation");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await asManager("alice", () =>
      raw.bases.create({ name: "Source", slug: "source", autoMerge: true }),
    );
    if ("status" in base) throw new Error("expected materialized base");
    const events: BusabaseLiveEvent[] = [];
    const unsubscribe = subscribeRealtimeMessages<BusabaseLiveEvent>(
      `busabase:live:${LOCAL_SPACE_ID}`,
      (event) => events.push(event),
    );
    try {
      await asManager("alice", () =>
        raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" }),
      );
      await asManager("alice", () =>
        raw.nodes.principals.add({
          nodeId: base.nodeId,
          principalType: "user",
          principalId: "bob",
          role: "read",
        }),
      );
      expect(await asMember("bob", () => getEffectiveNodeLevel(base.nodeId))).toBe("read");
      await asManager("alice", () =>
        raw.nodes.principals.remove({
          nodeId: base.nodeId,
          principalType: "user",
          principalId: "bob",
        }),
      );
      expect(await asMember("bob", () => getEffectiveNodeLevel(base.nodeId))).toBeNull();
      expect(events).toHaveLength(3);
      for (const event of events) {
        expect(event).toMatchObject({
          kind: "node.metadata_updated",
          reason: "acl",
          spaceId: LOCAL_SPACE_ID,
          actorId: "alice",
          nodeIds: [base.nodeId],
          baseId: null,
        });
      }
      await asManager("alice", () =>
        raw.nodes.updateMetadata({
          nodeId: base.nodeId,
          metadata: { description: "Content only" },
        }),
      );
      expect(events).toHaveLength(4);
      expect(events[3]).toMatchObject({ kind: "node.metadata_updated", nodeIds: [base.nodeId] });
      expect(events[3]?.reason).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  it("separates manager visibility from an API-key action ceiling and rejects cross-space ids", async () => {
    await seedScenario("acl-manager-credential-ceiling");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { baseId, nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Private", slug: "private", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return { baseId: base.id, nodeId: base.nodeId };
    });

    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "admin-reader",
        isSpaceManager: true,
        permissionLevel: "manage",
        credentialPermissionCeiling: "read",
      },
      async () => {
        expect(await getEffectiveNodeLevel(nodeId)).toBe("read");
        expect(await raw.bases.get({ baseId })).toBeTruthy();
        await expect(
          raw.nodes.updateMetadata({ nodeId, metadata: { name: "Nope" } }),
        ).rejects.toThrow();
      },
    );

    await runWithBusabaseContext(
      { spaceId: "another-space", actorId: "admin-reader", isSpaceManager: true },
      async () => {
        expect(await getEffectiveNodeLevel(nodeId)).toBeNull();
      },
    );
  });

  it("caps direct and inherited node grants at a scoped credential's permission level", async () => {
    await seedScenario("acl-scoped-credential-ceiling");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { folderNodeId, baseNodeId } = await asManager("alice", async () => {
      const folder = await raw.nodes.createChangeRequest({
        operations: [{ kind: "create", nodeType: "folder", slug: "scoped", name: "Scoped" }],
        autoMerge: true,
      });
      const folderNodeId = folder.mergeSummary.mergedNodeIds?.[0];
      if (!folderNodeId) throw new Error("Expected a materialized folder");
      const base = await raw.bases.create({
        parentNodeId: folderNodeId,
        slug: "scoped-base",
        name: "Scoped Base",
        autoMerge: true,
      });
      if (!base.materialized) throw new Error("Expected a materialized Base");
      await raw.nodes.principals.add({
        nodeId: folderNodeId,
        principalType: "user",
        principalId: "bob",
        role: "manage",
      });
      return { folderNodeId, baseNodeId: base.nodeId };
    });

    // A normal member session may be elevated by the direct folder grant and
    // its materialized inherited grant on the Base.
    await asMember("bob", async () => {
      expect(await getEffectiveNodeLevel(folderNodeId)).toBe("manage");
      expect(await getEffectiveNodeLevel(baseNodeId)).toBe("manage");
    });

    // The same human acting through a scoped key cannot use those grants to
    // exceed the key's own changeRequest ceiling.
    await asMember(
      "bob",
      async () => {
        expect(await getEffectiveNodeLevel(folderNodeId)).toBe("changeRequest");
        expect(await getEffectiveNodeLevel(baseNodeId)).toBe("changeRequest");
      },
      { permissionLevel: "changeRequest", permissionLevelIsCeiling: true },
    );
  });

  it("bases.get reports the viewer's effective node level on the Base", async () => {
    await seedScenario("acl-base-viewer-level");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const { baseId, nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Ledger", slug: "ledger", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return { baseId: base.id, nodeId: base.nodeId };
    });
    await asManager("alice", () =>
      raw.nodes.principals.add({ nodeId, principalType: "user", principalId: "bob", role: "read" }),
    );

    await asManager("alice", async () => {
      expect((await raw.bases.get({ baseId })).viewerPermissionLevel).toBe("manage");
      // List stays lean: no per-Base ACL lookup.
      const listed = (await raw.bases.list({})).find((b) => b.id === baseId);
      expect(listed && "viewerPermissionLevel" in listed).toBe(false);
    });
    await asMember("bob", async () => {
      expect((await raw.bases.get({ baseId })).viewerPermissionLevel).toBe("read");
    });

    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "carol",
        role: "changeRequest",
      }),
    );
    await asMember("carol", async () => {
      expect((await raw.bases.get({ baseId })).viewerPermissionLevel).toBe("changeRequest");
    });
  });

  it("hides a private base from a non-granted member (list + direct get + search)", async () => {
    await seedScenario("acl-private-hide");
    const raw: RawClient = createRouterClient(busabaseRouter);

    // Manager (alice) creates a base with a record, then marks it private.
    const { baseId, nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Finance", slug: "finance", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.bases.createField({ baseId: base.id, name: "title", slug: "title", type: "text" });
      // Manager: permission-aware default merges this immediately (no
      // manual review/merge step needed, unlike a changeRequest-level actor).
      await raw.bases.createChangeRequest({
        baseId: base.id,
        fields: { title: "Payroll Q3" },
        submittedBy: "alice",
      });
      await raw.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "private" });
      return { baseId: base.id, nodeId: base.nodeId };
    });

    // Manager still sees it.
    await asManager("alice", async () => {
      expect((await raw.bases.list({})).some((b) => b.id === baseId)).toBe(true);
      expect(await raw.bases.get({ baseId })).toBeTruthy();
    });

    // Non-granted member (bob): base absent from list, get returns NOT_FOUND, and a
    // record search for its content finds nothing.
    await asMember("bob", async () => {
      expect((await raw.bases.list({})).some((b) => b.id === baseId)).toBe(false);
      await expect(raw.bases.get({ baseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
      await expect(raw.bases.get({ baseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
        await expect(raw.bases.get({ baseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
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

  it("creates Skills/AirApps/Drives visible to members unless asked to be private", async () => {
    // These used to default to `private` on both create paths, so a node a
    // member made in an open space came out visible only to its creator and
    // the managers — unlike a Doc or Base created the same way.
    await seedScenario("acl-filetree-default");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const ids = await asManager("alice", async () => {
      // API / CLI / MCP path.
      const skill = await raw.fileTrees.create({
        type: "skill",
        slug: "team-skill",
        name: "Team Skill",
        autoMerge: true,
      });
      if (!skill.materialized) throw new Error("expected materialized skill");
      // Dashboard "new" path: a node_create ChangeRequest merged through the
      // type's materializer.
      const cr = await raw.nodes.createChangeRequest({
        message: "Create AirApp",
        operations: [
          { kind: "create", ref: "a", nodeType: "airapp", slug: "team-app", name: "Team App" },
        ],
        autoMerge: true,
      });
      const airappId = cr.mergeSummary?.mergedNodeIds?.[0] as string;
      expect(airappId).toBeTruthy();
      const hidden = await raw.fileTrees.create({
        type: "drive",
        slug: "hidden-drive",
        name: "Hidden Drive",
        visibility: "private",
        autoMerge: true,
      });
      if (!hidden.materialized) throw new Error("expected materialized drive");
      return { skillId: skill.node.id, airappId, hiddenId: hidden.node.id };
    });

    await asMember("bob", async () => {
      const skill = await raw.nodes.get({ nodeId: ids.skillId, type: "skill" });
      expect(skill.visibility).toBe("workspace");
      const airapp = await raw.nodes.get({ nodeId: ids.airappId, type: "airapp" });
      expect(airapp.visibility).toBe("workspace");
      await expect(raw.nodes.get({ nodeId: ids.hiddenId, type: "drive" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    // A restricted space still hides a node that declares nothing.
    await asMember(
      "bob",
      async () => {
        await expect(raw.nodes.get({ nodeId: ids.skillId, type: "skill" })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      },
      { restricted: true },
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
    const crId = await asMember("bob", async () => {
      const cr = await raw.bases.createChangeRequest({
        baseId,
        fields: { title: "ok now" },
        submittedBy: "bob",
      });
      expect(cr.id).toBeTruthy();
      // A changeRequest grant may propose but not approve — including its own CR.
      expect((await raw.changeRequests.get({ changeRequestId: cr.id })).viewerCanApprove).toBe(
        false,
      );
      const review = await raw.changeRequests.review({
        changeRequestIds: [cr.id],
        verdict: "approved",
      });
      expect(review.results[0]).toMatchObject({ ok: false, code: "FORBIDDEN" });
      return cr.id;
    });
    await asManager("alice", async () => {
      expect((await raw.changeRequests.get({ changeRequestId: crId })).viewerCanApprove).toBe(true);
    });
  });

  it("uses member/viewer workspace roles as the visible-node baseline and gates review/merge", async () => {
    await seedScenario("acl-space-role-baseline");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { baseId, docNodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Roadmap", slug: "roadmap", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.bases.createField({ baseId: base.id, name: "title", slug: "title", type: "text" });
      const doc = await raw.docs.create({
        name: "Runbook",
        slug: "runbook",
        body: "owner content",
        autoMerge: true,
      });
      if ("status" in doc) throw new Error("expected materialized doc");
      return { baseId: base.id, docNodeId: doc.node.id };
    });

    const changeRequest = await asMember("bob", () =>
      raw.bases.createChangeRequest({
        baseId,
        fields: { title: "member proposal" },
        submittedBy: "bob",
      }),
    );
    expect(changeRequest.status).toBe("in_review");

    await asMember("bob", async () => {
      // Explicit `autoMerge: true` without `write` access gracefully
      // downgrades to a pending CR instead of throwing — the caller just
      // doesn't get what they asked for, same as omitting `autoMerge`.
      const blockedNode = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          { kind: "create", nodeType: "folder", slug: "blocked-now", name: "Blocked Now" },
        ],
      });
      expect(blockedNode.status).toBe("in_review");
      const blockedDoc = await raw.docs.create({
        name: "Blocked Doc",
        slug: "blocked-doc",
        body: "should not materialize",
        autoMerge: true,
      });
      if (!("status" in blockedDoc)) throw new Error("expected a pending ChangeRequest");
      expect(blockedDoc.status).toBe("in_review");
      // Unlike the old Doc-only `docs.updateBody` (a `write`-gated direct write
      // that threw for a `changeRequest`-level member), the unified
      // `nodes.updateContent` sits at the `changeRequest` floor — bob CAN call
      // it, he just doesn't get an immediate merge: `finalizeChangeRequest`
      // downgrades to a pending CR instead of throwing (spec D3).
      const memberContentCr = await raw.nodes.updateContent({
        nodeId: docNodeId,
        content: { kind: "doc", body: "member direct update" },
      });
      expect(memberContentCr.status).toBe("in_review");
      await expect(
        raw.bases.createField({
          baseId,
          name: "blocked now",
          slug: "blocked-now",
          type: "text",
        }),
      ).rejects.toThrow(/write access/);
      const reviewResult = await raw.changeRequests.review({
        changeRequestIds: [changeRequest.id],
        verdict: "approved",
      });
      expect(reviewResult.results[0]).toMatchObject({
        ok: false,
        error: expect.stringMatching(/write workspace access/),
      });
      const mergeResult = await raw.changeRequests.merge({
        changeRequestIds: [changeRequest.id],
      });
      expect(mergeResult.results[0]).toMatchObject({
        ok: false,
        error: expect.stringMatching(/write workspace access/),
      });
    });

    await asMember(
      "carol",
      async () => {
        await expect(
          raw.bases.createChangeRequest({
            baseId,
            fields: { title: "viewer proposal" },
            submittedBy: "carol",
          }),
        ).rejects.toThrow(/changeRequest access/);
      },
      { permissionLevel: "read" },
    );
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
