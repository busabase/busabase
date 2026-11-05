import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionScope } from "./agent-session-store";
import type { AgentSessionSupervisorHost } from "./agent-session-supervisor";

const store = vi.hoisted(() => ({
  claimWriterLease: vi.fn(),
  expireSessionCommands: vi.fn(async () => true),
  getJournalRuntime: vi.fn(),
  hasPendingSessionCommands: vi.fn(async () => false),
  listSessionCommandDemand: vi.fn(),
  releaseWriterLease: vi.fn(async () => true),
  renewWriterLease: vi.fn(async () => true),
  claimSessionCommands: vi.fn(async () => []),
  loadSessionCommands: vi.fn(async () => []),
  touchJournalDemand: vi.fn(async () => true),
  transitionSessionCommand: vi.fn(async () => true),
  updateJournalRuntime: vi.fn(async () => true),
}));
vi.mock("./agent-session-journal-store", () => store);

const scope = { spaceId: "capacity_fixture", actorId: null } satisfies AgentSessionScope;
const ownerKey = (sessionId: string) => JSON.stringify([scope.spaceId, scope.actorId, sessionId]);
function gate() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function owner(sessionId: string) {
  return {
    sessionId,
    scope,
    lease: {
      sessionId,
      ownerId: `writer_${sessionId}`,
      epoch: 1,
      bindingGeneration: 1,
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    },
    connected: true,
    connecting: null,
    data: null,
    controls: new Map(),
    renewedAt: Date.now(),
    reconciledAt: Date.now(),
    stopped: false,
  };
}
interface Registry {
  owners: Map<string, ReturnType<typeof owner>>;
  demand: Map<string, unknown>;
  retryAfter: Map<string, unknown>;
}
const registry = () =>
  (globalThis as typeof globalThis & { __busabaseSessionSupervisor: Registry })
    .__busabaseSessionSupervisor;
let stop: (() => Promise<void>) | undefined;
let releaseClaims: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
  vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
  vi.spyOn(console, "info").mockImplementation(() => {});
  store.getJournalRuntime.mockImplementation(async (sessionId: string) => ({
    journalMode: "supervised",
    activeCommandId: null,
    demandUntil: new Date(Date.now() + 60_000).toISOString(),
    session: {
      id: sessionId,
      status: "idle",
      reliability: { connection: "connected", execution: "idle", synchronization: "synced" },
    },
  }));
});
afterEach(async () => {
  releaseClaims?.();
  await stop?.();
  registry().owners.clear();
  registry().demand.clear();
  registry().retryAfter.clear();
  stop = undefined;
  releaseClaims = undefined;
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("supervisor owner capacity with asynchronous lease claims", () => {
  it("reserves only ten new slots beside ninety owners while maintaining every existing owner", async () => {
    const supervisor = await import("./agent-session-supervisor");
    const claimGate = gate();
    releaseClaims = claimGate.resolve;
    const tenClaimsEntered = gate();
    store.claimWriterLease.mockImplementation(async (sessionId: string) => {
      if (store.claimWriterLease.mock.calls.length === 10) tenClaimsEntered.resolve();
      await claimGate.promise;
      return owner(sessionId).lease;
    });
    const demanded = Array.from({ length: 100 }, (_, index) => ({
      sessionId: `waiting_${index}`,
      ...scope,
    }));
    store.listSessionCommandDemand.mockResolvedValue(demanded);
    const state = registry();
    state.owners.clear();
    for (let index = 0; index < 90; index++) {
      const current = owner(`existing_${index}`);
      // This is a real renewal boundary, independent of the candidate gate.
      current.renewedAt = Date.now() - 16_000;
      state.owners.set(ownerKey(current.sessionId), current);
    }
    const connect = vi.fn(async () => {});
    supervisor.registerAgentSessionSupervisorDriver({
      connect,
      detach() {},
      async execute() {},
      async reconcile() {
        return { state: "unknown" };
      },
    });
    stop = supervisor.startAgentSessionSupervisorHost({
      database: async () => ({}) as Awaited<ReturnType<AgentSessionSupervisorHost["database"]>>,
      runAs: async (_scope, operation) => operation(),
    });
    const tick = supervisor.wakeAgentSessionSupervisor();
    await tenClaimsEntered.promise;
    expect(supervisor.wakeAgentSessionSupervisor()).toBe(tick);
    expect(store.claimWriterLease).toHaveBeenCalledTimes(10);
    expect(state.owners.size).toBe(90);
    claimGate.resolve();
    await tick;
    expect(state.owners.size).toBe(100);
    expect(connect).toHaveBeenCalledTimes(10);
    expect(store.renewWriterLease).toHaveBeenCalledTimes(90);
    expect(store.getJournalRuntime).toHaveBeenCalledTimes(100);

    // A full host still drives all existing owners, but cannot claim more.
    await supervisor.wakeAgentSessionSupervisor();
    expect(store.claimWriterLease).toHaveBeenCalledTimes(10);
    expect(state.owners.size).toBe(100);

    // Expired demand frees one slot; later discovery makes progress.
    store.getJournalRuntime.mockImplementationOnce(async () => null);
    await supervisor.wakeAgentSessionSupervisor();
    expect(state.owners.size).toBe(99);
    await supervisor.wakeAgentSessionSupervisor();
    expect(state.owners.size).toBe(100);
    expect(store.claimWriterLease).toHaveBeenCalledTimes(11);
  });
});
