import { createRouterClient } from "@orpc/server";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runWithEmbedContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodePrincipals } from "../src/db/schema";
import { resolveEmbedRequestContext } from "../src/domains/embed-links/logic";
import { airAppEmbedDataRouter } from "../src/domains/embed-links/runtime-router";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * What an Embed Link may reach through the RPC surface.
 *
 * The embedded read-only Dashboard hides the comment threads in the UI
 * (`change-request-review.tsx`). This is the half that actually enforces it:
 * `comments.*` is space-scoped with no node ACL behind it, so a link holder
 * reaching it would read every comment in the Space, not just the target's.
 * Hiding a component cannot be the only thing in the way.
 */
describe("embed visitor procedure surface", () => {
  it("serves the link target but refuses space-scoped procedures", async () => {
    await seedScenario("embed-surface-guard");
    const client = createRouterClient(busabaseRouter);
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-guard-runbook",
      name: "Embed Guard Runbook",
      body: "# Runbook\n\nVisible through the link.\n",
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");
    const sibling = await client.docs.create({
      autoMerge: true,
      slug: "embed-guard-private-sibling",
      name: "Private Sibling",
      body: "# Private sibling\n",
    });
    if (!("node" in sibling)) throw new Error("expected a materialized sibling Doc");
    await client.nodes.updateVisibility({ nodeId: sibling.node.id, visibility: "private" });

    const created = await client.embedLinks.create({
      type: "node",
      typeId: doc.node.id,
      expiresInMinutes: 30,
      framePolicy: { mode: "top-level-only", allowedOrigins: [] },
    });
    const secret = new URL(created.url).searchParams.get("token") ?? "";
    const embedContext = await resolveEmbedRequestContext(created.id, secret);
    if (!embedContext) throw new Error("expected the fresh capability to resolve");
    const db = await getDb();
    await db
      .delete(busabaseNodePrincipals)
      .where(inArray(busabaseNodePrincipals.nodeId, [doc.node.id, sibling.node.id]));

    await runWithEmbedContext(embedContext, async () => {
      // On the embed surface: the node the link points at. Note this is a
      // `doc` reached through the link's exact-node scope, with no creator
      // principal left to accidentally make the test pass.
      const detail = await client.nodes.get({ nodeId: doc.node.id });
      expect(detail).toMatchObject({ node: { id: doc.node.id } });

      // The dashboard's route guard runs before it renders any node URL (a
      // record preview is one); denying it made the embed read "Node unavailable".
      await expect(client.nodes.resolveRouteState({ nodeId: doc.node.id })).resolves.toMatchObject({
        status: "active",
      });

      // The bearer capability authorizes one exact target, never neighboring
      // private content in the same workspace.
      await expect(client.nodes.get({ nodeId: sibling.node.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });

      // Off it: space-scoped, no node ACL. Default-deny, not "hidden in the UI".
      await expect(
        client.comments.list({ subjectType: "change_request", subjectId: "chr_whatever" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // Off it: a link is a read credential, and nothing on the write surface
      // is reachable even before the `read` ceiling is consulted.
      await expect(
        client.docs.create({ autoMerge: true, slug: "from-embed", name: "From Embed", body: "x" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // Off it: minting further capabilities from a capability.
      await expect(
        client.embedLinks.create({ type: "node", typeId: doc.node.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  /**
   * An embedded AirApp dashboard renders its tiles and board headers from
   * `records.count` / `records.groupBy` / `records.listPage` / `records.search`.
   * Both gates sit in front of them — the embed procedure allowlist on the core
   * router, and the AirApp runtime's own READABLE_PROCEDURES — so this drives the
   * calls through BOTH routers. Reachability is all the lists grant: the Base
   * node ACL still decides, so a Base the link creator cannot read stays dark.
   */
  it("serves node-ACL'd record aggregates and still hides Bases the creator cannot read", async () => {
    await seedScenario("embed-surface-guard-aggregates");
    const client = createRouterClient(busabaseRouter);
    const fields = [
      { slug: "name", name: "Name", type: "text" as const, required: true, options: {} },
      {
        slug: "stage",
        name: "Stage",
        type: "select" as const,
        required: false,
        options: {
          choices: [
            { id: "open", name: "Open" },
            { id: "done", name: "Done" },
          ],
        },
      },
    ];
    const readable = await client.bases.create({
      autoMerge: true,
      slug: "embed-readable-pipeline",
      name: "Readable Pipeline",
      fields,
    });
    const hidden = await client.bases.create({
      autoMerge: true,
      slug: "embed-hidden-pipeline",
      name: "Hidden Pipeline",
      fields,
    });
    if (!("id" in readable) || !("id" in hidden)) throw new Error("expected materialized Bases");
    const hiddenNodeId = hidden.nodeId;
    if (!hiddenNodeId) throw new Error("expected the hidden Base to have a node");
    for (const [baseId, rows] of [
      [readable.id, ["open", "open", "done"]],
      [hidden.id, ["open", "done"]],
    ] as const) {
      for (const [index, stage] of rows.entries()) {
        await client.bases.createChangeRequest({
          baseId,
          fields: { name: `row-${index}`, stage },
          message: `seed ${stage}`,
          autoMerge: true,
        });
      }
    }
    await client.nodes.updateVisibility({ nodeId: hiddenNodeId, visibility: "private" });

    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-aggregates-dashboard",
      name: "Aggregates Dashboard",
      body: "# Dashboard\n",
    });
    if (!("node" in doc) || !doc.node) throw new Error("expected a materialized Doc");
    const created = await client.embedLinks.create({
      type: "node",
      typeId: doc.node.id,
      expiresInMinutes: 30,
      framePolicy: { mode: "top-level-only", allowedOrigins: [] },
    });
    const secret = new URL(created.url).searchParams.get("token") ?? "";
    const embedContext = await resolveEmbedRequestContext(created.id, secret);
    if (!embedContext) throw new Error("expected the fresh capability to resolve");
    // Strip the creator's own grant on the hidden Base: private + no principal
    // row is a Base the creator — and therefore the link — cannot read.
    const db = await getDb();
    await db
      .delete(busabaseNodePrincipals)
      .where(inArray(busabaseNodePrincipals.nodeId, [hiddenNodeId]));

    const runtime = createRouterClient(airAppEmbedDataRouter);
    await runWithEmbedContext(embedContext, async () => {
      for (const surface of [client, runtime]) {
        // Readable Base: the reads a dashboard needs all answer.
        await expect(surface.records.count({ baseId: readable.id })).resolves.toEqual({ total: 3 });
        const grouped = await surface.records.groupBy({ baseId: readable.id, fieldSlug: "stage" });
        expect(grouped.total).toBe(3);
        expect(grouped.groups).toEqual(
          expect.arrayContaining([
            { value: "open", count: 2 },
            { value: "done", count: 1 },
          ]),
        );
        const page = await surface.records.listPage({ baseId: readable.id, page: 1, pageSize: 10 });
        expect(page.records).toHaveLength(3);
        await expect(
          surface.records.search({ baseId: readable.id, fieldSlug: "name", valueText: "row-0" }),
        ).resolves.toHaveLength(1);

        // Hidden Base: a 404 from every record read, exactly as for a Base that
        // does not exist — never an empty page that reads as "no records".
        await expect(surface.records.list({ baseId: hidden.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(surface.records.count({ baseId: hidden.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          surface.records.groupBy({ baseId: hidden.id, fieldSlug: "stage" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          surface.records.listPage({ baseId: hidden.id, page: 1, pageSize: 10 }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          surface.records.search({ baseId: hidden.id, fieldSlug: "name", valueText: "row-0" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        // Unscoped: the whole-space count is the readable Base alone.
        await expect(surface.records.count({})).resolves.toEqual({ total: 3 });
      }

      // The space-scoped surface stays refused on the core router.
      await expect(client.changeRequests.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.auditEvents.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
