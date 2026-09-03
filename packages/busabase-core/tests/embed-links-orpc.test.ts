import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/client";
import { runWithLocalContext } from "../src/context";
import {
  EMBED_PUBLIC_ID_PATTERN,
  EMBED_SECRET_PATTERN,
  resolveEmbedLink,
} from "../src/domains/embed-links/logic";
import { ROOT_NODE_ID } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";
import { seedScenario } from "./helpers/seed-scenario";

describe("embed links — Desktop oRPC integration", () => {
  it("creates, lists, resolves, and revokes a capability link", async () => {
    await seedScenario("embed-links-crud");
    const client = createRouterClient(busabaseRouter);
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-runbook",
      name: "Embed Runbook",
      body: "# Runbook\n\nDesktop embed content.\n",
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");

    const created = await client.embedLinks.create({
      type: "node",
      typeId: doc.node.id,
      expiresInMinutes: 30,
      framePolicy: { mode: "origins", allowedOrigins: ["https://viewer.example"] },
    });
    const url = new URL(created.url);
    const secret = url.searchParams.get("token") ?? "";

    expect(EMBED_PUBLIC_ID_PATTERN.test(created.id)).toBe(true);
    expect(EMBED_SECRET_PATTERN.test(secret)).toBe(true);
    expect(created.targetName).toBe("Embed Runbook");
    expect(created.nodeType).toBe("doc");
    expect(created.framePolicy).toEqual({
      mode: "origins",
      allowedOrigins: ["https://viewer.example"],
    });
    expect(created.iframeUrl).toContain("view=iframe");

    const listed = await client.embedLinks.list({ type: "node", typeId: doc.node.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, active: true, targetName: "Embed Runbook" });
    expect(JSON.stringify(listed)).not.toContain(secret);

    const resolved = await resolveEmbedLink(created.id, secret);
    expect(resolved).toMatchObject({
      id: created.id,
      type: "node",
      detail: {
        type: "doc",
        doc: { body: expect.stringContaining("Desktop embed content") },
      },
    });
    await expect(resolveEmbedLink(created.id, "x".repeat(43))).resolves.toBeNull();

    await expect(client.embedLinks.revoke({ id: created.id })).resolves.toEqual({ revoked: true });
    await expect(resolveEmbedLink(created.id, secret)).resolves.toBeNull();
    expect((await client.embedLinks.list({ typeId: doc.node.id }))[0]?.active).toBe(false);
  });

  it("keeps demo mode non-persistent", async () => {
    const demo = createRouterClient(busabaseDemoRouter);
    await expect(demo.embedLinks.list({})).resolves.toEqual([]);
    await expect(
      demo.embedLinks.create({ type: "node", typeId: "nod_demo" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses the local request origin for generated capability URLs", async () => {
    await seedScenario("embed-links-request-origin");
    const client = createRouterClient(busabaseRouter);
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-request-origin",
      name: "Embed Request Origin",
      body: "# Request origin",
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");

    const created = await runWithLocalContext(
      {
        vaultRuntimeEnv: {},
        localUserName: "Local Admin",
        embedOrigin: "http://127.0.0.1:43127",
      },
      () => client.embedLinks.create({ type: "node", typeId: doc.node.id }),
    );

    expect(new URL(created.url).origin).toBe("http://127.0.0.1:43127");
    expect(new URL(created.iframeUrl).origin).toBe("http://127.0.0.1:43127");
  });

  it("serves embed-link administration on the shared /api/v1 REST paths", async () => {
    await seedScenario("embed-links-openapi");
    const client = createRouterClient(busabaseRouter);
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-openapi-proof",
      name: "Embed OpenAPI Proof",
      body: "# OpenAPI proof",
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");

    const handler = new OpenAPIHandler(busabaseRouter);
    const created = await handler.handle(
      new Request("http://localhost:15419/api/v1/embed-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "node", typeId: doc.node.id }),
      }),
      { context: {} },
    );

    expect(created.matched).toBe(true);
    expect(created.response.status).toBe(200);
    await expect(created.response.json()).resolves.toMatchObject({
      type: "node",
      typeId: doc.node.id,
      targetName: "Embed OpenAPI Proof",
    });
  });

  it("creates Node and Change Request embeds through the SDK and raw REST API", async () => {
    await seedScenario("embed-links-sdk-rest");
    const client = createRouterClient(busabaseRouter);
    const handler = new OpenAPIHandler(busabaseRouter);
    const fetchThroughOpenApi = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const result = await handler.handle(request, { context: {} });
      return result.matched
        ? result.response
        : new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
    };

    const doc = await client.docs.create({
      autoMerge: true,
      slug: "embed-sdk-proof",
      name: "Embed SDK Proof",
      body: "# SDK proof",
    });
    if (!("node" in doc)) throw new Error("expected a materialized Doc");

    const sdk = createBusabaseClient({
      baseUrl: "http://localhost:15419",
      fetch: fetchThroughOpenApi as typeof fetch,
    });
    const sdkCreated = await sdk.embedLinks.create({
      type: "node",
      typeId: doc.node.id,
      expiresInMinutes: 20,
    });
    const sdkUrl = new URL(sdkCreated.url);
    const sdkToken = sdkUrl.searchParams.get("token") ?? "";

    expect(sdkCreated).toMatchObject({
      type: "node",
      typeId: doc.node.id,
      targetName: "Embed SDK Proof",
      active: true,
    });
    expect(sdkCreated.iframeUrl).toContain("view=iframe");
    await expect(resolveEmbedLink(sdkCreated.id, sdkToken)).resolves.toMatchObject({
      type: "node",
      detail: { type: "doc" },
    });

    const pendingDoc = await client.nodes.updateContent({
      nodeId: doc.node.id,
      content: { kind: "doc", body: "# Pending REST proof" },
      autoMerge: false,
      message: "Update embed REST proof",
    });

    const apiResponse = await fetchThroughOpenApi("http://localhost:15419/api/v1/embed-links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "change-request",
        typeId: pendingDoc.id,
        expiresInMinutes: 25,
      }),
    });
    const apiErrorBody = apiResponse.ok ? "" : await apiResponse.clone().text();
    expect(apiResponse.status, apiErrorBody).toBe(200);
    const apiCreated = (await apiResponse.json()) as typeof sdkCreated;
    const apiUrl = new URL(apiCreated.url);
    const apiToken = apiUrl.searchParams.get("token") ?? "";

    expect(apiCreated).toMatchObject({
      type: "change-request",
      typeId: pendingDoc.id,
      active: true,
    });
    expect(apiCreated.iframeUrl).toContain("view=iframe");
    await expect(resolveEmbedLink(apiCreated.id, apiToken)).resolves.toMatchObject({
      type: "change-request",
      changeRequest: { id: pendingDoc.id },
    });
  });

  it("creates a ChangeRequest embed for a pending node create scoped to its parent", async () => {
    await seedScenario("embed-links-pending-node-create");
    const client = createRouterClient(busabaseRouter);
    const pending = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          parentNodeId: ROOT_NODE_ID,
          nodeType: "doc",
          slug: "pending-embed-doc",
          name: "Pending Embed Doc",
        },
      ],
    });

    expect(pending).toMatchObject({ nodeId: null, status: "in_review" });
    const created = await client.embedLinks.create({
      type: "change-request",
      typeId: pending.id,
      framePolicy: { mode: "anywhere", allowedOrigins: [] },
    });
    const url = new URL(created.url);
    const token = url.searchParams.get("token") ?? "";

    expect(created).toMatchObject({
      active: true,
      type: "change-request",
      typeId: pending.id,
    });
    await expect(resolveEmbedLink(created.id, token)).resolves.toMatchObject({
      type: "change-request",
      changeRequest: { id: pending.id, status: "in_review" },
    });
  });
});
