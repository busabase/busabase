import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  budaConnections: [] as Array<{
    slug: string;
    agentId: string;
    agentName: string;
    ownedByCurrentUser: boolean;
    legacy: boolean;
  }>,
  requestedScopes: [] as string[],
  sessions: [] as AgentSessionVO[],
  normalizeLegacyBudaSessions: vi.fn(),
  envConfig: {} as { token?: string; agentId?: string },
  actorId: undefined as string | undefined,
}));

vi.mock("../../../context", () => ({
  getContextActorId: () => mocks.actorId,
}));
vi.mock("./agent-catalog", () => ({
  localBudaConfig: () => mocks.envConfig,
}));
vi.mock("./buda-connection", () => ({
  listBudaConnections: async (scope: string) => {
    mocks.requestedScopes.push(scope);
    return mocks.budaConnections;
  },
  getBudaSessionSlug: (agentId: string) => `buda:${encodeURIComponent(agentId)}`,
}));
vi.mock("./agent-session-manager", () => ({
  listAgentSessions: async () => mocks.sessions,
}));
vi.mock("./agent-session-store", () => ({
  normalizeLegacyBudaSessions: mocks.normalizeLegacyBudaSessions,
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
  modelOption: null,
  ...over,
});

describe("listAgentConnections", () => {
  beforeEach(() => {
    mocks.budaConnections.length = 0;
    mocks.requestedScopes.length = 0;
    mocks.sessions.length = 0;
    mocks.normalizeLegacyBudaSessions.mockReset();
    mocks.normalizeLegacyBudaSessions.mockResolvedValue(0);
    mocks.envConfig = {};
    mocks.actorId = undefined;
  });

  it("maps saved Buda connection rows to agent connections", async () => {
    mocks.budaConnections.push(
      {
        slug: "buda:agent-2",
        agentId: "agent-2",
        agentName: "Ada",
        ownedByCurrentUser: false,
        legacy: false,
      },
      {
        slug: "buda:agent-1",
        agentId: "agent-1",
        agentName: "Rex",
        ownedByCurrentUser: true,
        legacy: false,
      },
    );

    await expect(listAgentConnections("space")).resolves.toEqual([
      {
        slug: "buda:agent-2",
        agentName: "Ada",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
        connected: true,
        ownedByCurrentUser: false,
      },
      {
        slug: "buda:agent-1",
        agentName: "Rex",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
        connected: true,
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
        connected: true,
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
      legacy: false,
    });
    mocks.sessions.push(
      session({ slug: "buda:agent-1", agentName: "Rex", transport: "remote-websocket" }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      slug: "buda:agent-1",
      transport: "remote-websocket",
      sessionCount: 1,
      latest: mocks.sessions[0],
      connected: true,
    });
  });

  it("lists both transports together, sorted by name", async () => {
    mocks.budaConnections.push({
      slug: "buda:agent-1",
      agentId: "agent-1",
      agentName: "Rex",
      ownedByCurrentUser: true,
      legacy: false,
    });
    mocks.sessions.push(session({ slug: "codex-acp", agentName: "Codex CLI" }));

    const connections = await listAgentConnections();
    expect(connections.map((connection) => connection.agentName)).toEqual(["Codex CLI", "Rex"]);
  });

  it("keeps disconnected remote history reachable with its real transport", async () => {
    mocks.sessions.push(
      session({
        slug: "buda:agent-old",
        agentName: "Archived Agent",
        transport: "remote-websocket",
        status: "ended",
      }),
    );

    await expect(listAgentConnections()).resolves.toEqual([
      {
        slug: "buda:agent-old",
        agentName: "Archived Agent",
        transport: "remote-websocket",
        sessionCount: 1,
        latest: mocks.sessions[0],
        connected: false,
        ownedByCurrentUser: true,
      },
    ]);
  });

  it("does not normalize history from another member's legacy credential", async () => {
    mocks.budaConnections.push({
      slug: "buda:agent-a",
      agentId: "agent-a",
      agentName: "Agent A",
      ownedByCurrentUser: false,
      legacy: true,
    });

    await listAgentConnections("space");

    expect(mocks.normalizeLegacyBudaSessions).not.toHaveBeenCalled();
  });

  /**
   * The dedicated ACP E2E fixture (and any OSS/desktop user who sets
   * BUDA_API_KEY/BUDA_AGENT_ID instead of going through OAuth) has no vault
   * row at all. Without this fallback, `remoteNeedsReconnect` in
   * agent-detail-view.tsx reads this agent as never connected and disables
   * "New session" even though its very first prompt already worked.
   */
  it("surfaces an env-configured Buda agent as connected even with no vault row and no session yet", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-env" };

    await expect(listAgentConnections()).resolves.toEqual([
      {
        slug: "buda",
        agentName: "Buda AI Agent",
        transport: "remote-websocket",
        sessionCount: 0,
        latest: null,
        connected: true,
        ownedByCurrentUser: true,
      },
    ]);
  });

  it("surfaces the env-configured Buda agent as connected once its first session lands, using the real session name", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-env" };
    mocks.sessions.push(
      session({
        slug: "buda",
        agentName: "Buda AI Agent",
        transport: "remote-websocket",
      }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      slug: "buda",
      transport: "remote-websocket",
      sessionCount: 1,
      connected: true,
    });
  });

  it("does not let env config duplicate a saved connection for the same agent", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-1" };
    mocks.budaConnections.push({
      slug: "buda:agent-1",
      agentId: "agent-1",
      agentName: "Rex",
      ownedByCurrentUser: true,
      legacy: false,
    });

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ slug: "buda:agent-1", connected: true });
  });

  it("never marks a different agent's session as connected just because env config exists", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-env" };
    mocks.sessions.push(
      session({
        slug: "buda:agent-other",
        agentName: "Other Agent",
        transport: "remote-websocket",
        status: "ended",
      }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(2);
    expect(connections.find((c) => c.slug === "buda:agent-other")).toMatchObject({
      connected: false,
    });
    expect(connections.find((c) => c.slug === "buda")).toMatchObject({
      connected: true,
    });
  });

  it("treats a lone env var (missing the other) as not configured, same as agent-catalog's AND-gate", async () => {
    mocks.envConfig = { token: "test-token" };

    await expect(listAgentConnections()).resolves.toEqual([]);
  });

  /**
   * Env config lives on the shared server process, not the caller. A Cloud
   * actor (getContextActorId() !== undefined) must never see that
   * process-wide config surfaced as their own connected agent just because
   * some other tenant's OSS/tunnel session set BUDA_API_KEY/BUDA_AGENT_ID.
   */
  it("never surfaces env-configured Buda agent as connected for a Cloud actor", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-env" };
    mocks.actorId = "cloud-actor-1";

    await expect(listAgentConnections()).resolves.toEqual([]);
  });

  it("still surfaces env-configured Buda agent for a local/OSS actor (no actorId)", async () => {
    mocks.envConfig = { token: "test-token", agentId: "agent-env" };
    mocks.actorId = undefined;

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ slug: "buda", connected: true });
  });

  it("leaves a real disconnected remote history disconnected when no env config is set", async () => {
    mocks.sessions.push(
      session({
        slug: "buda:agent-old",
        agentName: "Archived Agent",
        transport: "remote-websocket",
        status: "ended",
      }),
    );

    const connections = await listAgentConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ slug: "buda:agent-old", connected: false });
  });
});
