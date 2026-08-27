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

  // `getContextActorId` is mocked to `undefined` above — that is the OSS /
  // desktop host, where a local agent runs on the user's own machine.
  it("offers Claude Code and Codex on a local host, once their binary is present", async () => {
    const catalog = await listCatalog();
    const claude = catalog.find((entry) => entry.slug === "claude-acp");
    const codex = catalog.find((entry) => entry.slug === "codex-acp");

    expect(claude).toMatchObject({ comingSoon: false, available: true, unavailableReason: null });
    expect(codex).toMatchObject({ comingSoon: false, available: true, unavailableReason: null });
    // Availability is decided by probing this machine, not by a static flag.
    expect(mocks.spawnSync).toHaveBeenCalled();
  });

  it("says so when the local host is missing the binary, rather than claiming coming-soon", async () => {
    mocks.spawnSync.mockReturnValueOnce({ status: 1 }).mockReturnValueOnce({ status: 1 });
    const catalog = await listCatalog();

    expect(catalog.find((entry) => entry.slug === "claude-acp")).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining("was not found on this machine"),
    });
  });

  it("launches a local agent on a local host", async () => {
    await expect(resolveLaunch("codex-acp")).resolves.toMatchObject({
      slug: "codex-acp",
      transport: "local-subprocess",
      command: "npx",
      args: ["--yes", "@agentclientprotocol/codex-acp@1.1.14"],
    });
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
