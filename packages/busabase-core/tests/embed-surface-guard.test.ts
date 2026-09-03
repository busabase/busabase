import { createRouterClient } from "@orpc/server";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runWithEmbedContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodePrincipals } from "../src/db/schema";
import { resolveEmbedRequestContext } from "../src/domains/embed-links/logic";
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
});
