import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
  listBudaConnections: vi.fn(async () => []),
  getBudaConnection: vi.fn(async (slug: string) =>
    new Map([
      [
        "buda:agent-1",
        {
          slug: "buda:agent-1",
          agentId: "agent-1",
          agentName: "Rex",
          accessToken: "access-agent-1",
        },
      ],
      [
        "buda:agent-2",
        {
          slug: "buda:agent-2",
          agentId: "agent-2",
          agentName: "Ada",
          accessToken: "access-agent-2",
        },
      ],
    ]).get(slug),
  ),
}));

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("../../../context", () => ({ getContextActorId: () => undefined }));
vi.mock("./buda-connection", () => ({
  getBudaAcpUrl: (agentId: string) => `wss://buda.example/api/acp?agentId=${agentId}`,
  getBudaConnection: mocks.getBudaConnection,
  listBudaConnections: mocks.listBudaConnections,
}));

import { listCatalog, resolveLaunch } from "./agent-catalog";

describe("agent catalog availability", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 })),
    );
  });

  it("lists Claude Code and Codex as coming soon and unavailable", async () => {
    const catalog = await listCatalog();
    const claude = catalog.find((entry) => entry.slug === "claude-acp");
    const codex = catalog.find((entry) => entry.slug === "codex-acp");

    expect(claude).toMatchObject({
      comingSoon: true,
      available: false,
      unavailableReason: "Coming soon.",
    });
    expect(codex).toMatchObject({
      comingSoon: true,
      available: false,
      unavailableReason: "Coming soon.",
    });
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  it("rejects direct launch attempts for coming-soon agents", async () => {
    await expect(resolveLaunch("claude-acp")).rejects.toThrow("Claude Code is coming soon.");
    await expect(resolveLaunch("codex-acp")).rejects.toThrow("Codex CLI is coming soon.");
  });

  it("preserves each selected Buda connection identity", async () => {
    await expect(resolveLaunch("buda:agent-1")).resolves.toEqual({
      slug: "buda:agent-1",
      name: "Rex",
      transport: "remote-websocket",
      url: "wss://buda.example/api/acp?agentId=agent-1",
      authHeader: "Bearer access-agent-1",
    });
    await expect(resolveLaunch("buda:agent-2")).resolves.toEqual({
      slug: "buda:agent-2",
      name: "Ada",
      transport: "remote-websocket",
      url: "wss://buda.example/api/acp?agentId=agent-2",
      authHeader: "Bearer access-agent-2",
    });
  });
});
