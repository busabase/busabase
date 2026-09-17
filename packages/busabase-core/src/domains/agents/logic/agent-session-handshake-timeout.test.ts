import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getContextActorId, getContextSpaceId, LOCAL_SPACE_ID } from "../../../context";

/**
 * PUL-257: an agent that accepts the ACP connection but never answers
 * `initialize`/`session/new` used to leave `session.ready` pending forever —
 * neither the success path nor `connectPromise`'s `.catch` ever fires, so
 * the session stayed `connecting` with no error, and the busabase UI showed
 * an endless "starting..." spinner with no way to know it was stuck.
 *
 * This suite drives the same real ACP client/agent pair the sibling
 * `agent-session-manager.test.ts` config-option suite uses (two `Stream`s
 * from `TransformStream`s standing in for `createWebSocketStream`), but with
 * a fake agent that deliberately never resolves `initialize` — the exact
 * hang `AGENT_HANDSHAKE_TIMEOUT_MS` exists to bound.
 */

const mocks = vi.hoisted(() => ({
  createWebSocketStream: vi.fn<() => Stream>(),
  loadSessionEvents: vi.fn(),
  loadSessionRuntime: vi.fn(),
  persistSessionCreated: vi.fn(),
  persistSessionAcpIdentity: vi.fn(),
  persistSessionEvents: vi.fn(),
  persistSessionState: vi.fn(),
  acquireSessionLease: vi.fn(),
  releaseSessionLease: vi.fn(),
  renewSessionLease: vi.fn(),
  endRemoteSession: vi.fn(),
  storedSessions: [] as Array<AgentSessionVO>,
  storedScopes: new Map<string, { spaceId: string; actorId: string | null }>(),
}));

vi.mock("./agent-session-store", () => ({
  acquireSessionLease: mocks.acquireSessionLease,
  endRemoteSession: mocks.endRemoteSession,
  persistSessionCreated: mocks.persistSessionCreated,
  persistSessionAcpIdentity: mocks.persistSessionAcpIdentity,
  persistSessionState: mocks.persistSessionState,
  persistSessionEvents: mocks.persistSessionEvents,
  persistSessionModelOption: vi.fn().mockResolvedValue(true),
  loadSessions: async () =>
    mocks.storedSessions.filter((session) => {
      const scope = mocks.storedScopes.get(session.id);
      return (
        scope?.spaceId === getContextSpaceId() && scope.actorId === (getContextActorId() ?? null)
      );
    }),
  loadSessionPageCandidates: async () => [],
  loadSessionEvents: mocks.loadSessionEvents,
  loadSessionRuntime: mocks.loadSessionRuntime,
  releaseSessionLease: mocks.releaseSessionLease,
  renewSessionLease: mocks.renewSessionLease,
  sessionLeaseTtlSeconds: () => 45,
}));
vi.mock("./agent-workspace", () => ({ prepareAgentWorkspace: async () => "/tmp/agent-workspace" }));
vi.mock("./agent-workspace-guide", () => ({
  resolveBusabaseMcpUrl: () => "http://localhost/mcp",
}));
vi.mock("./agent-catalog", () => ({
  resolveLaunch: async () => ({
    slug: "test-agent",
    name: "Test Agent",
    transport: "remote-websocket",
    url: "wss://agent.test/acp",
  }),
}));
vi.mock("@agentclientprotocol/sdk/experimental/ws-client", () => ({
  createWebSocketStream: mocks.createWebSocketStream,
}));

const { createAgentSession, listAgentSessions } = await import("./agent-session-manager");

function linkedStreams(): [Stream, Stream] {
  const aToB = new TransformStream();
  const bToA = new TransformStream();
  return [
    { readable: bToA.readable, writable: aToB.writable },
    { readable: aToB.readable, writable: bToA.writable },
  ];
}

/** A fake agent that accepts the connection but never answers `initialize`. */
function serveHungAgent(stream: Stream) {
  return acp
    .agent()
    .onRequest(acp.methods.agent.initialize, () => new Promise(() => {})) // never resolves
    .connectWith(stream, () => new Promise(() => {}))
    .catch(() => {}); // teardown aborts the stream; not a real connection failure
}

async function waitUntil<T, U extends T>(
  read: () => Promise<T>,
  predicate: (value: T) => value is U,
): Promise<U> {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await vi.advanceTimersByTimeAsync(20);
  }
  throw new Error("Condition never became true.");
}

describe("agent session manager — handshake timeout (PUL-257)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    mocks.loadSessionEvents.mockResolvedValue([]);
    mocks.loadSessionRuntime.mockResolvedValue(null);
    mocks.persistSessionCreated.mockImplementation(
      async (session: AgentSessionVO, scope: { spaceId: string; actorId: string | null }) => {
        mocks.storedSessions.push({ ...session });
        mocks.storedScopes.set(session.id, scope);
      },
    );
    mocks.persistSessionEvents.mockResolvedValue(true);
    mocks.persistSessionState.mockImplementation(
      async (
        update: { id: string; status: AgentSessionVO["status"]; error: string | null },
        _acpSessionId: string | null | undefined,
        options: { expectedStatuses?: AgentSessionVO["status"][] } | undefined,
      ) => {
        const stored = mocks.storedSessions.find((s) => s.id === update.id);
        if (!stored) return true;
        if (options?.expectedStatuses && !options.expectedStatuses.includes(stored.status)) {
          return false;
        }
        stored.status = update.status;
        stored.error = update.error;
        return true;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a session whose agent never answers the ACP handshake, instead of hanging forever", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    serveHungAgent(agentSide);

    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    expect(session.status).toBe("connecting");

    // Nothing changes on its own before the deadline — this is the
    // regression this test guards against: without a handshake timeout, the
    // session would still be "connecting" no matter how long we wait.
    await vi.advanceTimersByTimeAsync(29_000);
    expect((await listAgentSessions()).find((s) => s.id === session.id)?.status).toBe("connecting");

    // Crossing the deadline is what turns the hang into a visible, actionable
    // failure — the same shape a rejected `initialize` call would produce.
    const failed = await waitUntil(
      async () => (await listAgentSessions()).find((s) => s.id === session.id),
      (found): found is NonNullable<typeof found> =>
        found !== undefined && found.status === "failed",
    );
    expect(failed.error).toMatch(/did not respond to the ACP handshake/i);
  });
});
