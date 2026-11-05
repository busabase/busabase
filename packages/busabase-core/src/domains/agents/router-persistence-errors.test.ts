import { createRouterClient } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock("./logic/agent-session-manager", async (original) => ({
  ...(await original<typeof import("./logic/agent-session-manager")>()),
  createAgentSession: mocks.createSession,
}));

const { agentsRouter } = await import("./router");
const client = createRouterClient(agentsRouter, { context: {} });
afterEach(() => {
  vi.restoreAllMocks();
  mocks.createSession.mockReset();
});

describe("Agent RPC persistence failure boundary", () => {
  it("returns an opaque reference instead of a nested SQL exception and bind values", async () => {
    const privateValue = "sk_qa_rpc_private_value_never_display";
    const failure = Object.assign(new Error(`Failed query INSERT secret_params ${privateValue}`), {
      query: "INSERT INTO busabase_agent_sessions VALUES ($1)",
      params: [privateValue],
      cause: Object.assign(new Error(privateValue), {
        code: "23505",
        constraint: "busabase_agent_sessions_pkey",
      }),
    });
    mocks.createSession.mockRejectedValue(failure);
    const logs = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await client.sessions.create({ slug: "buda" }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const message = result instanceof Error ? result.message : "";
    expect(message).toMatch(/Reference: diag_[a-f0-9]{32}/);
    expect(message).not.toContain(privateValue);
    expect(message).not.toContain("INSERT");
    const record = logs.mock.calls.find(
      (call) => (call[1] as { event?: string } | undefined)?.event === "rpc_storage_failed",
    )?.[1];
    expect(record).toMatchObject({ stage: "rpc", sqlState: "23505" });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(privateValue);
  });

  it("masks a query-builder failure even if the nested driver has no machine code", async () => {
    mocks.createSession.mockRejectedValue(
      Object.assign(new Error("Failed query private SQL"), {
        query: "private SQL",
        params: ["private bind"],
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(client.sessions.create({ slug: "buda" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("preserves actionable domain guidance", async () => {
    mocks.createSession.mockRejectedValue(new Error("This session has ended."));
    await expect(client.sessions.create({ slug: "buda" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This session has ended.",
    });
  });
});
