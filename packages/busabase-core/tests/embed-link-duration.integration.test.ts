import { createServer } from "node:http";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/client";
import { runWithLocalContext } from "../src/context";
import { resolveEmbedLink } from "../src/domains/embed-links/logic";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

it("creates, expires, and revokes multi-day capabilities over real HTTP and PGLite", async () => {
  await seedScenario("embed-duration-http-proof");
  const raw = createRouterClient(busabaseRouter);
  const doc = await raw.docs.create({
    slug: "duration-doc",
    name: "Duration fixture",
    body: "# Fixture",
    autoMerge: true,
  });
  if (!("node" in doc)) throw new Error("expected materialized Doc");
  const base = await raw.bases.create({
    slug: "duration-records",
    name: "Duration records",
    fields: [{ slug: "title", name: "Title", type: "text" }],
    autoMerge: true,
  });
  if (!base.materialized) throw new Error("expected materialized Base");
  const record = await raw.bases.createChangeRequest({
    baseId: base.id,
    fields: { title: "Duration record" },
    autoMerge: true,
  });
  if (!record.materialized) throw new Error("expected materialized record");
  const pending = await raw.nodes.updateContent({
    nodeId: doc.node.id,
    content: { kind: "doc", body: "# Pending" },
    autoMerge: false,
    message: "Duration proof",
  });
  const handler = new OpenAPIHandler(busabaseRouter);
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(`${origin}${req.url}`, {
        method: req.method,
        headers,
        ...(chunks.length ? { body: Uint8Array.from(Buffer.concat(chunks)).buffer } : {}),
      });
      const result = await runWithLocalContext(
        { vaultRuntimeEnv: {}, localUserName: "Duration verifier", embedOrigin: origin },
        () => handler.handle(request, { context: {} }),
      );
      if (!result.matched) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(result.response.status, Object.fromEntries(result.response.headers));
      res.end(Buffer.from(await result.response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end("Fixture failed");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP listener");
  origin = `http://127.0.0.1:${address.port}`;
  const sdk = createBusabaseClient({ baseUrl: origin });
  const targets = [
    { type: "node" as const, typeId: doc.node.id },
    { type: "record-detail" as const, typeId: record.id },
    { type: "change-request" as const, typeId: pending.id },
  ];
  try {
    for (const target of targets) {
      for (const days of [1, 3, 4, 5, 7]) {
        const link = await sdk.embedLinks.create({ ...target, expiresInMinutes: days * 24 * 60 });
        const createdAt = new Date(link.createdAt).getTime();
        expect(new Date(link.expiresAt).getTime() - createdAt).toBe(days * 24 * 60 * 60_000);
        const secret = new URL(link.url).searchParams.get("token") ?? "";
        expect(
          await resolveEmbedLink(
            link.id,
            secret,
            new Date(createdAt + days * 24 * 60 * 60_000 - 1000),
          ),
        ).not.toBeNull();
        expect(await resolveEmbedLink(link.id, secret, new Date(link.expiresAt))).toBeNull();
        const listed = await sdk.embedLinks.list({ type: target.type, typeId: target.typeId });
        expect(listed.find((entry) => entry.id === link.id)?.expiresAt).toBe(link.expiresAt);
        expect(JSON.stringify(listed)).not.toContain(secret);
        expect(await sdk.embedLinks.revoke({ id: link.id })).toEqual({ revoked: true });
        expect(await resolveEmbedLink(link.id, secret)).toBeNull();
      }
    }
    const defaultLink = await sdk.embedLinks.create(targets[0]);
    expect(
      new Date(defaultLink.expiresAt).getTime() - new Date(defaultLink.createdAt).getTime(),
    ).toBe(15 * 60_000);
    await sdk.embedLinks.revoke({ id: defaultLink.id });
    for (const expiresInMinutes of [0, 1.5, 10081]) {
      const response = await fetch(`${origin}/api/v1/embed-links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...targets[0], expiresInMinutes }),
      });
      expect(response.status).toBe(400);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 90_000);
