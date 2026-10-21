import { createRouterClient } from "@orpc/server";
import type { BaseVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/client";
import {
  runWithAnonymousContext,
  runWithBusabaseContext,
  runWithEmbedContext,
} from "../src/context";
import { busabaseNodePrincipals } from "../src/db/schema";
import { createAirAppEmbedBridgeHandler } from "../src/domains/embed-links/bridge";
import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  EMBED_RUNTIME_NODE_HEADER,
  encodeEmbedCapability,
} from "../src/domains/embed-links/capability";
import { resolveEmbedRequestContext } from "../src/domains/embed-links/logic";
import { airAppEmbedDataRouter } from "../src/domains/embed-links/runtime-router";
import { getPublicScopeOfNodeRef } from "../src/logic/node-acl";
import { setNodeShare } from "../src/logic/node-share";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

describe("shared AirApp bootstrap through the HTTP bridge", () => {
  it("boots public and capability runtimes with sanitized identity and scoped reads", async () => {
    const { db, spaceId } = await seedScenario("runtime-bootstrap");
    const member = createRouterClient(busabaseRouter);
    const ownerId = "sensitive-capability-creator";
    const asOwner = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext({ db, spaceId, actorId: ownerId, isSpaceManager: true }, fn);
    await asOwner(() =>
      member.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          { kind: "create", nodeType: "folder", slug: "shared-launch", name: "Shared launch" },
        ],
      }),
    );
    const folders = await asOwner(() => member.nodes.list({ types: ["folder"] }));
    const folder = folders.find((node) => node.slug === "shared-launch");
    if (!folder) throw new Error("expected fixture folder");
    const app = await asOwner(() =>
      member.fileTrees.create({
        type: "airapp",
        autoMerge: true,
        slug: "launch-desk",
        name: "Launch Desk",
        parentNodeId: folder.id,
      }),
    );
    if (!app.materialized) throw new Error("expected fixture app");
    const createBase = (slug: string, parentNodeId?: string) =>
      asOwner(() =>
        member.bases.create({
          autoMerge: true,
          slug,
          name: slug,
          parentNodeId,
          fields: [
            { slug: "name", name: "Name", type: "text" },
            { slug: "ready", name: "Ready", type: "checkbox" },
          ],
        }),
      );
    const visible = await createBase("products", folder.id);
    const hidden = await createBase("secret-products");
    if (!visible.materialized || !hidden.materialized) throw new Error("expected fixture Bases");
    for (const baseId of [visible.id, hidden.id]) {
      await asOwner(() =>
        member.bases.createChangeRequest({
          autoMerge: true,
          baseId,
          fields: { name: "Launch product", ready: true },
        }),
      );
    }
    await asOwner(() =>
      member.nodes.updateVisibility({ nodeId: hidden.nodeId, visibility: "private" }),
    );
    await db.delete(busabaseNodePrincipals).where(eq(busabaseNodePrincipals.nodeId, hidden.nodeId));
    const other = await runWithBusabaseContext(
      { db, spaceId: "other-workspace", actorId: ownerId, isSpaceManager: true },
      () =>
        member.bases.create({ autoMerge: true, slug: "other-products", name: "Other products" }),
    );
    if (!other.materialized) throw new Error("expected other-space Base");
    await runWithBusabaseContext(
      { db, spaceId: "other-workspace", actorId: ownerId, isSpaceManager: true },
      () => member.bases.createChangeRequest({ autoMerge: true, baseId: other.id, fields: {} }),
    );
    await asOwner(() => setNodeShare(folder.id, { scope: "public", capability: "read" }));
    const link = await asOwner(() =>
      member.embedLinks.create({ type: "node", typeId: app.node.id }),
    );
    const secret = new URL(link.url).searchParams.get("token") ?? "";
    const capability = encodeEmbedCapability(link.id, secret);
    let publicResolutions = 0;
    const handler = createAirAppEmbedBridgeHandler({
      db,
      rpcPrefix: "/api/rpc/core",
      withHostContext: asOwner,
      resolvePublicShareAuthority: async (_request, nodeId) => {
        publicResolutions++;
        // Resolve live inherited sharing through the production ACL, on every
        // request; no fake authorization success or member session fallback.
        const shared = await runWithAnonymousContext({ db, spaceId }, () =>
          getPublicScopeOfNodeRef(nodeId, "airapp"),
        );
        return shared ? (fn) => runWithAnonymousContext({ db, spaceId }, fn) : null;
      },
    });
    const headers = (token?: string) => ({
      [EMBED_RUNTIME_NODE_HEADER]: app.node.id,
      ...(token === undefined ? {} : { [EMBED_RUNTIME_CAPABILITY_HEADER]: token }),
      authorization: "Bearer ambient-member-must-be-ignored",
      cookie: "session=ambient-member-must-be-ignored",
    });
    const bridgeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      return handler(request, {
        params: Promise.resolve({ path: new URL(request.url).pathname.split("/").filter(Boolean) }),
      });
    };
    const runtimeClient = (token?: string) =>
      createBusabaseClient({
        baseUrl: "http://runtime.test",
        headers: headers(token),
        fetch: bridgeFetch,
      });

    for (const client of [runtimeClient(), runtimeClient(capability)]) {
      // The failing app calls auth.verify BEFORE discovering its folder/Bases.
      const auth = await client.auth.verify();
      expect(auth).toEqual({
        space: {
          id: spaceId,
          name: "Shared Workspace",
          slug: null,
          plan: null,
          nodeVisibilityMode: "restricted",
        },
        user: { id: "airapp-runtime-visitor", name: "Visitor", email: null, image: null },
        member: { userId: "airapp-runtime-visitor", spaceId, role: "visitor" },
        spaces: [],
        credentialPermissionLevel: "read",
        effectivePermissionLevel: "read",
      });
      expect(JSON.stringify(auth)).not.toContain(ownerId);
      await expect(
        client.nodes.get({ nodeId: folder.slug, type: "folder" }),
      ).resolves.toMatchObject({
        node: { id: folder.id },
      });
      expect((await client.bases.list({})).map((base: BaseVO) => base.id)).toEqual([visible.id]);
      await expect(client.bases.get({ baseId: visible.id })).resolves.toMatchObject({
        id: visible.id,
      });
      await expect(client.records.list({ baseId: visible.id })).resolves.toMatchObject({
        records: [expect.objectContaining({ baseId: visible.id })],
      });
      await expect(client.records.count({})).resolves.toEqual({ total: 1 });
      await expect(
        client.records.groupBy({ baseId: visible.id, fieldSlug: "ready" }),
      ).resolves.toMatchObject({ total: 1 });
      await expect(
        client.records.search({ fieldSlug: "name", valueText: "Launch product" }),
      ).resolves.toHaveLength(1);
      for (const deniedBase of [hidden, other]) {
        await expect(client.bases.get({ baseId: deniedBase.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        // A Base the runtime cannot see is 404 on every read, the same answer as a
        // Base that does not exist — never an empty result that looks like "no rows".
        await expect(client.records.count({ baseId: deniedBase.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(client.records.list({ baseId: deniedBase.id })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
        await expect(
          client.records.search({
            baseId: deniedBase.id,
            fieldSlug: "name",
            valueText: "Launch product",
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(
          client.records.groupBy({ baseId: deniedBase.id, fieldSlug: "ready" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      await expect(
        client.bases.createChangeRequest({ baseId: visible.id, fields: { name: "Injected" } }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(client.assets.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    const vault = await bridgeFetch(
      new Request("http://runtime.test/api/v1/vault", { headers: headers() }),
    );
    expect(vault.status).toBe(404);

    // RPC uses the same dedicated implementation, while ordinary auth stays denied.
    const rpcResponse = await bridgeFetch(
      new Request("http://runtime.test/api/rpc/core/auth/verify", { headers: headers() }),
    );
    expect(rpcResponse.status).toBe(200);
    expect(await rpcResponse.text()).toContain("airapp-runtime-visitor");
    await runWithAnonymousContext({ db, spaceId }, async () => {
      await expect(member.auth.verify()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    const embedContext = await asOwner(() => resolveEmbedRequestContext(link.id, secret));
    if (!embedContext) throw new Error("expected valid capability context");
    await runWithEmbedContext(embedContext, async () => {
      await expect(member.auth.verify()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    const runtime = createRouterClient(airAppEmbedDataRouter);
    await expect(asOwner(() => runtime.auth.verify())).rejects.toMatchObject({ code: "FORBIDDEN" });

    for (const invalid of ["malformed", encodeEmbedCapability(link.id, "x".repeat(43))]) {
      const resolutionsBefore = publicResolutions;
      await expect(runtimeClient(invalid).auth.verify()).rejects.toMatchObject({
        status: 404,
      });
      expect(publicResolutions).toBe(resolutionsBefore);
    }
    await asOwner(() => member.embedLinks.revoke({ id: link.id }));
    const resolutionsBefore = publicResolutions;
    await expect(runtimeClient(capability).auth.verify()).rejects.toMatchObject({
      status: 404,
    });
    expect(publicResolutions).toBe(resolutionsBefore);
    await asOwner(() => setNodeShare(folder.id, { scope: "none", capability: "read" }));
    await expect(runtimeClient().auth.verify()).rejects.toMatchObject({ status: 404 });
  });
});
