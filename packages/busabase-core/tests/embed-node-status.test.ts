import { createRouterClient } from "@orpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  encodeEmbedCapability,
} from "../src/domains/embed-links/capability";
import { createEmbedStatusRouteHandler } from "../src/domains/embed-links/status-route";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

describe("ordinary-node Embed heartbeat against real PGLite", () => {
  const client = createRouterClient(busabaseRouter);
  let count = 0;
  const fixture = async () => {
    const doc = await client.docs.create({
      autoMerge: true,
      slug: `status-${++count}`,
      name: "Runbook",
      body: "# Private content",
    });
    if (!("node" in doc)) throw new Error("expected a materialized document");
    const link = await client.embedLinks.create({
      type: "node",
      typeId: doc.node.id,
      expiresInMinutes: 1,
    });
    const secret = new URL(link.url).searchParams.get("token") ?? "";
    return { ...link, secret, nodeId: doc.node.id };
  };
  const request = (id: string, secret?: string, extra: Record<string, string> = {}) =>
    new Request(`http://localhost:15419/embed/${id}/status`, {
      headers: {
        ...extra,
        ...(secret ? { [EMBED_RUNTIME_CAPABILITY_HEADER]: encodeEmbedCapability(id, secret) } : {}),
      },
    });
  const context = (publicId: string) => ({ params: Promise.resolve({ publicId }) });

  beforeAll(async () => {
    await seedScenario("embed-node-status");
  });

  it("checks a live link without returning content or exposing the bearer secret", async () => {
    const link = await fixture();
    const result = await createEmbedStatusRouteHandler()(
      request(link.id, link.secret),
      context(link.id),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ state: "active", expiresAt: link.expiresAt });
    expect(result.headers.get("cache-control")).toContain("no-store");
  });

  it("does not accept ambient cookies or a capability naming a different path", async () => {
    const link = await fixture();
    const GET = createEmbedStatusRouteHandler();
    const cookie = `busabase_embed_${link.id}=${encodeEmbedCapability(link.id, link.secret)}; better-auth.session_token=member`;
    expect((await GET(request(link.id, undefined, { cookie }), context(link.id))).status).toBe(404);
    expect((await GET(request(link.id, "x".repeat(43)), context(link.id))).status).toBe(404);
    expect((await GET(request(link.id, link.secret), context("emb_Abcdefghijklmno1"))).status).toBe(
      404,
    );
  });

  it("separates a real expiry from revocation, including after the deadline", async () => {
    const link = await fixture();
    const GET = createEmbedStatusRouteHandler({
      now: () => new Date(new Date(link.expiresAt).getTime() + 1),
    });
    expect((await GET(request(link.id, link.secret), context(link.id))).status).toBe(410);
    await client.embedLinks.revoke({ id: link.id });
    const revoked = await GET(request(link.id, link.secret), context(link.id));
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toEqual({ state: "unavailable" });
  });

  it("revalidates the creator's current authority for both live and expired links", async () => {
    const link = await fixture();
    for (const time of [Date.now(), new Date(link.expiresAt).getTime() + 1]) {
      const GET = createEmbedStatusRouteHandler({
        now: () => new Date(time),
        withHostContext: (fn) =>
          runWithBusabaseContext(
            {
              resolveEmbedActorState: async () => ({
                active: false,
                isSpaceManager: false,
                restrictedVisibility: false,
              }),
            },
            fn,
          ),
      });
      expect((await GET(request(link.id, link.secret), context(link.id))).status).toBe(404);
    }
  });

  it("turns a deleted target into unavailable even if its link row still exists", async () => {
    const link = await fixture();
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId: link.nodeId }],
    });
    for (const time of [Date.now(), new Date(link.expiresAt).getTime() + 1]) {
      const GET = createEmbedStatusRouteHandler({ now: () => new Date(time) });
      expect((await GET(request(link.id, link.secret), context(link.id))).status).toBe(404);
    }
  });

  it.each(["record-detail", "change-request"] as const)(
    "keeps %s previews under the same expiry and revocation checks",
    async (type) => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: `status-detail-${++count}`,
        name: "Delivery",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      });
      const target = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { title: "Only this item" },
        autoMerge: type === "record-detail",
      });
      const link = await client.embedLinks.create({ type, typeId: target.id, expiresInMinutes: 1 });
      const secret = new URL(link.url).searchParams.get("token") ?? "";
      expect(
        (await createEmbedStatusRouteHandler()(request(link.id, secret), context(link.id))).status,
      ).toBe(200);
      const expired = createEmbedStatusRouteHandler({
        now: () => new Date(new Date(link.expiresAt).getTime() + 1),
      });
      expect((await expired(request(link.id, secret), context(link.id))).status).toBe(410);
      const lostCreator = createEmbedStatusRouteHandler({
        withHostContext: (fn) =>
          runWithBusabaseContext(
            {
              resolveEmbedActorState: async () => ({
                active: false,
                isSpaceManager: false,
                restrictedVisibility: false,
              }),
            },
            fn,
          ),
      });
      expect((await lostCreator(request(link.id, secret), context(link.id))).status).toBe(404);
      await client.embedLinks.revoke({ id: link.id });
      expect((await expired(request(link.id, secret), context(link.id))).status).toBe(404);
    },
  );
});
