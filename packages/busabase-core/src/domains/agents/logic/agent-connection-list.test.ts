import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  budaConnections: [] as Array<{
    slug: string;
    agentId: string;
    agentName: string;
    ownedByCurrentUser: boolean;
  }>,
  requestedScopes: [] as string[],
  sessions: [] as AgentSessionVO[],
}));

vi.mock("./buda-connection", () => ({
  listBudaConnections: async (scope: string) => {
    mocks.requestedScopes.push(scope);
    return mocks.budaConnections;
  },
}));
vi.mock("./agent-session-manager", () => ({
  listAgentSessions: async () => mocks.sessions,
}));

import { listAgentConnections } from "./agent-connection-list";

/** `listAgentSessions` returns newest-first; these fixtures keep that order. */
const session = (over: Partial<AgentSessionVO> & { slug: string }): AgentSessionVO => ({
  id: `sess-${over.slug}-${over.createdAt ?? "1"}`,
  agentName: "Codex CLI",
  transport: "local-subprocess",
  status: "idle",
  createdAt: "2026-08-27T10:00:00.000Z",
  lastActivityAt: "2026-08-27T10:00:00.000Z",
  error: null,
  ...over,
});

describe("listAgentConnections", () => {
  beforeEach(() => {
    mocks.budaConnections.length = 0;
    mocks.requestedScopes.length = 0;
    mocks.sessions.length = 0;
  });

  it("maps saved Buda connection rows to agent connections", async () => {
    mocks.budaConnections.push(
      {
        slug: "buda:agent-2",
        agentId: "agent-2",
        agentName: "Ada",
        ownedByCurrentUser: false,
      },
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Rex",
        ownedByCurrentUser: true,
      },
    );

    await expect(listAgentConnections("space")).resolves.toEqual([
      {
        slug: "buda:agent-2",
        agentName: "Ada",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
        ownedByCurrentUser: false,
      },
      {
        slug: "buda:agent-1",
        agentName: "Rex",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
        ownedByCurrentUser: true,
      },
    ]);
    expect(mocks.requestedScopes).toEqual(["space"]);
  });

  it("returns no connections when nothing is connected", async () => {
    await expect(listAgentConnections()).resolves.toEqual([]);
    expect(mocks.requestedScopes).toEqual(["mine"]);
  });

  /**
   * The gap un-gating local agents exposed: connecting Codex *is* creating a
   * session, so a list that only read Buda rows could never show it — you
   * could chat with an agent that the Agents list said you did not have.
   */
  it("surfaces a local agent that has a session, since that is its only trace", async () => {
    mocks.sessions.push(session({ slug: "codex-acp" }));

    await expect(listAgentConnections()).resolves.toEqual([
      {
        slug: "codex-acp",
        agentName: "Codex CLI",
        transport: "local-subprocess",
        sessionCount: 1,
        latest: mocks.sessions[0],
        ownedByCurrentUser: true,
      },
    ]);
  });

  it("groups several conversations with one local agent into a single entry", async () => {
    mocks.sessions.push(
      session({ slug: "codex-acp", createdAt: "2026-08-27T12:00:00.000Z" }),
      session({ slug: "codex-acp", createdAt: "2026-08-27T09:00:00.000Z" }),
      session({ slug: "codex-acp", createdAt: "2026-08-27T08:00:00.000Z" }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ slug: "codex-acp", sessionCount: 3 });
    // Newest-first input, so the first one seen is the latest.
    expect(connections[0]?.latest?.createdAt).toBe("2026-08-27T12:00:00.000Z");
  });

  /**
   * Buda's credential row is the connection and outlives its conversations, so
   * a Buda session must never produce a second entry beside it.
   */
  it("does not let a Buda session duplicate its own saved connection", async () => {
    mocks.budaConnections.push({
      slug: "buda:agent-1",
      agentId: "agent-1",
      agentName: "Rex",
      ownedByCurrentUser: true,
    });
    mocks.sessions.push(
      session({ slug: "buda:agent-1", agentName: "Rex", transport: "remote-websocket" }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ slug: "buda:agent-1", transport: "remote-websocket" });
  });

  it("lists both transports together, sorted by name", async () => {
    mocks.budaConnections.push({
      slug: "buda:agent-1",
      agentId: "agent-1",
      agentName: "Rex",
      ownedByCurrentUser: true,
    });
    mocks.sessions.push(session({ slug: "codex-acp", agentName: "Codex CLI" }));

    const connections = await listAgentConnections();
    expect(connections.map((connection) => connection.agentName)).toEqual(["Codex CLI", "Rex"]);
  });
});
