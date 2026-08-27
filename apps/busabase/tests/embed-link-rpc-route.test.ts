import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDemoMode: vi.fn(),
  resolveEmbedRequestContext: vi.fn(),
  rpcHandle: vi.fn(),
  runWithBusabaseContext: vi.fn(async (_context: unknown, callback: () => Promise<Response>) =>
    callback(),
  ),
  runWithEmbedContext: vi.fn(async (_context: unknown, callback: () => Promise<Response>) =>
    callback(),
  ),
  runWithLocalContext: vi.fn(async (_context: unknown, callback: () => Promise<Response>) =>
    callback(),
  ),
}));

vi.mock("@orpc/server/fetch", () => ({
  RPCHandler: class {
    handle(request: Request, options: unknown) {
      return mocks.rpcHandle(request, options);
    }
  },
}));
vi.mock("busabase-core/context", () => ({
  runWithBusabaseContext: mocks.runWithBusabaseContext,
  runWithEmbedContext: mocks.runWithEmbedContext,
  runWithLocalContext: mocks.runWithLocalContext,
}));
vi.mock("busabase-core/domains/agents/logic/agent-origin-guard", () => ({
  checkAgentsRequestOrigin: () => ({ allowed: true }),
}));
vi.mock("busabase-core/domains/embed-links/logic", () => ({
  resolveEmbedRequestContext: mocks.resolveEmbedRequestContext,
}));
vi.mock("busabase-core/router", () => ({ busabaseRouter: {} }));
vi.mock("busabase-core/router-demo", () => ({ busabaseDemoRouter: {} }));
vi.mock("openlib/ui/dashboard/demo", () => ({ resolveDemoMode: mocks.resolveDemoMode }));
vi.mock("~/domains/vault/logic/vault", () => ({
  readBuiltinVaultRuntimeEnv: vi.fn(),
}));
vi.mock("~/lib/local-user", () => ({ getLocalUserName: () => "Local User" }));

import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  encodeEmbedCapability,
} from "busabase-core/domains/embed-links/capability";
import { POST } from "../src/app/api/rpc/[[...rest]]/route";

const publicId = "emb_Abcdefghijklmno1";
const secret = "s".repeat(43);

const requestWithCapability = (capability = encodeEmbedCapability(publicId, secret)) =>
  new Request("http://localhost:15419/api/rpc/nodes/list", {
    method: "POST",
    headers: {
      [EMBED_RUNTIME_CAPABILITY_HEADER]: capability,
    },
  });

describe("Desktop RPC embed capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDemoMode.mockReturnValue({ useCase: null, locale: undefined });
    mocks.rpcHandle.mockResolvedValue({
      matched: true,
      response: Response.json({ ok: true }),
    });
  });

  it("runs capability requests through the embed context factory", async () => {
    mocks.resolveEmbedRequestContext.mockResolvedValue({
      actorId: "local-user",
      spaceId: "local",
      restrictedVisibility: false,
    });

    const response = await POST(requestWithCapability());

    expect(response.status).toBe(200);
    expect(mocks.resolveEmbedRequestContext).toHaveBeenCalledWith(publicId, secret);
    // The route hands over exactly what the capability resolved to and nothing
    // else. `visitorKind`, `isSpaceManager` and the read ceiling are pinned by
    // `runWithEmbedContext` itself, so no transport can weaken them by passing
    // its own — which is what this route used to do.
    expect(mocks.runWithEmbedContext).toHaveBeenCalledWith(
      {
        actorId: "local-user",
        spaceId: "local",
        restrictedVisibility: false,
      },
      expect.any(Function),
    );
    expect(mocks.runWithLocalContext).not.toHaveBeenCalled();
  });

  it("fails closed when the capability is no longer active", async () => {
    mocks.resolveEmbedRequestContext.mockResolvedValue(null);

    const response = await POST(requestWithCapability());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.rpcHandle).not.toHaveBeenCalled();
    expect(mocks.runWithLocalContext).not.toHaveBeenCalled();
  });

  it("fails closed instead of treating a malformed capability as local access", async () => {
    const response = await POST(requestWithCapability("not-a-capability"));

    expect(response.status).toBe(404);
    expect(mocks.resolveEmbedRequestContext).not.toHaveBeenCalled();
    expect(mocks.rpcHandle).not.toHaveBeenCalled();
    expect(mocks.runWithLocalContext).not.toHaveBeenCalled();
  });
});
