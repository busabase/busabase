/**
 * Notion-style sidebar Favorites (`logic/nodes.ts`'s `toggleNodeFavorite` /
 * `listFavoriteNodes`, wired as `nodes.toggleFavorite` / `nodes.listFavorites`):
 *  - a true upsert-or-delete toggle against the `(nodeId, actorId)` unique pair,
 *    race-safe under a rapid double-toggle (never a duplicate row);
 *  - `listFavorites` reuses the same PO→VO mapper and the same
 *    archived/visibility filtering `nodes.list`/`search` already apply, so a
 *    favorited node that's later archived or hidden from the actor silently
 *    drops out instead of erroring;
 *  - favoriting an unknown/invisible node is a clean NOT_FOUND, never a
 *    silent no-op;
 *  - demo mode never persists (`toggleFavorite` throws, `listFavorites`
 *    returns an empty array), matching every other demo-mode node handler.
 *
 * See apps/busabase/content/spec/sidebar-favorites.md for the full design.
 */
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getContextSpaceId, LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseFavorites } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";
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

async function approveMerge(raw: RawClient, changeRequestId: string) {
  await raw.changeRequests.review({ changeRequestId, verdict: "approved" });
  await raw.changeRequests.merge({ changeRequestId });
}

async function archiveNode(raw: RawClient, nodeId: string) {
  const cr = await raw.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId }] });
  await approveMerge(raw, cr.id);
}

describe("nodes.toggleFavorite / nodes.listFavorites", () => {
  it("toggles a node's favorite on then off, and listFavorites reflects it", async () => {
    await seedScenario("fav-toggle-basic");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "CRM", slug: "crm", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      return { nodeId: base.nodeId };
    });

    await asManager("alice", async () => {
      expect((await raw.nodes.listFavorites()).some((n) => n.id === nodeId)).toBe(false);

      const on = await raw.nodes.toggleFavorite({ nodeId });
      expect(on.favorited).toBe(true);
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);

      const off = await raw.nodes.toggleFavorite({ nodeId });
      expect(off.favorited).toBe(false);
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).not.toContain(nodeId);
    });
  });

  it("keeps favorites per-actor: alice favoriting a node never favorites it for bob", async () => {
    await seedScenario("fav-per-actor");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Docs", slug: "docs", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      await raw.nodes.toggleFavorite({ nodeId: base.nodeId });
      return { nodeId: base.nodeId };
    });

    await asManager("alice", async () => {
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);
    });
    await asManager("bob", async () => {
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).not.toContain(nodeId);
    });
  });

  it("a rapid double-toggle (race) ends in exactly one row, never a duplicate", async () => {
    const { db } = await seedScenario("fav-race");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({
        name: "Marketing",
        slug: "marketing",
        autoMerge: true,
      });
      if ("status" in base) throw new Error("expected materialized base");
      return { nodeId: base.nodeId };
    });

    // Two toggle calls fired back-to-back from an unfavorited starting state —
    // both read "not favorited" and race to insert; the DB-level unique
    // constraint (not app-level locking) must keep this to exactly one row.
    await asManager("alice", async () => {
      await Promise.all([
        raw.nodes.toggleFavorite({ nodeId }),
        raw.nodes.toggleFavorite({ nodeId }),
      ]);
    });

    const rows = await db
      .select()
      .from(busabaseFavorites)
      .where(
        and(
          eq(busabaseFavorites.nodeId, nodeId),
          eq(busabaseFavorites.actorId, "alice"),
          eq(busabaseFavorites.spaceId, getContextSpaceId()),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("silently drops an archived favorited node from listFavorites (favorite row untouched)", async () => {
    await seedScenario("fav-archived");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { nodeId } = await asManager("alice", async () => {
      const doc = await raw.docs.create({ slug: "runbook", name: "Runbook", autoMerge: true });
      if ("status" in doc) throw new Error("expected materialized DocVO");
      await raw.nodes.toggleFavorite({ nodeId: doc.node.id });
      return { nodeId: doc.node.id };
    });

    await asManager("alice", async () => {
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);
      await archiveNode(raw, nodeId);
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).not.toContain(nodeId);

      // Restoring the node brings it back into Favorites automatically — a
      // read-time filter, not a destructive delete of the favorite row.
      const restoreCr = await raw.nodes.createChangeRequest({
        operations: [{ kind: "restore", nodeId }],
      });
      await approveMerge(raw, restoreCr.id);
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);
    });
  });

  it("silently drops a favorited node once its visibility is restricted away from the actor", async () => {
    await seedScenario("fav-visibility");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const { nodeId } = await asManager("alice", async () => {
      const base = await raw.bases.create({ name: "Team", slug: "team", autoMerge: true });
      if ("status" in base) throw new Error("expected materialized base");
      return { nodeId: base.nodeId };
    });

    // bob (a member, open-mode default-visible) favorites the node.
    await asMember("bob", async () => {
      await raw.nodes.toggleFavorite({ nodeId });
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);
    });

    // alice (manager) makes it private.
    await asManager("alice", () => raw.nodes.updateVisibility({ nodeId, visibility: "private" }));

    // bob's favorite row still exists, but it's filtered out of the read.
    await asMember("bob", async () => {
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).not.toContain(nodeId);
    });

    // Grant bob read access back → it reappears automatically.
    await asManager("alice", () =>
      raw.nodes.principals.add({
        nodeId,
        principalType: "user",
        principalId: "bob",
        role: "read",
      }),
    );
    await asMember("bob", async () => {
      expect((await raw.nodes.listFavorites()).map((n) => n.id)).toContain(nodeId);
    });
  });

  it("refuses to favorite an unknown nodeId (clean NOT_FOUND, not a silent no-op)", async () => {
    await seedScenario("fav-unknown-node");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await asManager("alice", async () => {
      await expect(raw.nodes.toggleFavorite({ nodeId: "nod_does_not_exist" })).rejects.toThrow();
    });
  });
});

describe("nodes.toggleFavorite / nodes.listFavorites (demo mode)", () => {
  const demoClient = createRouterClient(busabaseDemoRouter);

  it("toggleFavorite is unsupported in demo mode (matches every other demo write)", async () => {
    await expect(demoClient.nodes.toggleFavorite({ nodeId: "anything" })).rejects.toThrow(
      /disabled in the Busabase demo/i,
    );
  });

  it("listFavorites returns an empty array in demo mode (no persisted state to favorite against)", async () => {
    expect(await demoClient.nodes.listFavorites()).toEqual([]);
  });
});
