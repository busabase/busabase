import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveEmbedRequestContext: vi.fn() }));
vi.mock("busabase-core/domains/embed-links/logic", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveEmbedRequestContext: mocks.resolveEmbedRequestContext,
}));
vi.mock("~/domains/vault/logic/vault", () => ({
  readBuiltinVaultRuntimeEnv: async () => ({}),
}));
vi.mock("~/lib/local-user", () => ({ getLocalUserName: () => "Local User" }));
vi.mock("busabase-core/router-demo", () => ({ busabaseDemoRouter: {} }));
// A boundary probe deliberately isolates host attribution from the real router's
// read-only embed guard. It is NOT evidence that Embed Links can run agents.
vi.mock("busabase-core/router", async (importOriginal) => {
  const { busabaseRouter } = await importOriginal<typeof import("busabase-core/router")>();
  const { os } = await import("@orpc/server");
  const { PromptAgentSessionInputSchema } = await import("busabase-contract/domains/agents/types");
  const { getContextEmbedOrigin, getContextSpaceId, isEmbedVisitor } = await import(
    "busabase-core/context"
  );
  const { validateAgentPromptResourceContext } = await import(
    "../../../packages/busabase-core/src/domains/agents/logic/agent-prompt-context"
  );
  return {
    busabaseRouter: {
      ...busabaseRouter,
      __promptContextProbe: os.input(PromptAgentSessionInputSchema).handler(({ input }) => ({
        resourceContext: validateAgentPromptResourceContext(input.resourceContext),
        origin: getContextEmbedOrigin(),
        spaceId: getContextSpaceId(),
        embed: isEmbedVisitor(),
      })),
    },
  };
});

import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  encodeEmbedCapability,
} from "busabase-core/domains/embed-links/capability";
import { POST } from "../src/app/api/rpc/[[...rest]]/route";

let server: Server;
let origin: string;
const capability = encodeEmbedCapability("emb_Abcdefghijklmno1", "s".repeat(43));
const snapshot = (sourceOrigin = origin, edition: "desktop" | "cloud" = "desktop") =>
  createPromptResourceContext(
    createAgentPromptEnvelope({
      scenario: { id: "read-doc", title: "Read doc" },
      target: { nodeId: "nod_embed", nodeName: "Embedded doc", nodeType: "doc" },
      source: {
        origin: sourceOrigin,
        edition,
        ...(edition === "cloud" ? { spaceId: "org-a" } : {}),
      },
      segments: [{ kind: "task", text: "Read the complete context. 完整上下文。\n" }],
    }),
    "embed-prompt",
  );

const call = (context = snapshot(), token = capability, path = "__promptContextProbe") =>
  fetch(`${origin}/api/rpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [EMBED_RUNTIME_CAPABILITY_HEADER]: token,
      origin: "https://attacker.test",
      referer: "https://attacker.test/embed",
      forwarded: "host=attacker.test;proto=https",
      "x-forwarded-host": "attacker.test",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify({
      json: { sessionId: "ags_probe", text: "", resourceContext: [context] },
    }),
  });

describe("OSS embed prompt request origin over HTTP", () => {
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      try {
        const parts: Buffer[] = [];
        for await (const part of req) parts.push(Buffer.from(part));
        const request = new Request(`${origin}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(parts),
        });
        const response = await POST(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  beforeEach(() => {
    mocks.resolveEmbedRequestContext.mockReset().mockResolvedValue({
      actorId: "local-user",
      spaceId: "local",
      restrictedVisibility: false,
      embedTargetNodeId: "nod_embed",
      // Even a stale resolver value cannot replace the transport's origin.
      embedOrigin: "https://stale.test",
    });
  });

  it("validates a complete context-only snapshot against the actual request origin", async () => {
    const context = snapshot();
    const response = await call(context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      json: { resourceContext: [context], origin, spaceId: "local", embed: true },
    });
  });

  it.each(["foreign origin", "foreign edition"])(
    "rejects %s despite matching forged headers",
    async (variant) => {
      const response = await call(
        variant === "foreign origin"
          ? snapshot("https://attacker.test")
          : snapshot(origin, "cloud"),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("different Busabase");
    },
  );

  it("still forbids actual Agent submission through the production router", async () => {
    const response = await call(snapshot(), capability, "agents/sessions/prompt");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("FORBIDDEN");
  });

  it.each(["malformed", "revoked"])("keeps a %s capability closed", async (variant) => {
    if (variant === "revoked") mocks.resolveEmbedRequestContext.mockResolvedValue(null);
    const response = await call(
      snapshot(),
      variant === "malformed" ? "not-a-capability" : capability,
    );
    expect(response.status).toBe(404);
  });
});
