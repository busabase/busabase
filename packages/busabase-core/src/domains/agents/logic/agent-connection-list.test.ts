import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  budaConnections: [] as Array<{ slug: string; agentId: string; agentName: string }>,
}));

vi.mock("./buda-connection", () => ({
  listBudaConnections: async () => mocks.budaConnections,
}));

import { listAgentConnections } from "./agent-connection-list";

describe("listAgentConnections", () => {
  beforeEach(() => {
    mocks.budaConnections.length = 0;
  });

  it("maps saved Buda connection rows to agent connections", async () => {
    mocks.budaConnections.push(
      { slug: "buda:agent-2", agentId: "agent-2", agentName: "Ada" },
      { slug: "buda:agent-1", agentId: "agent-1", agentName: "Rex" },
    );

    await expect(listAgentConnections()).resolves.toEqual([
      {
        slug: "buda:agent-2",
        agentName: "Ada",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
      },
      {
        slug: "buda:agent-1",
        agentName: "Rex",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
      },
    ]);
  });

  it("returns no connections when there are no saved rows", async () => {
    await expect(listAgentConnections()).resolves.toEqual([]);
  });
});
