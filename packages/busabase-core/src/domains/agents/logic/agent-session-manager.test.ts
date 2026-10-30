import { foldAvailableCommands, reduceAcpEvents } from "@acp-ui/core/reduce";
import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import type { AgentSessionEventVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getContextActorId,
  getContextSpaceId,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
} from "../../../context";
import { translateAgentSessionEvent } from "../hooks/use-agent-session";
import type { AgentSessionRuntimeRecord } from "./agent-session-store";

/**
 * Model-config-option coverage for the session manager, driven over a real
 * ACP client/agent pair — the same in-process approach Buda's own
 * `acp-agent-implementation.test.ts` uses, minus the HTTP
 * transport that test's server-side role needs and this domain's
 * `remote-websocket` launches don't: two `Stream`s built directly from
 * `TransformStream`s stand in for `createWebSocketStream`, so no bytes, JSON
 * framing, or real socket are involved.
 *
 * Persistence, the workspace directory, and the MCP URL are mocked — this
 * suite is about the ACP `configOptions` contract, not disk or the database.
 */

const mocks = vi.hoisted(() => ({
  resolveAgentContextResources: vi.fn(),
  resolveLaunch: vi.fn(),
  acquireSessionLease: vi.fn(),
  createWebSocketStream: vi.fn<() => Stream>(),
  endRemoteSession: vi.fn(),
  loadSessionEvents: vi.fn(),
  loadSessionRuntime: vi.fn(),
  persistSessionCreated: vi.fn(),
  persistSessionAcpIdentity: vi.fn(),
  persistSessionEvents: vi.fn(),
  persistSessionModelOption: vi.fn(),
  persistSessionState: vi.fn(),
  releaseSessionLease: vi.fn(),
  renewSessionLease: vi.fn(),
  sessionLeaseTtlSeconds: 45,
  // Backing store for `loadSessions()` — kept alongside the cross-worker reattach harness
  // above because "database-authoritative session identity" pushes rows
  // directly and asserts `listAgentSessions()` surfaces them, independent of
  // the reattachment-focused `loadSessionRuntime` mock.
  storedSessions: [] as Array<AgentSessionVO>,
  storedScopes: new Map<string, { spaceId: string; actorId: string | null }>(),
}));

vi.mock("./agent-context-resources", () => ({
  resolveAgentContextResources: mocks.resolveAgentContextResources,
}));

vi.mock("./agent-session-store", () => ({
  acquireSessionLease: mocks.acquireSessionLease,
  endRemoteSession: mocks.endRemoteSession,
  persistSessionCreated: mocks.persistSessionCreated,
  persistSessionAcpIdentity: mocks.persistSessionAcpIdentity,
  persistSessionState: mocks.persistSessionState,
  persistSessionEvents: mocks.persistSessionEvents,
  persistSessionModelOption: mocks.persistSessionModelOption,
  loadSessions: async () =>
    mocks.storedSessions.filter((session) => {
      const scope = mocks.storedScopes.get(session.id);
      return (
        scope?.spaceId === getContextSpaceId() && scope.actorId === (getContextActorId() ?? null)
      );
    }),
  loadSessionPageCandidates: async ({ slug }: { slug: string }) =>
    mocks.storedSessions.filter((session) => {
      const scope = mocks.storedScopes.get(session.id);
      return (
        session.slug === slug &&
        session.status !== "ended" &&
        session.status !== "failed" &&
        scope?.spaceId === getContextSpaceId() &&
        scope.actorId === (getContextActorId() ?? null)
      );
    }),
  loadSessionEvents: mocks.loadSessionEvents,
  loadSessionRuntime: mocks.loadSessionRuntime,
  releaseSessionLease: mocks.releaseSessionLease,
  renewSessionLease: mocks.renewSessionLease,
  sessionLeaseTtlSeconds: () => mocks.sessionLeaseTtlSeconds,
}));
vi.mock("./agent-workspace", () => ({ prepareAgentWorkspace: async () => "/tmp/agent-workspace" }));
vi.mock("./agent-workspace-guide", () => ({
  resolveBusabaseMcpUrl: () => "http://localhost/mcp",
}));
vi.mock("./agent-catalog", () => ({
  resolveLaunch: mocks.resolveLaunch,
}));
vi.mock("@agentclientprotocol/sdk/experimental/ws-client", () => ({
  createWebSocketStream: mocks.createWebSocketStream,
}));

const {
  AgentSessionTerminalError,
  cancelAgentSession,
  createAgentSession,
  closeAgentSession,
  closeAgentSessions,
  listAgentSessions,
  listAgentSessionsPaged,
  promptAgentSession,
  respondToAgentPermission,
  setAgentSessionConfigOption,
  startAgentSessionPrompt,
  subscribeAgentSession,
} = await import("./agent-session-manager");

function linkedStreams(): [Stream, Stream] {
  const aToB = new TransformStream();
  const bToA = new TransformStream();
  return [
    { writable: aToB.writable, readable: bToA.readable },
    { writable: bToA.writable, readable: aToB.readable },
  ];
}

const MODEL_CONFIG: acp.SessionConfigOption = {
  id: "model",
  name: "Model",
  category: "model",
  type: "select",
  currentValue: "auto",
  options: [
    { value: "auto", name: "Auto" },
    { value: "fast", name: "Fast" },
  ],
};

const THINKING_CONFIG: acp.SessionConfigOption = {
  id: "reasoning_effort",
  name: "Thinking Level",
  category: "thought_level",
  type: "select",
  currentValue: "medium",
  options: [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ],
};

const resetStoreMocks = () => {
  mocks.resolveAgentContextResources.mockResolvedValue([]);
  mocks.resolveLaunch.mockImplementation(async () => ({
    slug: "test-agent",
    name: "Test Agent",
    transport: "remote-websocket",
    url: "wss://agent.test/acp",
  }));
  mocks.sessionLeaseTtlSeconds = 45;
  const scopedSession = (sessionId: string) => {
    const scope = mocks.storedScopes.get(sessionId);
    if (scope?.spaceId !== getContextSpaceId() || scope.actorId !== (getContextActorId() ?? null)) {
      return undefined;
    }
    return mocks.storedSessions.find((session) => session.id === sessionId);
  };
  mocks.acquireSessionLease.mockImplementation(async (sessionId: string, ownerId: string) => {
    const stored = scopedSession(sessionId);
    if (stored) stored.status = "busy";
    return {
      sessionId,
      ownerId,
      fencingToken: 1,
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    };
  });
  mocks.endRemoteSession.mockImplementation(async (sessionId: string) => {
    const session = scopedSession(sessionId);
    if (!session) return true;
    if (
      session.transport !== "remote-websocket" ||
      (session.status !== "connecting" && session.status !== "idle")
    ) {
      return false;
    }
    session.status = "ended";
    return true;
  });
  mocks.loadSessionEvents.mockResolvedValue([]);
  mocks.loadSessionRuntime.mockImplementation(async (sessionId: string) => {
    const stored = scopedSession(sessionId);
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          AgentSessionVO & {
            acpSessionId?: string | null;
            actorId?: string | null;
            persistedSeq?: number;
            spaceId?: string;
          }
        >;
      }
    ).__busabaseAgentSessions?.get(sessionId);
    if (
      !stored &&
      (!live ||
        live.spaceId !== getContextSpaceId() ||
        live.actorId !== (getContextActorId() ?? null))
    ) {
      return null;
    }
    const session = stored ?? live;
    if (!session) return null;
    return {
      session: {
        id: session.id,
        slug: session.slug,
        agentName: session.agentName,
        transport: session.transport,
        status: session.status,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        error: session.error,
        modelOption: session.modelOption,
        thinkingOption: session.thinkingOption,
      },
      acpSessionId: live?.acpSessionId ?? null,
      lastEventSeq: live?.persistedSeq ?? 0,
    } satisfies AgentSessionRuntimeRecord;
  });
  mocks.persistSessionCreated.mockImplementation(async (session: AgentSessionVO, scope) => {
    mocks.storedSessions.push({ ...session });
    mocks.storedScopes.set(session.id, scope);
  });
  mocks.persistSessionAcpIdentity.mockResolvedValue(undefined);
  mocks.persistSessionEvents.mockResolvedValue(true);
  mocks.persistSessionModelOption.mockImplementation(
    async (
      sessionId: string,
      modelOption: AgentSessionVO["modelOption"],
      _scope,
      _fence,
      thinkingOption: AgentSessionVO["thinkingOption"] = null,
    ) => {
      const session = scopedSession(sessionId);
      // Handoff tests supply an existing durable row through
      // `loadSessionRuntime` without duplicating it in `storedSessions`.
      if (!session) return true;
      if (session.transport !== "remote-websocket") return false;
      if (session.status === "ended" || session.status === "failed") return false;
      session.modelOption = modelOption;
      session.thinkingOption = thinkingOption;
      return true;
    },
  );
  mocks.persistSessionState.mockImplementation(async (update, _acpSessionId, options) => {
    const session = scopedSession(update.id);
    if (!session) return true;
    if (session.status === "ended" || session.status === "failed") return false;
    if (options?.expectedStatuses && !options.expectedStatuses.includes(session.status)) {
      return false;
    }
    session.status = update.status;
    session.error = update.error;
    session.lastActivityAt = update.lastActivityAt;
    return true;
  });
  mocks.releaseSessionLease.mockImplementation(async (sessionId: string) => {
    const stored = scopedSession(sessionId);
    if (stored && (stored.status === "busy" || stored.status === "waiting_permission")) {
      stored.status = "idle";
    }
    return true;
  });
  mocks.renewSessionLease.mockResolvedValue(true);
};

const runtimeRecord = (
  overrides: Partial<AgentSessionVO> = {},
  acpSessionId: string | null = "acp-sess-existing",
): AgentSessionRuntimeRecord => ({
  session: {
    id: "ags-outer-existing",
    slug: "test-agent",
    agentName: "Test Agent",
    transport: "remote-websocket",
    status: "idle",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    error: null,
    modelOption: null,
    ...overrides,
  },
  acpSessionId,
  lastEventSeq: 4,
});

/** Runs a scripted fake agent over one side of a linked stream pair. */
function serveFakeAgent(
  stream: Stream,
  initialConfigOptions: acp.SessionConfigOption[] | null,
  options?: {
    initializeGate?: Promise<void>;
    initializeError?: Error;
    configResponse?: (configId: string, value: string) => acp.SessionConfigOption[];
    imageSupported?: boolean;
    embeddedContextSupported?: boolean;
    loadError?: Error;
    loadAvailableCommands?: acp.AvailableCommand[];
    loadReplayText?: string;
    loadSessionSupported?: boolean;
    promptChunkText?: string;
    promptGate?: Promise<void>;
    requestPermission?: boolean;
    budaEventStream?: boolean;
    /**
     * Tool titles to request permission for all at once, the way Claude Code
     * asks for parallel tool calls: every `session/request_permission` is in
     * flight before any is answered.
     */
    parallelPermissions?: string[];
    /**
     * When set, the fake agent does not resolve `session/prompt` on its own —
     * it waits for `session/cancel` and then resolves the *original* pending
     * prompt request with `stopReason: "cancelled"`, per ACP's cancellation
     * contract (the client must not treat the turn as over from the
     * notification alone).
     */
    cancelFirstPromptOnNotify?: boolean;
    cancelFirstPromptStopReason?: acp.StopReason;
    cancelResponseGate?: Promise<void>;
  },
) {
  let configOptions = initialConfigOptions;
  let initializeCalls = 0;
  let newSessionCalls = 0;
  let setConfigCalls = 0;
  const loadedSessionIds: string[] = [];
  const promptTexts: string[] = [];
  const promptContents: acp.ContentBlock[][] = [];
  const promptSessionIds: string[] = [];
  const cancelledSessionIds: string[] = [];
  const cancelledRequestSessionIds: string[] = [];
  const cancelWaiters = new Map<string, () => void>();
  /** What the client answered, in the order the answers arrived. */
  const permissionOutcomes: Array<{ title: string; outcome: acp.RequestPermissionOutcome }> = [];
  let connected: acp.AgentContext | undefined;
  const ready = new Promise<void>((resolve) => {
    acp
      .agent()
      .onRequest(acp.methods.agent.initialize, async () => {
        initializeCalls += 1;
        await options?.initializeGate;
        if (options?.initializeError) throw options.initializeError;
        return {
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: options?.loadSessionSupported !== false,
            promptCapabilities: {
              image: options?.imageSupported === true,
              ...(options?.embeddedContextSupported !== undefined
                ? { embeddedContext: options.embeddedContextSupported }
                : {}),
            },
            ...(options?.budaEventStream ? { _meta: { "buda.im": { eventStream: 1 } } } : {}),
          },
        };
      })
      .onRequest(acp.methods.agent.session.new, async () => {
        newSessionCalls += 1;
        return { sessionId: "acp-sess-1", configOptions };
      })
      .onRequest(acp.methods.agent.session.load, async (ctx) => {
        loadedSessionIds.push(ctx.params.sessionId);
        if (options?.loadError) throw options.loadError;
        if (options?.loadAvailableCommands) {
          await ctx.client.notify(acp.methods.client.session.update, {
            sessionId: ctx.params.sessionId,
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: options.loadAvailableCommands,
            },
          });
        }
        if (options?.loadReplayText) {
          await ctx.client.notify(acp.methods.client.session.update, {
            sessionId: ctx.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: options.loadReplayText },
            },
          });
        }
        return { configOptions };
      })
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        promptContents.push(ctx.params.prompt);
        promptSessionIds.push(ctx.params.sessionId);
        const text = ctx.params.prompt.find((block) => block.type === "text");
        if (text?.type === "text") promptTexts.push(text.text);
        const askPermission = async (toolCallId: string, title: string) => {
          const response = await ctx.client.request(acp.methods.client.session.requestPermission, {
            sessionId: ctx.params.sessionId,
            toolCall: { toolCallId, title, kind: "execute", status: "pending" },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "deny", name: "Deny", kind: "reject_once" },
            ],
          });
          permissionOutcomes.push({ title, outcome: response.outcome });
        };
        if (options?.requestPermission) {
          await askPermission("tc-test-permission", "Run a test command");
        }
        if (options?.parallelPermissions) {
          await Promise.all(
            options.parallelPermissions.map((title, index) =>
              askPermission(`tc-parallel-${index}`, title),
            ),
          );
        }
        if (options?.promptChunkText) {
          await ctx.client.notify(acp.methods.client.session.update, {
            sessionId: ctx.params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: options.promptChunkText },
            },
          });
        }
        if (options?.cancelFirstPromptOnNotify && promptTexts.length === 1) {
          ctx.signal.addEventListener(
            "abort",
            () => cancelledRequestSessionIds.push(ctx.params.sessionId),
            { once: true },
          );
          await new Promise<void>((resolveCancel) => {
            if (cancelledSessionIds.includes(ctx.params.sessionId)) resolveCancel();
            else cancelWaiters.set(ctx.params.sessionId, resolveCancel);
          });
          await options.cancelResponseGate;
          return { stopReason: options.cancelFirstPromptStopReason ?? ("cancelled" as const) };
        }
        await options?.promptGate;
        return { stopReason: "end_turn" as const };
      })
      .onNotification(acp.methods.agent.session.cancel, (ctx) => {
        cancelledSessionIds.push(ctx.params.sessionId);
        cancelWaiters.get(ctx.params.sessionId)?.();
        cancelWaiters.delete(ctx.params.sessionId);
      })
      .onRequest(acp.methods.agent.session.setConfigOption, async (ctx) => {
        setConfigCalls += 1;
        configOptions =
          configOptions?.map((option) => {
            if (option.id !== ctx.params.configId || option.type !== "select") return option;
            if (!("value" in ctx.params) || typeof ctx.params.value !== "string") return option;
            return { ...option, currentValue: ctx.params.value };
          }) ?? [];
        if (
          options?.configResponse &&
          "value" in ctx.params &&
          typeof ctx.params.value === "string"
        ) {
          configOptions = options.configResponse(ctx.params.configId, ctx.params.value);
        }
        return { configOptions };
      })
      .connectWith(stream, (ctx) => {
        connected = ctx;
        resolve();
        return new Promise(() => {}); // held open until the test tears the stream down
      })
      .catch(() => {}); // Teardown aborts the stream; not a real connection failure.
  });

  return {
    initializeCallCount: () => initializeCalls,
    loadedSessionIds: () => loadedSessionIds,
    newSessionCallCount: () => newSessionCalls,
    promptSessionIds: () => promptSessionIds,
    setConfigCallCount: () => setConfigCalls,
    promptTexts: () => promptTexts,
    promptContents: () => promptContents,
    cancelledSessionIds: () => cancelledSessionIds,
    cancelledRequestSessionIds: () => cancelledRequestSessionIds,
    permissionOutcomes: () => permissionOutcomes,
    setConfigOptionsSilently: (nextConfigOptions: acp.SessionConfigOption[]) => {
      configOptions = nextConfigOptions;
    },
    pushNotification: async (method: string, params: Record<string, unknown>) => {
      await ready;
      await connected?.notify(method, params);
    },
    /** Push a `session/update` config_option_update notification to the client. */
    pushConfigUpdate: async (nextConfigOptions: acp.SessionConfigOption[]) => {
      configOptions = nextConfigOptions;
      await ready;
      await connected?.notify(acp.methods.client.session.update, {
        sessionId: "acp-sess-1",
        update: { sessionUpdate: "config_option_update", configOptions: nextConfigOptions },
      });
    },
  };
}

/** `session.ready` resolves asynchronously — poll the list until it settles past "connecting". */
async function waitUntilSettled(sessionId: string) {
  return waitUntil(
    async () => (await listAgentSessions()).find((s) => s.id === sessionId),
    (found): found is NonNullable<typeof found> =>
      found !== undefined && found.status !== "connecting",
  );
}

async function waitUntil<T, U extends T>(
  read: () => Promise<T>,
  predicate: (value: T) => value is U,
): Promise<U> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Condition never became true.");
}

describe("agent session manager — Buda confirmed model cache", () => {
  const launch = {
    slug: "buda:agent-1",
    name: "Buda Agent",
    transport: "remote-websocket",
    url: "wss://buda.test/acp?agentId=agent-1",
    authHeader: "Bearer account-1",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    Object.assign(globalThis, {
      __busabaseAgentSessions: new Map(),
      __busabaseAgentModelOptions: new Map(),
    });
    mocks.resolveLaunch.mockResolvedValue(launch);
  });

  async function open(
    config: acp.SessionConfigOption[] | null,
    options?: Parameters<typeof serveFakeAgent>[2],
    spaceId = LOCAL_SPACE_ID,
  ) {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValueOnce(clientSide);
    const agent = serveFakeAgent(agentSide, config, options);
    const session = await createAgentSession({ slug: launch.slug, spaceId });
    return { session, agent };
  }

  it.each([1, 3])(
    "serializes %s Buda notifications behind a pending user-message insert",
    async (count) => {
      const { session, agent } = await open(null, { budaEventStream: true });
      await waitUntilSettled(session.id);
      const live = (
        globalThis as typeof globalThis & {
          __busabaseAgentSessions: Map<
            string,
            {
              seq: number;
              persistedSeq: number;
              buffer: AgentSessionEventVO[];
              flushPending: Promise<void>;
              listeners: Set<(event: AgentSessionEventVO) => void>;
            }
          >;
        }
      ).__busabaseAgentSessions.get(session.id);
      if (!live) throw new Error("Expected the live Buda session");
      await live.flushPending;
      const published: AgentSessionEventVO[] = [];
      live.listeners.add((event) => published.push(event));
      const initialSeq = live.seq;
      let releaseWrite = () => {};
      const blocked = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let enterWrite = () => {};
      const entered = new Promise<void>((resolve) => {
        enterWrite = resolve;
      });
      const durable: AgentSessionEventVO[] = [];
      const callsDuringGate: AgentSessionEventVO[][] = [];
      let writePending = false;
      mocks.persistSessionEvents.mockImplementation(async (events: AgentSessionEventVO[]) => {
        const user = events.some(
          (event) =>
            (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
        );
        if (user) {
          writePending = true;
          enterWrite();
          await blocked;
          writePending = false;
        } else if (writePending) {
          callsDuringGate.push(events);
        }
        durable.push(...events);
        return true;
      });
      const onAccepted = vi.fn();
      const prompt = promptAgentSession(session.id, "PDF prompt", undefined, { onAccepted });
      try {
        await entered;
        for (let index = 0; index < count; index += 1) {
          await agent.pushNotification(
            index % 2 === 0 ? acp.methods.client.session.update : "_buda.im/session_event",
            index % 2 === 0
              ? {
                  sessionId: "acp-sess-1",
                  update: {
                    sessionUpdate: "user_message_chunk",
                    messageId: "previous-user-message",
                    content: { type: "text", text: `echo-${index}` },
                    _meta: { "buda.im": { seq: 100 + index } },
                  },
                }
              : {
                  sessionId: "acp-sess-1",
                  event: {
                    version: 1,
                    type: "job_update",
                    turnId: "old-turn",
                    at: "2026-10-30T00:00:00Z",
                    job: { id: `job-${index}`, title: "Background job", status: "completed" },
                  },
                  _meta: { "buda.im": { seq: 100 + index } },
                },
          );
        }
        await vi.waitFor(() =>
          expect(live.buffer.filter((event) => event.seq > initialSeq)).toHaveLength(count),
        );
        const seqBeforeRelease = live.seq;
        expect(onAccepted).not.toHaveBeenCalled();
        expect(agent.promptTexts()).toEqual([]);
        releaseWrite();
        await prompt;
        await live.flushPending;
        expect(callsDuringGate).toEqual([]);
        const seqs = durable.map((event) => event.seq);
        expect(new Set(seqs).size).toBe(seqs.length);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        expect(
          durable.filter((event) => event.kind === "acpUpdate" || event.kind === "acpExtension"),
        ).toHaveLength(count + 1);
        expect(published.map((event) => event.seq)).toEqual(seqs);
        expect(live.seq).toBeGreaterThanOrEqual(seqBeforeRelease);
        expect(live.persistedSeq).toBe(live.seq);
        expect(live.buffer.map((event) => event.seq)).toEqual(
          [...live.buffer].sort((a, b) => a.seq - b.seq).map((event) => event.seq),
        );
        expect(onAccepted).toHaveBeenCalledOnce();
        expect(agent.promptTexts()).toEqual(["PDF prompt"]);
      } finally {
        releaseWrite();
        await prompt.catch(() => {});
        await closeAgentSessions([session.id]);
      }
    },
  );

  it("waits for an earlier Buda notification insert before admitting the user prompt", async () => {
    const { session, agent } = await open(null, { budaEventStream: true });
    await waitUntilSettled(session.id);
    let releaseWrite = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let enterWrite = () => {};
    const entered = new Promise<void>((resolve) => {
      enterWrite = resolve;
    });
    const durable: AgentSessionEventVO[] = [];
    mocks.persistSessionEvents.mockImplementation(async (events: AgentSessionEventVO[]) => {
      if (
        events.some(
          (event) =>
            (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message_chunk",
        )
      ) {
        enterWrite();
        await blocked;
      }
      durable.push(...events);
      return true;
    });
    await agent.pushNotification(acp.methods.client.session.update, {
      sessionId: "acp-sess-1",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "earlier-user",
        content: { type: "text", text: "Earlier message" },
        _meta: { "buda.im": { seq: 10 } },
      },
    });
    await entered;
    const onAccepted = vi.fn();
    const prompt = promptAgentSession(session.id, "Later PDF", undefined, { onAccepted });
    try {
      await vi.waitFor(() => expect(mocks.acquireSessionLease).toHaveBeenCalled());
      expect(durable).toEqual([]);
      expect(onAccepted).not.toHaveBeenCalled();
      expect(agent.promptTexts()).toEqual([]);
      releaseWrite();
      await prompt;
      expect(
        durable
          .slice(0, 2)
          .map((event) => (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate),
      ).toEqual(["user_message_chunk", "user_message"]);
      const seqs = durable.map((event) => event.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(agent.promptTexts()).toEqual(["Later PDF"]);
    } finally {
      releaseWrite();
      await prompt.catch(() => {});
      await closeAgentSessions([session.id]);
    }
  });

  it("never replays or dispatches a rejected user insert overlapped by Buda notifications", async () => {
    const { session, agent } = await open(null, { budaEventStream: true });
    await waitUntilSettled(session.id);
    let releaseWrite = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let enterWrite = () => {};
    const entered = new Promise<void>((resolve) => {
      enterWrite = resolve;
    });
    const durable: AgentSessionEventVO[] = [];
    mocks.persistSessionEvents.mockImplementation(async (events: AgentSessionEventVO[]) => {
      if (events.some((event) => (event.acpUpdate as { text?: string })?.text === "rejected PDF")) {
        enterWrite();
        await blocked;
        return false;
      }
      durable.push(...events);
      return true;
    });
    const onAccepted = vi.fn();
    const prompt = promptAgentSession(session.id, "rejected PDF", undefined, { onAccepted });
    const rejected = expect(prompt).rejects.toThrow(/could not persist/i);
    try {
      await entered;
      await agent.pushNotification(acp.methods.client.session.update, {
        sessionId: "acp-sess-1",
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "prior-message",
          content: { type: "text", text: "Prior turn echo" },
          _meta: { "buda.im": { seq: 10 } },
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseWrite();
      await rejected;
      await promptAgentSession(session.id, "retry PDF");
      expect(agent.promptTexts()).toEqual(["retry PDF"]);
      expect(onAccepted).not.toHaveBeenCalled();
      expect(JSON.stringify(durable)).not.toContain("rejected PDF");
      expect(
        durable.filter(
          (event) =>
            (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
        ),
      ).toHaveLength(1);
      const seqs = durable.map((event) => event.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
    } finally {
      releaseWrite();
      await prompt.catch(() => {});
      await closeAgentSessions([session.id]);
    }
  });

  const promptContext = () =>
    createPromptResourceContext(
      createAgentPromptEnvelope({
        scenario: { id: "find", title: "Find records" },
        target: { nodeId: "nod_private", nodeName: "目标", nodeType: "base" },
        source: { origin: "https://busa.test", edition: "desktop" },
        segments: [
          { kind: "target", text: "Target: 目标" },
          { kind: "task", text: "完整 immutable task\n " },
        ],
      }),
      "paste-1",
    );

  it.each([true, false, undefined])(
    "durably records a context-only prompt before negotiated dispatch %s",
    async (embeddedContextSupported) => {
      await runWithBusabaseContext({ embedOrigin: "https://busa.test" }, async () => {
        const { session, agent } = await open(null, { embeddedContextSupported });
        await waitUntilSettled(session.id);
        const context = promptContext();
        mocks.persistSessionEvents.mockClear();
        await promptAgentSession(session.id, "", undefined, { resourceContext: [context] });
        const recorded = mocks.persistSessionEvents.mock.calls
          .flatMap((call) => call[0] as AgentSessionEventVO[])
          .find(
            (event) =>
              (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
          );
        expect(recorded?.acpUpdate).toEqual({
          sessionUpdate: "user_message",
          text: "",
          resourceContext: [context],
        });
        expect(mocks.resolveAgentContextResources).not.toHaveBeenCalled();
        const sent = agent.promptContents()[0];
        expect(sent).toHaveLength(2);
        expect(sent?.[0]).toEqual({ type: "text", text: "" });
        expect(sent?.[1]).toMatchObject(
          embeddedContextSupported
            ? {
                type: "resource",
                resource: { uri: context.uri, mimeType: "text/plain", text: context.text },
              }
            : { type: "text", text: context.text },
        );
        await closeAgentSessions([session.id]);
      });
    },
  );

  it("rejects mismatched prompt snapshots before recording or dispatch and permits retry", async () => {
    await runWithBusabaseContext({ embedOrigin: "https://busa.test" }, async () => {
      const { session, agent } = await open(null);
      await waitUntilSettled(session.id);
      mocks.persistSessionEvents.mockClear();
      await expect(
        promptAgentSession(session.id, "", undefined, {
          resourceContext: [{ ...promptContext(), text: "tampered" }],
        }),
      ).rejects.toThrow(/exactly match/);
      expect(agent.promptContents()).toEqual([]);
      expect(
        mocks.persistSessionEvents.mock.calls
          .flatMap((call) => call[0] as AgentSessionEventVO[])
          .some(
            (event) =>
              (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
          ),
      ).toBe(false);
      await promptAgentSession(session.id, "Retry");
      expect(agent.promptTexts()).toEqual(["Retry"]);
      await closeAgentSessions([session.id]);
    });
  });

  it("does not accept or dispatch prompt snapshots when durable user-message persistence fails", async () => {
    await runWithBusabaseContext({ embedOrigin: "https://busa.test" }, async () => {
      const { session, agent } = await open(null);
      await waitUntilSettled(session.id);
      const onAccepted = vi.fn();
      mocks.persistSessionEvents.mockResolvedValueOnce(false);
      await expect(
        promptAgentSession(session.id, "", undefined, {
          resourceContext: [promptContext()],
          onAccepted,
        }),
      ).rejects.toThrow();
      expect(onAccepted).not.toHaveBeenCalled();
      expect(agent.promptContents()).toEqual([]);
      await closeAgentSessions([session.id]);
    });
  });

  it.each([true, false, undefined])(
    "persists the same resource snapshot sent through negotiated embeddedContext=%s",
    async (embeddedContextSupported) => {
      const { session, agent } = await open(null, { embeddedContextSupported });
      await waitUntilSettled(session.id);
      const snapshot = {
        nodeId: "nod_reference",
        nodeType: "doc",
        name: "Reference",
        slug: "reference",
        truncated: false,
        uri: "busabase://spaces/local/nodes/nod_reference",
        mimeType: "text/markdown",
        text: "The reference contains SNAPSHOT_ONLY_MARKER.",
        annotations: { audience: ["user", "assistant"] },
      };
      mocks.resolveAgentContextResources.mockResolvedValueOnce([snapshot]);
      mocks.persistSessionEvents.mockClear();
      await promptAgentSession(session.id, "Read the reference", undefined, {
        contextReferences: [{ nodeId: "nod_reference" }],
      });
      expect(mocks.resolveAgentContextResources).toHaveBeenCalledOnce();
      const sent = agent.promptContents()[0] ?? [];
      expect(sent[0]).toEqual({ type: "text", text: "Read the reference" });
      if (embeddedContextSupported) {
        expect(sent[1]).toMatchObject({
          type: "resource",
          resource: { text: snapshot.text, uri: snapshot.uri },
        });
      } else {
        expect(sent[1]).toMatchObject({
          type: "text",
          text: expect.stringContaining("SNAPSHOT_ONLY_MARKER"),
        });
        expect(sent.some((block) => block.type === "resource")).toBe(false);
      }
      const recorded = mocks.persistSessionEvents.mock.calls
        .flatMap((call) => call[0] as AgentSessionEventVO[])
        .find(
          (event) =>
            (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
        );
      expect(recorded?.acpUpdate).toEqual({
        sessionUpdate: "user_message",
        text: "Read the reference",
        contextResources: [snapshot],
      });
      await closeAgentSessions([session.id]);
    },
  );

  it("does not record or dispatch a failed reference read and releases the turn for retry", async () => {
    const { session, agent } = await open(null);
    await waitUntilSettled(session.id);
    mocks.persistSessionEvents.mockClear();
    mocks.resolveAgentContextResources.mockRejectedValueOnce(new Error("Reference unavailable"));
    await expect(
      promptAgentSession(session.id, "Read the reference", undefined, {
        contextReferences: [{ nodeId: "nod_unavailable" }],
      }),
    ).rejects.toThrow("Reference unavailable");
    expect(agent.promptContents()).toEqual([]);
    expect(
      mocks.persistSessionEvents.mock.calls
        .flatMap((call) => call[0] as AgentSessionEventVO[])
        .some(
          (event) =>
            (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
        ),
    ).toBe(false);
    expect(mocks.releaseSessionLease).toHaveBeenCalled();
    await promptAgentSession(session.id, "Retry without the reference");
    expect(agent.promptTexts()).toEqual(["Retry without the reference"]);
    await closeAgentSessions([session.id]);
  });

  it("exposes confirmed metadata while connecting and replaces it with fresh metadata or null", async () => {
    const first = await open([MODEL_CONFIG]);
    await waitUntilSettled(first.session.id);
    await closeAgentSessions([first.session.id]);
    for (const { config, cached, confirmed } of [
      { config: [{ ...MODEL_CONFIG, currentValue: "fast" }], cached: "auto", confirmed: "fast" },
      { config: null, cached: "fast", confirmed: null },
      { config: [MODEL_CONFIG], cached: null, confirmed: "auto" },
      { config: [], cached: "auto", confirmed: null },
    ]) {
      let release = () => {};
      const initializeGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const next = await open(config, { initializeGate });
      expect(next.session.status).toBe("connecting");
      expect(next.session.modelOption?.currentValue ?? null).toBe(cached);
      release();
      const settled = await waitUntilSettled(next.session.id);
      expect(settled.modelOption?.currentValue ?? null).toBe(confirmed);
      await closeAgentSessions([next.session.id]);
    }
    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const afterRevocation = await open([], { initializeGate });
    expect(afterRevocation.session.modelOption).toBeNull();
    release();
    await waitUntilSettled(afterRevocation.session.id);
    await closeAgentSessions([afterRevocation.session.id]);
    const failed = await open([MODEL_CONFIG], { initializeError: new Error("Handshake failed") });
    expect((await waitUntilSettled(failed.session.id)).status).toBe("failed");
    const afterFailure = await open([]);
    expect(afterFailure.session.modelOption).toBeNull();
    await waitUntilSettled(afterFailure.session.id);
    await closeAgentSessions([afterFailure.session.id]);
  });

  it("applies a cached selection made while still connecting once the handshake confirms it", async () => {
    const warm = await open([MODEL_CONFIG]);
    await waitUntilSettled(warm.session.id);
    await closeAgentSessions([warm.session.id]);

    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = await open([MODEL_CONFIG], { initializeGate });
    // Cache-seeded while the handshake is still outstanding — this is the
    // "cached list for selection" state the connecting-remote picker relies on.
    expect(next.session.status).toBe("connecting");
    expect(next.session.modelOption?.currentValue).toBe("auto");

    // The picker is enabled from the moment this cached value is visible
    // (see `isModelSelectorDisabled`), but every selection is a fresh RPC
    // validated against whatever `s.ready` ultimately confirms — so a pick
    // "made while connecting" still only resolves once the handshake has.
    release();
    await waitUntilSettled(next.session.id);
    const updated = await setAgentSessionConfigOption(next.session.id, "model", "fast");
    expect(updated.modelOption?.currentValue).toBe("fast");
    expect(updated.status).toBe("idle");

    await closeAgentSessions([next.session.id]);
  });

  it("rejects a cached choice removed by the new handshake", async () => {
    const warm = await open([MODEL_CONFIG]);
    await waitUntilSettled(warm.session.id);
    await closeAgentSessions([warm.session.id]);
    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = await open([{ ...MODEL_CONFIG, options: [{ value: "auto", name: "Auto" }] }], {
      initializeGate,
    });
    const configured = setAgentSessionConfigOption(next.session.id, "model", "fast");
    const rejected = expect(configured).rejects.toThrow("not one of the offered options");
    release();
    await rejected;
    await closeAgentSessions([next.session.id]);
  });

  it("rejects a connecting selection instead of succeeding when the handshake fails", async () => {
    const warm = await open([MODEL_CONFIG]);
    await waitUntilSettled(warm.session.id);
    await closeAgentSessions([warm.session.id]);

    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = await open([MODEL_CONFIG], {
      initializeGate,
      initializeError: new Error("Handshake failed"),
    });
    expect(next.session.status).toBe("connecting");
    expect(next.session.modelOption?.currentValue).toBe("auto");

    const configured = setAgentSessionConfigOption(next.session.id, "model", "fast");
    const rejected = expect(configured).rejects.toThrow("Handshake failed");
    release();
    // Readiness resolves even on failure; the queued selection must reject.
    await rejected;
    expect((await waitUntilSettled(next.session.id)).status).toBe("failed");
  });

  it("never reuses model-dependent thinking options for a brand-new session", async () => {
    const first = await open([MODEL_CONFIG, THINKING_CONFIG]);
    await waitUntilSettled(first.session.id);
    await closeAgentSessions([first.session.id]);
    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = await open([MODEL_CONFIG], { initializeGate });
    expect(next.session.modelOption?.currentValue).toBe("auto");
    expect(next.session.thinkingOption).toBeNull();
    release();
    expect((await waitUntilSettled(next.session.id)).thinkingOption).toBeNull();
    await closeAgentSessions([next.session.id]);
  });

  it("resumes with its own persisted model and thinking choices instead of another session's cache", async () => {
    const first = await open([MODEL_CONFIG]);
    await waitUntilSettled(first.session.id);
    await closeAgentSessions([first.session.id]);
    const record = runtimeRecord({
      slug: launch.slug,
      thinkingOption: {
        ...THINKING_CONFIG,
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
      modelOption: {
        id: "model",
        name: "Model",
        currentValue: "fast",
        options: [{ value: "fast", name: "Fast" }],
      },
    });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    let release = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValueOnce(clientSide);
    const agent = serveFakeAgent(
      agentSide,
      [
        { ...MODEL_CONFIG, currentValue: "fast" },
        { ...THINKING_CONFIG, currentValue: "high" },
      ],
      {
        initializeGate,
      },
    );
    const completion = promptAgentSession(record.session.id, "resume");
    await vi.waitFor(() => expect(agent.initializeCallCount()).toBe(1));
    const live = (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, AgentSessionVO> }
    ).__busabaseAgentSessions?.get(record.session.id);
    expect(live?.modelOption?.currentValue).toBe("fast");
    expect(live?.thinkingOption?.currentValue).toBe("high");
    expect(agent.promptTexts()).toEqual([]);
    release();
    await completion;
    await closeAgentSessions([record.session.id]);
  });

  it("does not publish unconfirmed metadata when its durable mirror fails", async () => {
    const first = await open([MODEL_CONFIG]);
    await waitUntilSettled(first.session.id);
    await closeAgentSessions([first.session.id]);
    mocks.persistSessionModelOption.mockResolvedValueOnce(false);
    const failed = await open([{ ...MODEL_CONFIG, currentValue: "fast" }]);
    expect((await waitUntilSettled(failed.session.id)).status).toBe("failed");
    const next = await open([]);
    expect(next.session.modelOption?.currentValue).toBe("auto");
    await waitUntilSettled(next.session.id);
    await closeAgentSessions([next.session.id]);
  });

  it.each(["agent", "space", "actor", "endpoint", "credential"])(
    "does not borrow metadata across %s identity",
    async (identity) => {
      const first = await open([MODEL_CONFIG]);
      await waitUntilSettled(first.session.id);
      await closeAgentSessions([first.session.id]);
      mocks.resolveLaunch.mockResolvedValue({
        ...launch,
        ...(identity === "agent" ? { slug: "buda:agent-2" } : {}),
        ...(identity === "endpoint" ? { url: "wss://other.test/acp?agentId=agent-1" } : {}),
        ...(identity === "credential" ? { authHeader: "Bearer account-2" } : {}),
      });
      const spaceId = identity === "space" ? "other-space" : LOCAL_SPACE_ID;
      await runWithBusabaseContext(
        { spaceId, actorId: identity === "actor" ? "other-actor" : undefined },
        async () => {
          let release = () => {};
          const initializeGate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const next = await open([], { initializeGate }, spaceId);
          expect(next.session.modelOption).toBeNull();
          release();
          await waitUntilSettled(next.session.id);
          await closeAgentSessions([next.session.id]);
        },
      );
    },
  );

  it.each([true, false])(
    "queues text and image until readiness and uses current image capability (%s)",
    async (imageSupported) => {
      const first = await open([MODEL_CONFIG], { imageSupported: true });
      await waitUntilSettled(first.session.id);
      await closeAgentSessions([first.session.id]);
      let release = () => {};
      const initializeGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const next = await open([MODEL_CONFIG], { initializeGate, imageSupported });
      expect(next.session.modelOption?.currentValue).toBe("auto");
      mocks.persistSessionEvents.mockClear();
      const prompt = promptAgentSession(next.session.id, "queued text", [
        { kind: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ]);
      await vi.waitFor(() => expect(mocks.persistSessionEvents).toHaveBeenCalled());
      expect(next.agent.promptContents()).toEqual([]);
      release();
      await prompt;
      expect(next.agent.promptTexts()).toEqual(["queued text"]);
      expect(next.agent.promptContents()[0]?.some((block) => block.type === "image")).toBe(
        imageSupported,
      );
      await closeAgentSessions([next.session.id]);
    },
  );
});

describe("agent session manager — model config option", () => {
  let agentSide: Stream;

  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
    const [clientSide, side] = linkedStreams();
    agentSide = side;
    mocks.createWebSocketStream.mockReturnValue(clientSide);
  });

  it("stores the advertised model option from session/new and surfaces it on the VO", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption).toEqual({
      id: "model",
      name: "Model",
      currentValue: "auto",
      options: [
        { value: "auto", name: "Auto" },
        { value: "fast", name: "Fast" },
      ],
    });

    await closeAgentSessions([session.id]);
  });

  it("discovers and changes the advertised thinking level, including thinking-only agents", async () => {
    const agent = serveFakeAgent(agentSide, [THINKING_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption).toBeNull();
    expect(settled.thinkingOption).toMatchObject({
      id: "reasoning_effort",
      currentValue: "medium",
    });

    const updated = await setAgentSessionConfigOption(session.id, "reasoning_effort", "high");
    expect(updated.thinkingOption?.currentValue).toBe("high");
    expect(agent.setConfigCallCount()).toBe(1);
    expect(
      (await listAgentSessions()).find((item) => item.id === session.id)?.thinkingOption
        ?.currentValue,
    ).toBe("high");
    await closeAgentSessions([session.id]);
  });

  it.each([false, true])(
    "preserves valid per-model metadata and ignores malformed advertisements (grouped: %s)",
    async (grouped) => {
      const thinking = {
        id: "reasoning_effort",
        name: "Thinking",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      };
      const entries = [
        { value: "auto", name: "Auto" },
        { value: "capable", name: "Capable", _meta: { "busabase/thought_level": thinking } },
        {
          value: "invalid",
          name: "Invalid",
          _meta: { "busabase/thought_level": { ...thinking, currentValue: true } },
        },
        {
          value: "stale",
          name: "Stale",
          _meta: { "busabase/thought_level": { ...thinking, currentValue: "missing" } },
        },
      ];
      serveFakeAgent(agentSide, [
        {
          ...MODEL_CONFIG,
          options: grouped ? [{ group: "family", name: "Family", options: entries }] : entries,
        },
      ]);
      const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
      const settled = await waitUntilSettled(session.id);
      expect(settled.modelOption?.options).toEqual([
        { value: "auto", name: "Auto" },
        { value: "capable", name: "Capable", thinking },
        { value: "invalid", name: "Invalid" },
        { value: "stale", name: "Stale" },
      ]);
      expect(settled.thinkingOption).toBeNull();
      await closeAgentSessions([session.id]);
    },
  );

  it("uses category precedence, flattens grouped thinking choices and accepts uncategorized conventional ids", async () => {
    serveFakeAgent(agentSide, [
      { ...THINKING_CONFIG, id: "thinking_level", category: undefined },
      {
        ...THINKING_CONFIG,
        id: "vendor-effort",
        options: [{ name: "Effort", group: "effort", options: [{ value: "high", name: "High" }] }],
      },
    ]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    const settled = await waitUntilSettled(session.id);
    expect(settled.thinkingOption).toMatchObject({
      id: "vendor-effort",
      options: [{ value: "high", name: "High" }],
    });
    await closeAgentSessions([session.id]);
  });

  it("replaces model-dependent thinking choices from a set response and removes revoked controls", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG, THINKING_CONFIG], {
      configResponse: (_configId, value) =>
        value === "fast"
          ? [
              { ...MODEL_CONFIG, currentValue: value },
              { ...THINKING_CONFIG, currentValue: "low", options: [{ value: "low", name: "Low" }] },
            ]
          : [{ ...MODEL_CONFIG, currentValue: value }],
    });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    const fast = await setAgentSessionConfigOption(session.id, "model", "fast");
    expect(fast.thinkingOption).toMatchObject({
      currentValue: "low",
      options: [{ value: "low", name: "Low" }],
    });
    const auto = await setAgentSessionConfigOption(session.id, "model", "auto");
    expect(auto.thinkingOption).toBeNull();
    await expect(
      setAgentSessionConfigOption(session.id, "reasoning_effort", "high"),
    ).rejects.toThrow(/no such config option/);
    await closeAgentSessions([session.id]);
  });

  it("rejects unsupported thinking values before dispatching ACP", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG, THINKING_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    await expect(
      setAgentSessionConfigOption(session.id, "reasoning_effort", "extreme"),
    ).rejects.toThrow(/not one of the offered options/);
    expect(agent.setConfigCallCount()).toBe(0);
    await closeAgentSessions([session.id]);
  });

  it("replaces thinking metadata on notifications and removes revoked controls", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG, THINKING_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    await agent.pushConfigUpdate([
      { ...MODEL_CONFIG, currentValue: "fast" },
      { ...THINKING_CONFIG, currentValue: "high" },
    ]);
    await vi.waitFor(async () =>
      expect(
        (await listAgentSessions()).find((item) => item.id === session.id)?.thinkingOption
          ?.currentValue,
      ).toBe("high"),
    );
    await agent.pushConfigUpdate([MODEL_CONFIG]);
    await vi.waitFor(async () =>
      expect(
        (await listAgentSessions()).find((item) => item.id === session.id)?.thinkingOption,
      ).toBeNull(),
    );
    await closeAgentSessions([session.id]);
  });

  it("does not publish an idle remote session before its model option is durable", async () => {
    let releasePersist = () => {};
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    mocks.persistSessionModelOption.mockImplementationOnce(async (sessionId, modelOption) => {
      await persistGate;
      const stored = mocks.storedSessions.find((candidate) => candidate.id === sessionId);
      if (!stored) return false;
      stored.modelOption = modelOption;
      return true;
    });

    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await vi.waitFor(() => expect(mocks.persistSessionModelOption).toHaveBeenCalledOnce());

    const whilePersisting = mocks.storedSessions.find((candidate) => candidate.id === session.id);
    expect(whilePersisting).toMatchObject({ status: "connecting", modelOption: null });

    releasePersist();
    await waitUntilSettled(session.id);
    expect(mocks.storedSessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      status: "idle",
      modelOption: { currentValue: "auto" },
    });

    await closeAgentSessions([session.id]);
  });

  it("persists the initial model option before claiming a first prompt's startup lease", async () => {
    let releaseFirstWrite = () => {};
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    mocks.persistSessionModelOption.mockImplementationOnce(async (sessionId, modelOption) => {
      await firstWriteGate;
      const stored = mocks.storedSessions.find((candidate) => candidate.id === sessionId);
      if (!stored) return false;
      stored.modelOption = modelOption;
      return true;
    });

    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await vi.waitFor(() => expect(mocks.persistSessionModelOption).toHaveBeenCalledOnce());

    const prompt = promptAgentSession(session.id, "prompt while model discovery finishes");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled();
    releaseFirstWrite();

    await expect(prompt).resolves.toBeUndefined();
    expect(agent.promptTexts()).toEqual(["prompt while model discovery finishes"]);
    expect(mocks.persistSessionModelOption).toHaveBeenCalledOnce();
    expect(mocks.acquireSessionLease).toHaveBeenCalledOnce();
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();

    await closeAgentSessions([session.id]);
  });

  it("does not publish an idle remote session when its model option cannot be persisted", async () => {
    mocks.persistSessionModelOption.mockResolvedValueOnce(false);
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const settled = await waitUntilSettled(session.id);
    expect(settled).toMatchObject({
      status: "failed",
      modelOption: null,
      error: expect.stringMatching(/persist the agent's model options/i),
    });

    await closeAgentSessions([session.id]);
  });

  it("leaves modelOption null when the agent advertises no model select", async () => {
    serveFakeAgent(agentSide, []);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption).toBeNull();

    await closeAgentSessions([session.id]);
  });

  it("does not emit a note when the agent lacks HTTP MCP support", async () => {
    // `serveFakeAgent`'s `initialize` responds with `agentCapabilities: {}` —
    // no `mcpCapabilities.http` — so this exercises the exact branch that
    // used to synthesize the "does not support HTTP MCP servers" note.
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    const persisted = mocks.persistSessionEvents.mock.calls.flatMap(
      ([events]) => events as AgentSessionEventVO[],
    );
    const noteTexts = persisted
      .filter((event) => event.kind === "acpUpdate")
      .map((event) => (event.acpUpdate as { text?: unknown })?.text)
      .filter((text): text is string => typeof text === "string");
    expect(noteTexts.some((text) => text.includes("does not support HTTP MCP servers"))).toBe(
      false,
    );

    await closeAgentSessions([session.id]);
  });

  it("recognizes the conventional model id when the optional category is absent", async () => {
    serveFakeAgent(agentSide, [{ ...MODEL_CONFIG, category: undefined }]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption?.id).toBe("model");

    await closeAgentSessions([session.id]);
  });

  it("rejects a value the agent never advertised, without sending it over ACP", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    await expect(
      setAgentSessionConfigOption(session.id, "model", "not-a-real-model"),
    ).rejects.toThrow(/not one of the offered options/i);
    expect(agent.setConfigCallCount()).toBe(0);

    await closeAgentSessions([session.id]);
  });

  it("replaces the local option from the complete session/set_config_option response", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    const updated = await setAgentSessionConfigOption(session.id, "model", "fast");
    expect(updated.modelOption?.currentValue).toBe("fast");

    await closeAgentSessions([session.id]);
  });

  it("rejects a model change and evicts the socket when lease release loses ownership", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    mocks.releaseSessionLease.mockResolvedValueOnce(false);

    await expect(setAgentSessionConfigOption(session.id, "model", "fast")).rejects.toThrow(
      /lost the agent session lease/i,
    );
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(session.id),
    ).toBe(false);
  });

  it("rejects a model change when its durable snapshot is rejected", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    mocks.persistSessionModelOption.mockResolvedValueOnce(false);
    mocks.releaseSessionLease.mockResolvedValueOnce(false);

    await expect(setAgentSessionConfigOption(session.id, "model", "fast")).rejects.toThrow(
      /persist the agent's model options/i,
    );
    const durable = mocks.storedSessions.find((candidate) => candidate.id === session.id);
    expect(durable?.modelOption?.currentValue).toBe("auto");
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(session.id),
    ).toBe(false);

    await closeAgentSessions([session.id]);
  });

  it("refreshes the local option from an unprompted config_option_update notification", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    // The agent changing its own mind (e.g. a rate-limit downgrade) — not a
    // response to setAgentSessionConfigOption — must still update the VO.
    await agent.pushConfigUpdate([{ ...MODEL_CONFIG, currentValue: "fast" }]);
    const settled = await waitUntil(
      async () => (await listAgentSessions()).find((s) => s.id === session.id),
      (found): found is NonNullable<typeof found> => found?.modelOption?.currentValue === "fast",
    );
    expect(settled.modelOption?.currentValue).toBe("fast");

    await closeAgentSessions([session.id]);
  });

  it("keeps source config, text and lifecycle notifications ordered while a config write is gated", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], { budaEventStream: true });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    let releaseWrite = () => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writeEntered = () => {};
    const entered = new Promise<void>((resolve) => {
      writeEntered = resolve;
    });
    mocks.persistSessionModelOption.mockImplementationOnce(async () => {
      writeEntered();
      await writeGate;
      return true;
    });
    const sourceSequences = () =>
      mocks.persistSessionEvents.mock.calls.flatMap((call) =>
        (call[0] as AgentSessionEventVO[]).flatMap((event) => {
          const params = event.acpUpdate ?? event.acpExtension?.params;
          const meta = (params as { _meta?: { "buda.im"?: { seq?: unknown } } } | undefined)
            ?._meta?.["buda.im"];
          return typeof meta?.seq === "number" ? [meta.seq] : [];
        }),
      );
    try {
      await agent.pushNotification(acp.methods.client.session.update, {
        sessionId: "acp-sess-1",
        update: {
          sessionUpdate: "config_option_update",
          configOptions: [{ ...MODEL_CONFIG, currentValue: "fast" }],
          _meta: { "buda.im": { seq: 10 } },
        },
      });
      await entered;
      await agent.pushNotification(acp.methods.client.session.update, {
        sessionId: "acp-sess-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "answer",
          content: { type: "text", text: "After config" },
          _meta: { "buda.im": { seq: 11 } },
        },
      });
      await agent.pushNotification("_buda.im/session_event", {
        sessionId: "acp-sess-1",
        event: {
          version: 1,
          type: "job_update",
          turnId: "turn",
          at: "2026-10-26T00:00:00Z",
          job: { id: "job", title: "Task", status: "completed" },
        },
        _meta: { "buda.im": { seq: 12 } },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Later notifications must not overtake a source event awaiting its DB write.
      expect(sourceSequences()).toEqual([]);
      releaseWrite();
      await vi.waitFor(() => expect(sourceSequences()).toEqual([10, 11, 12]));
      const live = (
        globalThis as typeof globalThis & {
          __busabaseAgentSessions?: Map<string, { upstreamSeq?: number }>;
        }
      ).__busabaseAgentSessions?.get(session.id);
      expect(live?.upstreamSeq).toBe(12);
    } finally {
      releaseWrite();
      await closeAgentSessions([session.id]);
    }
  });

  it("persists an in-turn config update before releasing the prompt lease", async () => {
    let releasePrompt = () => {};
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    let releaseModelWrite = () => {};
    const modelWriteGate = new Promise<void>((resolve) => {
      releaseModelWrite = resolve;
    });
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], { promptGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    mocks.persistSessionModelOption.mockImplementationOnce(async (sessionId, modelOption) => {
      await modelWriteGate;
      const stored = mocks.storedSessions.find((candidate) => candidate.id === sessionId);
      if (!stored) return false;
      stored.modelOption = modelOption;
      return true;
    });

    const prompt = promptAgentSession(session.id, "update the model during this turn");
    await vi.waitFor(() =>
      expect(agent.promptTexts()).toEqual(["update the model during this turn"]),
    );
    const update = agent.pushConfigUpdate([{ ...MODEL_CONFIG, currentValue: "fast" }]);
    await vi.waitFor(() => expect(mocks.persistSessionModelOption).toHaveBeenCalledTimes(2));

    releasePrompt();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.releaseSessionLease).not.toHaveBeenCalled();

    releaseModelWrite();
    await update;
    await prompt;
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
    expect(mocks.storedSessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      status: "idle",
      modelOption: { currentValue: "fast" },
    });

    await agent.pushConfigUpdate([{ ...MODEL_CONFIG, currentValue: "auto" }]);
    expect(mocks.persistSessionModelOption).toHaveBeenLastCalledWith(
      session.id,
      expect.objectContaining({ currentValue: "auto" }),
      { spaceId: LOCAL_SPACE_ID, actorId: null },
      undefined,
      null,
    );

    await closeAgentSessions([session.id]);
  });

  it("publishes a notification queued during lease acquisition after the durable refresh", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    const loadRuntime = mocks.loadSessionRuntime.getMockImplementation();
    let releaseClaimRead = () => {};
    const claimReadGate = new Promise<void>((resolve) => {
      releaseClaimRead = resolve;
    });
    mocks.loadSessionRuntime.mockImplementationOnce(async (sessionId) => {
      const snapshot = await loadRuntime?.(sessionId);
      await claimReadGate;
      return snapshot ?? null;
    });

    const prompt = promptAgentSession(session.id, "claim while the model changes");
    await vi.waitFor(() => expect(mocks.acquireSessionLease).toHaveBeenCalled());
    const update = agent.pushConfigUpdate([{ ...MODEL_CONFIG, currentValue: "fast" }]);
    releaseClaimRead();

    await update;
    await prompt;
    expect(mocks.storedSessions.find((candidate) => candidate.id === session.id)).toMatchObject({
      modelOption: { currentValue: "fast" },
    });

    await closeAgentSessions([session.id]);
  });

  /**
   * Regression: before the durable mirror, `listAgentSessions` and
   * `listAgentSessionsPaged` could only recover `modelOption` from THIS
   * process's in-memory `sessions()` map. A `remote-websocket` session can be
   * reattached from any worker, so a list request served by a
   * worker that never held the live socket — simulated here by deleting the
   * entry from `__busabaseAgentSessions`, the same technique the
   * live-session-ownership tests below use — saw the same durable row with
   * `modelOption: null` even though the agent had already advertised one.
   * That is exactly the "intermittent" symptom: whichever worker happens to
   * answer the request decides whether the picker renders.
   */
  it("surfaces the durable model option to a worker with no live copy of the session", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    // This worker's own in-memory copy already has it — sanity check before
    // simulating the handoff.
    const beforeHandoff = (await listAgentSessions()).find((s) => s.id === session.id);
    expect(beforeHandoff?.modelOption?.currentValue).toBe("auto");

    // Simulate a second worker: no live socket for this session at all, only
    // the durable row `persistSessionModelOption` wrote alongside it.
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.delete(session.id);

    const fromOtherWorker = (await listAgentSessions()).find((s) => s.id === session.id);
    expect(fromOtherWorker?.modelOption).toEqual({
      id: "model",
      name: "Model",
      currentValue: "auto",
      options: [
        { value: "auto", name: "Auto" },
        { value: "fast", name: "Fast" },
      ],
    });

    const paged = (await listAgentSessionsPaged({ slug: "test-agent", limit: 20 })).items.find(
      (s) => s.id === session.id,
    );
    expect(paged?.modelOption?.currentValue).toBe("auto");

    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
  });

  it("keeps the durable model option authoritative over a stale live socket", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    const stored = mocks.storedSessions.find((candidate) => candidate.id === session.id);
    expect(stored).toBeDefined();
    if (!stored?.modelOption) throw new Error("Expected a durable model option");
    const durableOption = {
      ...stored.modelOption,
      currentValue: "accurate",
      options: [...stored.modelOption.options, { value: "accurate", name: "Accurate" }],
    };
    stored.modelOption = durableOption;
    agent.setConfigOptionsSilently([
      {
        ...MODEL_CONFIG,
        currentValue: durableOption.currentValue,
        options: durableOption.options,
      },
    ]);

    const listed = (await listAgentSessions()).find((candidate) => candidate.id === session.id);
    expect(listed?.modelOption?.currentValue).toBe("accurate");

    const paged = (await listAgentSessionsPaged({ slug: "test-agent", limit: 20 })).items.find(
      (candidate) => candidate.id === session.id,
    );
    expect(paged?.modelOption?.currentValue).toBe("accurate");

    await expect(
      setAgentSessionConfigOption(session.id, "model", "accurate"),
    ).resolves.toMatchObject({ modelOption: { currentValue: "accurate" } });
    expect(agent.setConfigCallCount()).toBe(1);

    await closeAgentSessions([session.id]);
  });
});

describe("agent session manager — live-session ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
  });

  it("isolates same-slug live sessions by both workspace and actor", async () => {
    const createScopedSession = async (spaceId: string, actorId: string) => {
      const [clientSide, agentSide] = linkedStreams();
      mocks.createWebSocketStream.mockReturnValueOnce(clientSide);
      serveFakeAgent(agentSide, []);
      return runWithBusabaseContext({ spaceId, actorId }, () =>
        createAgentSession({ slug: "test-agent", spaceId }),
      );
    };

    const aliceInA = await createScopedSession("space-a", "alice");
    const bobInA = await createScopedSession("space-a", "bob");
    const aliceInB = await createScopedSession("space-b", "alice");

    const listIds = (spaceId: string, actorId: string) =>
      runWithBusabaseContext({ spaceId, actorId }, async () =>
        (await listAgentSessionsPaged({ slug: "test-agent", limit: 20 })).items.map(
          (session) => session.id,
        ),
      );

    await expect(listIds("space-a", "alice")).resolves.toEqual([aliceInA.id]);
    await expect(listIds("space-a", "bob")).resolves.toEqual([bobInA.id]);
    await expect(listIds("space-b", "alice")).resolves.toEqual([aliceInB.id]);

    await expect(
      runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, async () =>
        (await listAgentSessions()).map((session) => session.id),
      ),
    ).resolves.toEqual([aliceInA.id]);

    await closeAgentSessions([aliceInA.id, bobInA.id, aliceInB.id]);
  });

  it("refuses to close a live session that belongs to another actor", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValueOnce(clientSide);
    serveFakeAgent(agentSide, []);
    const alices = await runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, () =>
      createAgentSession({ slug: "test-agent", spaceId: "space-a" }),
    );
    await runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, () =>
      waitUntilSettled(alices.id),
    );

    const listIdsFor = (actorId: string) =>
      runWithBusabaseContext({ spaceId: "space-a", actorId }, async () =>
        (await listAgentSessionsPaged({ slug: "test-agent", limit: 20 })).items.map((s) => s.id),
      );

    // Knowing the id is not enough: the family's `write` gate says whether you
    // may end sessions, not whose. Deliberately the same "Unknown agent
    // session" wording an unrecognized id gets — someone else's session must
    // be indistinguishable from one that never existed.
    await expect(
      runWithBusabaseContext({ spaceId: "space-a", actorId: "bob" }, async () =>
        closeAgentSession(alices.id),
      ),
    ).rejects.toThrow(`Unknown agent session: ${alices.id}`);
    await expect(listIdsFor("alice")).resolves.toEqual([alices.id]);

    // …and the owner still can.
    await runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, async () =>
      closeAgentSession(alices.id),
    );
    await expect(listIdsFor("alice")).resolves.toEqual([]);
  });

  it("refuses prompt / cancel / set-config / permission-answer on another actor's live session", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValueOnce(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const alices = await runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, () =>
      createAgentSession({ slug: "test-agent", spaceId: "space-a" }),
    );
    await runWithBusabaseContext({ spaceId: "space-a", actorId: "alice" }, () =>
      waitUntilSettled(alices.id),
    );

    // Every request-path operation, not just `close`: knowing the id must not
    // let Bob drive, interrupt, reconfigure, or answer a permission prompt on
    // Alice's agent. All four report the id as unknown — indistinguishable
    // from one that never existed, so the error is not an id oracle.
    const unknown = `Unknown agent session: ${alices.id}`;
    const asBob = <T>(run: () => Promise<T> | T) =>
      runWithBusabaseContext({ spaceId: "space-a", actorId: "bob" }, async () => run());

    await expect(
      asBob(() => promptAgentSession(alices.id, "drive someone else's agent")),
    ).rejects.toThrow(unknown);
    await expect(asBob(() => cancelAgentSession(alices.id))).rejects.toThrow(unknown);
    await expect(
      asBob(() => setAgentSessionConfigOption(alices.id, "model", "fast")),
    ).rejects.toThrow(unknown);
    await expect(
      asBob(() => respondToAgentPermission(alices.id, "req-1", "allow")),
    ).rejects.toThrow(unknown);

    // Nothing reached the agent, and Alice's session is unchanged.
    expect(agent.promptTexts()).toEqual([]);
    expect(agent.setConfigCallCount()).toBe(0);
    const [asAlice] = await runWithBusabaseContext(
      { spaceId: "space-a", actorId: "alice" },
      async () => listAgentSessions(),
    );
    expect(asAlice?.id).toBe(alices.id);
    expect(asAlice?.status).not.toBe("ended");
    expect(asAlice?.modelOption?.currentValue).toBe("auto");

    // The owner is not blocked by the same guard.
    const updated = await runWithBusabaseContext(
      { spaceId: "space-a", actorId: "alice" },
      async () => setAgentSessionConfigOption(alices.id, "model", "fast"),
    );
    expect(updated.modelOption?.currentValue).toBe("fast");

    await closeAgentSessions([alices.id]);
  });

  it("refuses another actor's persisted remote session when this worker has no live copy", async () => {
    const session = runtimeRecord().session;
    mocks.storedSessions.push(session);
    mocks.storedScopes.set(session.id, { spaceId: "space-a", actorId: "alice" });

    const asBob = <T>(run: () => Promise<T> | T) =>
      runWithBusabaseContext({ spaceId: "space-a", actorId: "bob" }, async () => run());
    const unknown = `Unknown agent session: ${session.id}`;
    await expect(asBob(() => promptAgentSession(session.id, "hello"))).rejects.toThrow(unknown);
    await expect(
      asBob(() => setAgentSessionConfigOption(session.id, "model", "fast")),
    ).rejects.toThrow(unknown);
    await expect(asBob(() => closeAgentSession(session.id))).rejects.toThrow(unknown);
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled();
    expect(mocks.endRemoteSession).not.toHaveBeenCalled();
    expect(session.status).toBe("idle");
  });
});

describe("promptAgentSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
  });

  it("publishes and persists the user message before agent startup finishes", async () => {
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const prompt = vi.fn().mockResolvedValue(undefined);
    const listener = vi.fn();
    const session = {
      id: "session-1",
      // Hand-built `LiveSession`s go straight into the map, so they must carry
      // the same ownership fields `createAgentSession` stamps on — the default
      // context's space and its null actor — or `requireLocalSession` rejects them.
      spaceId: LOCAL_SPACE_ID,
      actorId: null,
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess" as const,
      status: "connecting" as const,
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready,
      promptStarting: false,
      prompt,
      cancel: vi.fn(),
      detach: vi.fn(),
      close: vi.fn(),
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      flushPending: Promise.resolve(),
      buffer: [],
      listeners: new Set([listener]),
      pendingPermissions: new Map(),
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(session.id, session);

    const result = promptAgentSession(session.id, "hello while starting");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(listener.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "acpUpdate",
          acpUpdate: { sessionUpdate: "user_message", text: "hello while starting" },
        }),
        expect.objectContaining({ kind: "status", status: "busy" }),
      ]),
    );
    await vi.waitFor(() => expect(mocks.persistSessionEvents).toHaveBeenCalledTimes(1));
    expect(prompt).not.toHaveBeenCalled();

    resolveReady?.();
    await result;
    expect(prompt).toHaveBeenCalledWith("hello while starting", undefined, expect.any(AbortSignal));
  });

  it("marks a terminal rejection before echo as safe for continuation", async () => {
    const session = {
      id: "session-terminal-before-echo",
      spaceId: LOCAL_SPACE_ID,
      actorId: null,
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess" as const,
      status: "failed" as const,
      error: "ACP connection closed",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready: Promise.resolve(),
      promptStarting: false,
      prompt: vi.fn(),
      cancel: vi.fn(),
      detach: vi.fn(),
      close: vi.fn(),
      closed: false,
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      flushPending: Promise.resolve(),
      buffer: [],
      listeners: new Set(),
      pendingPermissions: new Map(),
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(session.id, session);

    await expect(promptAgentSession(session.id, "continue me")).rejects.toMatchObject({
      name: AgentSessionTerminalError.name,
      status: "failed",
      promptRecorded: false,
    });
    expect(session.buffer).toEqual([]);
  });

  it("marks a terminal transition after echo as unsafe to retry", async () => {
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const session = {
      id: "session-terminal-after-echo",
      spaceId: LOCAL_SPACE_ID,
      actorId: null,
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess" as const,
      status: "connecting" as AgentSessionVO["status"],
      error: null as string | null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready,
      promptStarting: false,
      prompt: vi.fn(),
      cancel: vi.fn(),
      detach: vi.fn(),
      close: vi.fn(),
      closed: false,
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      flushPending: Promise.resolve(),
      buffer: [],
      listeners: new Set(),
      pendingPermissions: new Map(),
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(session.id, session);

    const prompt = promptAgentSession(session.id, "record exactly once");
    await vi.waitFor(() => expect(mocks.persistSessionEvents).toHaveBeenCalledTimes(1));
    session.status = "failed";
    session.error = "ACP connection closed";
    resolveReady?.();

    await expect(prompt).rejects.toMatchObject({
      name: AgentSessionTerminalError.name,
      status: "failed",
      promptRecorded: true,
    });
    expect(session.buffer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "acpUpdate",
          acpUpdate: { sessionUpdate: "user_message", text: "record exactly once" },
        }),
        expect.objectContaining({ kind: "status", status: "busy" }),
      ]),
    );
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it("waits for session/new before sending a prompt created during startup", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { initializeGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    let promptFinished = false;
    const prompt = promptAgentSession(session.id, "sent after ready").then(() => {
      promptFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(promptFinished).toBe(false);
    expect(agent.promptTexts()).toEqual([]);

    finishInitialize?.();
    await prompt;
    expect(agent.promptTexts()).toEqual(["sent after ready"]);

    await closeAgentSessions([session.id]);
  });

  it("acknowledges a durable busy turn before the remote prompt completes", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let releasePrompt: (() => void) | undefined;
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { promptGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    await startAgentSessionPrompt(session.id, "accepted before completion");

    await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["accepted before completion"]));
    expect(
      (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
    ).toBe("busy");

    releasePrompt?.();
    await vi.waitFor(async () =>
      expect(
        (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
      ).toBe("idle"),
    );
    await closeAgentSessions([session.id]);
  });

  it("fails an accepted turn when remote session startup never becomes ready", async () => {
    vi.stubEnv("BUSABASE_AGENT_SESSION_READY_TIMEOUT_MS", "25");
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let releaseInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { initializeGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    try {
      await startAgentSessionPrompt(session.id, "accept before startup finishes");

      await vi.waitFor(
        async () =>
          expect(
            (await listAgentSessions()).find((candidate) => candidate.id === session.id),
          ).toMatchObject({
            status: "failed",
            error: "Test Agent did not finish connecting. Start a new session to continue.",
          }),
        { timeout: 1_000 },
      );
      expect(agent.newSessionCallCount()).toBe(0);
    } finally {
      releaseInitialize?.();
      vi.unstubAllEnvs();
      await closeAgentSessions([session.id]);
    }
  });

  it("fails an accepted turn when the remote prompt stops producing activity", async () => {
    vi.stubEnv("BUSABASE_AGENT_PROMPT_IDLE_TIMEOUT_MS", "25");
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let releasePrompt: (() => void) | undefined;
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { promptGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    try {
      await startAgentSessionPrompt(session.id, "do not spin forever");

      await vi.waitFor(
        async () =>
          expect(
            (await listAgentSessions()).find((candidate) => candidate.id === session.id),
          ).toMatchObject({
            status: "failed",
            error: "Test Agent stopped responding. Start a new session to continue.",
          }),
        { timeout: 1_000 },
      );
      await vi.waitFor(() => expect(agent.cancelledSessionIds()).toEqual(["acp-sess-1"]));
    } finally {
      releasePrompt?.();
      vi.unstubAllEnvs();
      await closeAgentSessions([session.id]);
    }
  });

  it("pauses the inactivity deadline while waiting for human permission", async () => {
    vi.stubEnv("BUSABASE_AGENT_PROMPT_IDLE_TIMEOUT_MS", "25");
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    serveFakeAgent(agentSide, [], { requestPermission: true });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    try {
      await startAgentSessionPrompt(session.id, "wait for my permission");
      await vi.waitFor(async () =>
        expect(
          (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
        ).toBe("waiting_permission"),
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(
        (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
      ).toBe("waiting_permission");

      const live = (
        globalThis as typeof globalThis & {
          __busabaseAgentSessions?: Map<
            string,
            { buffer: AgentSessionEventVO[]; pendingPermissions: unknown }
          >;
        }
      ).__busabaseAgentSessions?.get(session.id);
      const permission = live?.buffer.findLast((event) => event.kind === "permissionRequest");
      expect(permission?.permissionRequest?.requestId).toBeTruthy();
      respondToAgentPermission(
        session.id,
        permission?.permissionRequest?.requestId ?? "missing",
        "allow",
      );

      await vi.waitFor(async () =>
        expect(
          (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
        ).toBe("idle"),
      );
    } finally {
      vi.unstubAllEnvs();
      await closeAgentSessions([session.id]);
    }
  });

  it("still rejects a terminal session before acknowledging or recording a prompt", async () => {
    const failed = runtimeRecord({ status: "failed", error: "Remote turn failed" });
    mocks.storedSessions.push(failed.session);
    mocks.storedScopes.set(failed.session.id, { spaceId: LOCAL_SPACE_ID, actorId: null });
    mocks.loadSessionRuntime.mockResolvedValue(failed);
    mocks.acquireSessionLease.mockResolvedValueOnce(null);

    await expect(
      startAgentSessionPrompt(failed.session.id, "do not record me"),
    ).rejects.toMatchObject({
      name: AgentSessionTerminalError.name,
      promptRecorded: false,
    });
    expect(mocks.persistSessionEvents).not.toHaveBeenCalled();
  });

  it("disconnects without waiting for a stalled ACP initialization", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    serveFakeAgent(agentSide, [], { initializeGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const closed = closeAgentSessions([session.id]).then(() => "closed" as const);
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 100);
    });
    await expect(Promise.race([closed, timeout])).resolves.toBe("closed");
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(session.id),
    ).toBe(false);

    finishInitialize?.();
  });

  it("rejects a second startup prompt without publishing a phantom user message", async () => {
    const session = {
      id: "session-2",
      spaceId: LOCAL_SPACE_ID,
      actorId: null,
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess" as const,
      status: "connecting" as const,
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready: new Promise<void>(() => {}),
      promptStarting: true,
      prompt: vi.fn(),
      cancel: vi.fn(),
      detach: vi.fn(),
      close: vi.fn(),
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      flushPending: Promise.resolve(),
      buffer: [],
      listeners: new Set(),
      pendingPermissions: new Map(),
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(session.id, session);

    await expect(promptAgentSession(session.id, "duplicate")).rejects.toThrow("still replying");

    expect(session.buffer).toEqual([]);
    expect(mocks.persistSessionEvents).not.toHaveBeenCalled();
  });

  it("rejects access when the live session belongs to another request scope", async () => {
    const live = {
      id: "session-scoped",
      spaceId: "space-1",
      actorId: "actor-1",
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess" as const,
      status: "idle" as const,
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready: Promise.resolve(),
      promptStarting: false,
      prompt: vi.fn(),
      cancel: vi.fn(),
      detach: vi.fn(),
      close: vi.fn(),
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      flushPending: Promise.resolve(),
      buffer: [],
      listeners: new Set(),
      pendingPermissions: new Map(),
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(live.id, live);

    // `loadSessionRuntime`'s default mock (see `resetStoreMocks`) already
    // reads `__busabaseAgentSessions` and checks the live entry's
    // `spaceId`/`actorId` against the current request context, so a scope
    // mismatch surfaces the same way it would in production: as a null
    // runtime record, which every one of these operations turns into
    // "Unknown agent session" rather than leaking whether the id exists.
    await runWithBusabaseContext({ spaceId: "space-1", actorId: "actor-2" }, async () => {
      await expect(promptAgentSession(live.id, "not mine")).rejects.toThrow(
        `Unknown agent session: ${live.id}`,
      );
      await expect(cancelAgentSession(live.id)).rejects.toThrow(
        `Unknown agent session: ${live.id}`,
      );
      await expect(closeAgentSession(live.id)).rejects.toThrow(`Unknown agent session: ${live.id}`);
      expect(() => respondToAgentPermission(live.id, "request-1", "allow")).toThrow(
        `Unknown agent session: ${live.id}`,
      );
      await expect(subscribeAgentSession(live.id, -1).next()).rejects.toThrow(
        `Unknown agent session: ${live.id}`,
      );
    });
    expect(live.prompt).not.toHaveBeenCalled();

    await runWithBusabaseContext({ spaceId: "space-2", actorId: "actor-1" }, async () => {
      await expect(promptAgentSession(live.id, "wrong space")).rejects.toThrow(
        `Unknown agent session: ${live.id}`,
      );
    });
  });
});

describe("cancelAgentSession", () => {
  let agentSide: Stream;

  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
    const [clientSide, side] = linkedStreams();
    agentSide = side;
    mocks.createWebSocketStream.mockReturnValue(clientSide);
  });

  it("does not dispatch a provider prompt after Stop during the final lease renewal and accepts a follow-up", async () => {
    const agent = serveFakeAgent(agentSide, []);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    let releaseRenewal = () => {};
    const renewalGate = new Promise<void>((resolve) => {
      releaseRenewal = resolve;
    });
    let finalRenewalEntered = false;
    mocks.renewSessionLease.mockClear();
    // The first renewal claims the operation; the second is immediately
    // before session/prompt dispatch on the already-connected ACP socket.
    mocks.renewSessionLease.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
      finalRenewalEntered = true;
      await renewalGate;
      return true;
    });
    const prompt = promptAgentSession(session.id, "cancel at final dispatch check").catch(
      (error: unknown) => error,
    );
    try {
      await vi.waitFor(() => expect(finalRenewalEntered).toBe(true));
      expect(agent.promptTexts()).toEqual([]);
      await cancelAgentSession(session.id);
      releaseRenewal();
      await expect(prompt).resolves.toBeUndefined();
      expect(agent.promptTexts()).toEqual([]);
      expect((await waitUntilSettled(session.id)).status).toBe("idle");
      await promptAgentSession(session.id, "follow-up after early stop");
      expect(agent.promptTexts()).toEqual(["follow-up after early stop"]);
      expect(agent.newSessionCallCount()).toBe(1);
      expect((await waitUntilSettled(session.id)).status).toBe("idle");
    } finally {
      releaseRenewal();
      await closeAgentSessions([session.id]);
    }
  });

  it("records a user-cancelled legacy turn only after its end_turn receipt settles and keeps the provider reason", async () => {
    let releaseReceipt = () => {};
    const receiptGate = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], {
      cancelFirstPromptOnNotify: true,
      cancelFirstPromptStopReason: "end_turn",
      cancelResponseGate: receiptGate,
      promptChunkText: "Real provider progress before Stop",
    });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<string, { buffer: AgentSessionEventVO[] }>;
      }
    ).__busabaseAgentSessions?.get(session.id);
    const finishedEvents = () =>
      (live?.buffer ?? []).flatMap((event) => {
        const data = (event.acpExtension?.params as { event?: unknown } | undefined)?.event;
        return data && typeof data === "object" && "type" in data && data.type === "turn_finished"
          ? [data as Record<string, unknown>]
          : [];
      });
    const prompt = promptAgentSession(session.id, "legacy Provider stop").catch(
      (error: unknown) => error,
    );
    try {
      await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["legacy Provider stop"]));
      await cancelAgentSession(session.id);
      await vi.waitFor(() => expect(agent.cancelledSessionIds()).toEqual(["acp-sess-1"]));
      expect(
        (await listAgentSessions()).find((candidate) => candidate.id === session.id)?.status,
      ).toBe("busy");
      expect(finishedEvents()).toEqual([]);
      releaseReceipt();
      await expect(prompt).resolves.toBeUndefined();
      expect(finishedEvents()).toMatchObject([
        { stopReason: "cancelled", providerStopReason: "end_turn" },
      ]);
      const blocks = reduceAcpEvents([], (live?.buffer ?? []).flatMap(translateAgentSessionEvent));
      expect(blocks.find((block) => block.kind === "turn")).toMatchObject({
        status: "cancelled",
        stopReason: "cancelled",
      });
      expect((await waitUntilSettled(session.id)).status).toBe("idle");
      await promptAgentSession(session.id, "follow-up after legacy stop");
      expect(agent.promptTexts()).toEqual(["legacy Provider stop", "follow-up after legacy stop"]);
      expect(agent.newSessionCallCount()).toBe(1);
      expect((await waitUntilSettled(session.id)).status).toBe("idle");
    } finally {
      releaseReceipt();
      await closeAgentSessions([session.id]);
    }
  });

  it(
    "sends session/cancel, waits for the pending prompt to resolve cancelled, " +
      "returns to idle, and accepts a follow-up prompt in the same session",
    async () => {
      let releaseCancelledResponse = () => {};
      const cancelResponseGate = new Promise<void>((resolve) => {
        releaseCancelledResponse = resolve;
      });
      const agent = serveFakeAgent(agentSide, [], {
        cancelFirstPromptOnNotify: true,
        cancelResponseGate,
      });
      const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
      await waitUntilSettled(session.id);

      const prompt = promptAgentSession(session.id, "please stop this turn");
      await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["please stop this turn"]));
      const busy = await waitUntil(
        async () => (await listAgentSessions()).find((s) => s.id === session.id),
        (found): found is NonNullable<typeof found> => found?.status === "busy",
      );
      expect(busy.status).toBe("busy");

      // Fire the cancel notification. It must not, by itself, flip the session
      // back to idle — that only happens once the fake agent's still-pending
      // `session/prompt` handler observes the notification and resolves with
      // `stopReason: "cancelled"` (asserted below via the real `prompt` await).
      await cancelAgentSession(session.id);
      expect(agent.cancelledSessionIds()).toEqual(["acp-sess-1"]);
      await vi.waitFor(() => expect(agent.cancelledRequestSessionIds()).toEqual(["acp-sess-1"]));

      const stillBusy = (await listAgentSessions()).find((s) => s.id === session.id);
      expect(stillBusy?.status).toBe("busy");

      // The original prompt call is exactly what resolves once the agent
      // answers the cancelled request — proving the client is driven by that
      // response and not by the cancel notification settling.
      releaseCancelledResponse();
      await expect(prompt).resolves.toBeUndefined();

      const idled = await waitUntilSettled(session.id);
      expect(idled.status).toBe("idle");

      // A follow-up prompt in the same session must still work.
      await promptAgentSession(session.id, "still usable after stop");
      expect(agent.promptTexts()).toEqual(["please stop this turn", "still usable after stop"]);
      const idledAgain = await waitUntilSettled(session.id);
      expect(idledAgain.status).toBe("idle");

      await closeAgentSessions([session.id]);
    },
  );

  it("does not force idle when cancel is called with no turn in flight", async () => {
    serveFakeAgent(agentSide, []);
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    // Nothing pending to cancel — the notification still goes out (best
    // effort, per AcpSessionPort.cancel's contract), but there is no prompt
    // response to wait on, so the session simply stays idle throughout.
    await cancelAgentSession(session.id);
    const settled = await waitUntilSettled(session.id);
    expect(settled.status).toBe("idle");

    await closeAgentSessions([session.id]);
  });

  it("cancels a prompt waiting for ACP readiness and keeps the session usable", async () => {
    let releaseInitialize = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { initializeGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });

    const prompt = promptAgentSession(session.id, "cancel before ACP is ready");
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<string, { promptStarting: boolean }>;
      }
    ).__busabaseAgentSessions?.get(session.id);
    await vi.waitFor(() => expect(live?.promptStarting).toBe(true));

    await cancelAgentSession(session.id);
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 500);
    });
    await expect(Promise.race([prompt.then(() => "cancelled" as const), timeout])).resolves.toBe(
      "cancelled",
    );
    expect(agent.newSessionCallCount()).toBe(0);
    expect(agent.promptTexts()).toEqual([]);

    // Cancellation stops only this turn. The handshake may still finish and
    // the same outer + ACP session must accept the next prompt.
    releaseInitialize();
    const ready = await waitUntilSettled(session.id);
    expect(ready.status).toBe("idle");
    await promptAgentSession(session.id, "still usable after startup stop");
    expect(agent.promptTexts()).toEqual(["still usable after startup stop"]);

    await closeAgentSessions([session.id]);
  });
});

describe("respondToAgentPermission — concurrent requests", () => {
  let agentSide: Stream;

  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
    const [clientSide, side] = linkedStreams();
    agentSide = side;
    mocks.createWebSocketStream.mockReturnValue(clientSide);
  });

  type PendingEntry = { resolve: (outcome: acp.RequestPermissionOutcome) => void };
  const liveSession = (sessionId: string) => {
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          { buffer: AgentSessionEventVO[]; pendingPermissions: Map<string, PendingEntry> }
        >;
      }
    ).__busabaseAgentSessions?.get(sessionId);
    if (!live) throw new Error(`No live session ${sessionId}`);
    return live;
  };
  const permissionCards = (sessionId: string) =>
    liveSession(sessionId)
      .buffer.filter((event) => event.kind === "permissionRequest")
      .map((event) => ({
        requestId: event.permissionRequest?.requestId ?? "missing",
        title: event.permissionRequest?.title,
      }));
  /** Status events of the current turn, i.e. after the user's prompt was echoed. */
  const turnStatuses = (sessionId: string) => {
    const { buffer } = liveSession(sessionId);
    const promptIndex = buffer.findLastIndex(
      (event) =>
        event.kind === "acpUpdate" &&
        (event.acpUpdate as { sessionUpdate?: string } | undefined)?.sessionUpdate ===
          "user_message",
    );
    return buffer
      .slice(promptIndex + 1)
      .filter((event) => event.kind === "status")
      .map((event) => event.status);
  };
  const statusOf = async (sessionId: string) =>
    (await listAgentSessions()).find((candidate) => candidate.id === sessionId)?.status;

  it("answers two concurrent requests independently, last answer first", async () => {
    const agent = serveFakeAgent(agentSide, [], {
      parallelPermissions: ["Read the base", "List the records"],
    });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    try {
      await startAgentSessionPrompt(session.id, "use two tools at once");
      await vi.waitFor(() => expect(permissionCards(session.id)).toHaveLength(2));
      await vi.waitFor(async () => expect(await statusOf(session.id)).toBe("waiting_permission"));
      const [first, second] = permissionCards(session.id);
      expect(first?.title).toBe("Read the base");
      expect(second?.title).toBe("List the records");
      expect(first?.requestId).not.toBe(second?.requestId);

      // The second card first — the one a single-slot implementation kept.
      respondToAgentPermission(session.id, second?.requestId ?? "missing", "deny");
      await vi.waitFor(() =>
        expect(agent.permissionOutcomes()).toEqual([
          { title: "List the records", outcome: { outcome: "selected", optionId: "deny" } },
        ]),
      );
      // The first is still the human's to answer, so the turn stays paused on it.
      expect(await statusOf(session.id)).toBe("waiting_permission");
      expect(turnStatuses(session.id)).toEqual(["busy", "waiting_permission"]);
      expect(() =>
        respondToAgentPermission(session.id, second?.requestId ?? "missing", "allow"),
      ).toThrow("A different decision was already recorded for this request.");
      expect(() =>
        respondToAgentPermission(session.id, second?.requestId ?? "missing", "deny"),
      ).not.toThrow();
      expect(() => respondToAgentPermission(session.id, "perm_unknown", "allow")).toThrow(
        "This permission request is no longer pending.",
      );

      // The card the old code rejected outright now resolves its own request.
      respondToAgentPermission(session.id, first?.requestId ?? "missing", "allow");
      await vi.waitFor(() =>
        expect(agent.permissionOutcomes()).toEqual([
          { title: "List the records", outcome: { outcome: "selected", optionId: "deny" } },
          { title: "Read the base", outcome: { outcome: "selected", optionId: "allow" } },
        ]),
      );
      await vi.waitFor(async () => expect(await statusOf(session.id)).toBe("idle"));
      expect(turnStatuses(session.id)).toEqual(["busy", "waiting_permission", "busy", "idle"]);
      expect(() =>
        respondToAgentPermission(session.id, first?.requestId ?? "missing", "allow"),
      ).not.toThrow();
      expect(agent.permissionOutcomes()).toHaveLength(2);

      // Client side: each card keeps its own answer, matched by its own id.
      const blocks = reduceAcpEvents(
        [],
        liveSession(session.id).buffer.flatMap(translateAgentSessionEvent),
      );
      expect(
        blocks
          .filter((block) => block.kind === "permission")
          .map((block) => ({ title: block.title, resolution: block.resolution })),
      ).toEqual([
        { title: "Read the base", resolution: { optionId: "allow" } },
        { title: "List the records", resolution: { optionId: "deny" } },
      ]);
    } finally {
      await closeAgentSessions([session.id]);
    }
  });

  it("keeps a single request's behaviour unchanged", async () => {
    const agent = serveFakeAgent(agentSide, [], { requestPermission: true });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    try {
      await startAgentSessionPrompt(session.id, "one tool");
      await vi.waitFor(async () => expect(await statusOf(session.id)).toBe("waiting_permission"));
      const [card] = permissionCards(session.id);
      expect(() => respondToAgentPermission(session.id, "perm_unknown", "allow")).toThrow(
        "This permission request is no longer pending.",
      );
      expect(() =>
        respondToAgentPermission(session.id, card?.requestId ?? "missing", "never-offered"),
      ).toThrow('"never-offered" is not one of the offered options.');

      respondToAgentPermission(session.id, card?.requestId ?? "missing", "allow");
      await vi.waitFor(async () => expect(await statusOf(session.id)).toBe("idle"));
      expect(agent.permissionOutcomes()).toEqual([
        { title: "Run a test command", outcome: { outcome: "selected", optionId: "allow" } },
      ]);
      expect(turnStatuses(session.id)).toEqual(["busy", "waiting_permission", "busy", "idle"]);
      expect(
        liveSession(session.id).buffer.filter((event) => event.kind === "permissionResolved"),
      ).toMatchObject([{ permissionRequestId: card?.requestId, permissionOptionId: "allow" }]);
    } finally {
      await closeAgentSessions([session.id]);
    }
  });

  it("answers every pending request cancelled on session/cancel and ends the turn idle", async () => {
    const agent = serveFakeAgent(agentSide, [], {
      parallelPermissions: ["Read the base", "List the records"],
      cancelFirstPromptOnNotify: true,
    });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    try {
      await startAgentSessionPrompt(session.id, "stop while both cards are up");
      await vi.waitFor(() => expect(permissionCards(session.id)).toHaveLength(2));
      const [first] = permissionCards(session.id);

      await cancelAgentSession(session.id);
      // Both answered; the order their responses reach the agent is not fixed.
      await vi.waitFor(() =>
        expect(
          [...agent.permissionOutcomes()].sort((a, b) => a.title.localeCompare(b.title)),
        ).toEqual([
          { title: "List the records", outcome: { outcome: "cancelled" } },
          { title: "Read the base", outcome: { outcome: "cancelled" } },
        ]),
      );
      await vi.waitFor(async () => expect(await statusOf(session.id)).toBe("idle"));
      // Nobody is asked anymore, so the turn winds down as busy until the
      // agent answers the prompt; no card is published as answered.
      expect(turnStatuses(session.id)).toEqual(["busy", "waiting_permission", "busy", "idle"]);
      expect(
        liveSession(session.id).buffer.some((event) => event.kind === "permissionResolved"),
      ).toBe(false);
      // A card clicked after Stop cannot reopen the finished turn.
      expect(() =>
        respondToAgentPermission(session.id, first?.requestId ?? "missing", "allow"),
      ).toThrow("A different decision was already recorded for this request.");
      expect(await statusOf(session.id)).toBe("idle");
    } finally {
      await closeAgentSessions([session.id]);
    }
  });

  it("settles every parked request when the session closes", async () => {
    serveFakeAgent(agentSide, [], {
      parallelPermissions: ["Read the base", "List the records"],
    });
    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await waitUntilSettled(session.id);

    await startAgentSessionPrompt(session.id, "close while both cards are up");
    await vi.waitFor(() => expect(permissionCards(session.id)).toHaveLength(2));
    const live = liveSession(session.id);
    const settled: acp.RequestPermissionOutcome[] = [];
    for (const entry of live.pendingPermissions.values()) {
      const resolve = entry.resolve;
      entry.resolve = (outcome) => {
        settled.push(outcome);
        resolve(outcome);
      };
    }

    // Not under test here: `close()`'s own fire-and-forget "ended" write is
    // fenced on a `busy` row mid-turn and would reject against this
    // `waiting_permission` one (pre-existing, unrelated to permissions).
    mocks.persistSessionState.mockResolvedValue(true);
    await closeAgentSessions([session.id]);

    expect(settled).toEqual([{ outcome: "cancelled" }, { outcome: "cancelled" }]);
    expect(live.pendingPermissions.size).toBe(0);
    // Teardown is not a human answer: nothing is published as "resolved".
    expect(live.buffer.some((event) => event.kind === "permissionResolved")).toBe(false);
  });
});

describe("database-authoritative session identity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    mocks.storedSessions.length = 0;
    mocks.storedScopes.clear();
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions = new Map();
  });

  it("does not list a live-only session after its durable row was deleted", async () => {
    const live = {
      id: "stale-live",
      spaceId: "space-1",
      actorId: "actor-1",
      slug: "buda:agent-a",
      agentName: "Agent A",
      transport: "remote-websocket",
      status: "idle",
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      modelOption: null,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(live.id, live);

    await runWithBusabaseContext({ spaceId: "space-1", actorId: "actor-1" }, async () => {
      await expect(listAgentSessions()).resolves.toEqual([]);
    });
  });

  it("keeps a terminal database tombstone authoritative over stale live state", async () => {
    const row: AgentSessionVO = {
      id: "ended-remote",
      slug: "buda:agent-a",
      agentName: "Agent A",
      transport: "remote-websocket",
      status: "ended",
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      modelOption: null,
    };
    mocks.storedSessions.push(row);
    mocks.storedScopes.set(row.id, { spaceId: "space-1", actorId: "actor-1" });
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(row.id, {
      ...row,
      spaceId: "space-1",
      actorId: "actor-1",
      status: "idle",
      modelOptionSync: Promise.resolve(),
    });

    await runWithBusabaseContext({ spaceId: "space-1", actorId: "actor-1" }, async () => {
      await expect(listAgentSessions()).resolves.toEqual([row]);
    });

    mocks.loadSessionRuntime.mockImplementation(async (sessionId: string) => {
      if (sessionId !== row.id) return null;
      return {
        session: row,
        acpSessionId: "acp-sess-ended-remote",
        lastEventSeq: 0,
      } satisfies AgentSessionRuntimeRecord;
    });
    mocks.acquireSessionLease.mockResolvedValueOnce(null);

    await runWithBusabaseContext({ spaceId: "space-1", actorId: "actor-1" }, async () => {
      await expect(promptAgentSession(row.id, "too late")).rejects.toThrow(/ended/i);
    });
  });

  it("never starts a process or exposes a session when identity persistence fails", async () => {
    mocks.persistSessionCreated.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(createAgentSession({ slug: "test-agent", spaceId: "space-1" })).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.createWebSocketStream).not.toHaveBeenCalled();
    await runWithBusabaseContext({ spaceId: "space-1" }, async () => {
      await expect(listAgentSessions()).resolves.toEqual([]);
    });
  });
});

describe("remote session worker handoff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStoreMocks();
    (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<string, unknown>;
        __busabaseAgentSessionReattachments?: Map<string, Promise<unknown>>;
      }
    ).__busabaseAgentSessions = new Map();
    (
      globalThis as typeof globalThis & {
        __busabaseAgentSessionReattachments?: Map<string, Promise<unknown>>;
      }
    ).__busabaseAgentSessionReattachments = new Map();
  });

  it("finishes an idle subscription when its owning socket retires without another event", async () => {
    const record = runtimeRecord({ id: "ags-retired-observer" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    await setAgentSessionConfigOption(record.session.id, "model", "fast");
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          { buffer: AgentSessionEventVO[]; listeners: Set<unknown>; detach(): void }
        >;
      }
    ).__busabaseAgentSessions?.get(record.session.id);
    if (!live) throw new Error("Expected live owner");
    const controller = new AbortController();
    const iterator = subscribeAgentSession(
      record.session.id,
      live.buffer.at(-1)?.seq ?? 0,
      controller.signal,
    );
    try {
      const next = iterator.next();
      await vi.waitFor(() => expect(live.listeners.size).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      live.detach();
      await expect(next).resolves.toEqual({ done: true, value: undefined });
    } finally {
      controller.abort();
      await iterator.return(undefined);
      await closeAgentSessions([record.session.id]);
    }
  });

  it("reattaches with session/load and sends the prompt to the preserved inner session", async () => {
    const record = runtimeRecord();
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], {
      loadReplayText: "already persisted remote history",
    });

    await promptAgentSession(record.session.id, "first prompt");

    expect(agent.newSessionCallCount()).toBe(0);
    expect(agent.loadedSessionIds()).toEqual([record.acpSessionId]);
    expect(agent.promptSessionIds()).toEqual([record.acpSessionId]);
    expect(agent.promptTexts()).toEqual(["first prompt"]);
    expect(mocks.persistSessionModelOption).toHaveBeenCalledWith(
      record.session.id,
      expect.objectContaining({ currentValue: "auto" }),
      { spaceId: LOCAL_SPACE_ID, actorId: null },
      expect.objectContaining({ fencingToken: 1 }),
      null,
    );
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
    const persisted = mocks.persistSessionEvents.mock.calls.flatMap(
      ([events]) => events as AgentSessionEventVO[],
    );
    expect(persisted).toContainEqual(
      expect.objectContaining({
        sessionId: record.session.id,
        acpUpdate: expect.objectContaining({
          sessionUpdate: "user_message",
          text: "first prompt",
        }),
      }),
    );
    const userEvent = persisted.find(
      (event) => (event.acpUpdate as { text?: unknown } | undefined)?.text === "first prompt",
    );
    expect(userEvent?.seq).toBeGreaterThan(record.lastEventSeq);
    expect(JSON.stringify(persisted)).not.toContain("already persisted remote history");
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(record.session.id),
    ).toBe(true);

    await closeAgentSession(record.session.id);
    expect(mocks.endRemoteSession).toHaveBeenCalledWith(record.session.id);
  });

  it("retains current commands from session/load without duplicating replayed transcript", async () => {
    const record = runtimeRecord();
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    serveFakeAgent(agentSide, [MODEL_CONFIG], {
      loadAvailableCommands: [
        {
          name: "skill:research-codebase",
          description: "Research before changing code",
          input: { hint: "instructions" },
        },
      ],
      loadReplayText: "already persisted remote history",
    });

    await promptAgentSession(record.session.id, "continue after reconnect");

    const persisted = mocks.persistSessionEvents.mock.calls.flatMap(
      ([events]) => events as AgentSessionEventVO[],
    );
    const commandEvent = persisted.find(
      (event) =>
        (event.acpUpdate as { sessionUpdate?: string } | undefined)?.sessionUpdate ===
        "available_commands_update",
    );
    expect(commandEvent).toBeDefined();
    expect(JSON.stringify(persisted)).not.toContain("already persisted remote history");

    const uiEvents = persisted.flatMap((event) => translateAgentSessionEvent(event));
    expect(foldAvailableCommands(uiEvents)).toEqual([
      {
        name: "skill:research-codebase",
        description: "Research before changing code",
        input: { hint: "instructions" },
      },
    ]);
    expect(JSON.stringify(reduceAcpEvents([], uiEvents))).not.toContain(
      "already persisted remote history",
    );

    await closeAgentSession(record.session.id);
  });

  it(
    "reaches session/cancel for a remote-websocket session with no live copy on this " +
      "worker, without claiming the operation lease",
    async () => {
      // A record marked "busy" simulates the ordinary shape of an in-flight
      // turn that another worker's process is actually awaiting — this
      // worker never touched `sessions()` for it at all, which is exactly
      // what "the worker serving Stop isn't the worker holding the prompt"
      // looks like from here. `requireLocalSession` alone would reject this
      // immediately; `cancelAgentSession` must instead open a lightweight ACP
      // connection using the durable inner session id.
      const record = runtimeRecord({ status: "busy" });
      mocks.loadSessionRuntime.mockResolvedValue(record);
      const [clientSide, agentSide] = linkedStreams();
      mocks.createWebSocketStream.mockReturnValue(clientSide);
      const agent = serveFakeAgent(agentSide, []);

      await cancelAgentSession(record.session.id);

      // The cancel notify reached the agent without `session/load`. Loading
      // may wait behind the active prompt and defeat the whole point of Stop;
      // ACP cancellation only needs the durable session id.
      expect(agent.initializeCallCount()).toBe(1);
      expect(agent.loadedSessionIds()).toEqual([]);
      expect(agent.cancelledSessionIds()).toEqual([record.acpSessionId]);
      // Cancel is not a new operation competing for the single-turn slot —
      // it must never take the durable lease the way `promptAgentSession`
      // does, or it would race the worker that is genuinely mid-prompt.
      expect(mocks.acquireSessionLease).not.toHaveBeenCalled();
      expect(mocks.releaseSessionLease).not.toHaveBeenCalled();

      // The lightweight connection opened only to deliver the cancel must
      // never create a LiveSession in this worker's map.
      expect(
        (
          globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
        ).__busabaseAgentSessions?.has(record.session.id),
      ).toBe(false);
    },
  );

  it("rejects a terminal remote session without opening a cancel connection", async () => {
    const record = runtimeRecord({ id: "ags-ended-cancel", status: "ended" }, null);
    mocks.loadSessionRuntime.mockResolvedValue(record);

    await expect(cancelAgentSession(record.session.id)).rejects.toMatchObject({
      name: AgentSessionTerminalError.name,
      status: "ended",
      promptRecorded: false,
    });
    expect(mocks.createWebSocketStream).not.toHaveBeenCalled();
    expect(mocks.acquireSessionLease).not.toHaveBeenCalled();
  });

  it("shares one in-process reattachment across concurrent prompt requests", async () => {
    const record = runtimeRecord();
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const acquire = mocks.acquireSessionLease.getMockImplementation();
    mocks.acquireSessionLease
      .mockImplementationOnce(acquire as (...args: unknown[]) => unknown)
      .mockResolvedValueOnce(null);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, []);

    const outcomes = await Promise.allSettled([
      promptAgentSession(record.session.id, "first"),
      promptAgentSession(record.session.id, "second"),
    ]);

    expect(agent.loadedSessionIds()).toEqual([record.acpSessionId]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(agent.promptTexts()).toHaveLength(1);

    await closeAgentSessions([record.session.id]);
  });

  it("does not echo or send when another worker already claimed the prompt slot", async () => {
    const record = runtimeRecord({ id: "ags-already-claimed" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.acquireSessionLease.mockResolvedValue(null);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, []);

    await expect(promptAgentSession(record.session.id, "duplicate turn")).rejects.toThrow(
      /still replying/i,
    );

    expect(agent.loadedSessionIds()).toEqual([]);
    expect(agent.promptTexts()).toEqual([]);
    expect(mocks.persistSessionEvents).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          acpUpdate: expect.objectContaining({ text: "duplicate turn" }),
        }),
      ]),
    );

    await closeAgentSessions([record.session.id]);
  });

  it("releases the durable claim when the post-claim runtime read fails", async () => {
    const record = runtimeRecord({ id: "ags-claim-read-fails" });
    mocks.loadSessionRuntime.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, []);

    await expect(promptAgentSession(record.session.id, "retry me")).rejects.toThrow(
      `Unknown agent session: ${record.session.id}`,
    );

    expect(mocks.releaseSessionLease).toHaveBeenCalledWith(
      record.session.id,
      expect.any(String),
      1,
      { spaceId: LOCAL_SPACE_ID, actorId: null },
    );
    expect(agent.promptTexts()).toEqual([]);
  });

  it("releases the durable claim when the remote transcript cannot be persisted", async () => {
    const record = runtimeRecord({ id: "ags-event-write-fails" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.persistSessionEvents.mockResolvedValueOnce(false);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, []);

    await expect(promptAgentSession(record.session.id, "keep durable")).rejects.toThrow(
      /could not persist/i,
    );

    expect(mocks.releaseSessionLease).toHaveBeenCalledWith(
      record.session.id,
      expect.any(String),
      1,
      { spaceId: LOCAL_SPACE_ID, actorId: null },
    );
    expect(agent.promptTexts()).toEqual([]);
  });

  it("streams the first remote chunk before the prompt resolves and does not replay it twice", async () => {
    const record = runtimeRecord({ id: "ags-live-stream" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishPrompt: (() => void) | undefined;
    const promptGate = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], {
      promptChunkText: "first live chunk",
      promptGate,
    });

    // Reattach first, then subscribe before the prompt starts. This proves the
    // chunk reaches an already-listening owner rather than merely being replayed
    // from the in-memory buffer after it arrived.
    await setAgentSessionConfigOption(record.session.id, "model", "fast");
    const ownerSubscription = subscribeAgentSession(
      record.session.id,
      record.lastEventSeq,
      new AbortController().signal,
    );
    const liveChunk = (async () => {
      while (true) {
        const next = await ownerSubscription.next();
        if (next.done) throw new Error("owner subscription ended before the first chunk");
        if (
          (next.value.acpUpdate as { sessionUpdate?: unknown } | undefined)?.sessionUpdate ===
          "agent_message_chunk"
        ) {
          return next;
        }
      }
    })();

    let promptResolved = false;
    const prompt = promptAgentSession(record.session.id, "stream this").then(() => {
      promptResolved = true;
    });
    await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["stream this"]));
    const firstChunk = await liveChunk;
    expect(firstChunk.value).toMatchObject({
      kind: "acpUpdate",
      acpUpdate: {
        sessionUpdate: "agent_message_chunk",
        content: { text: "first live chunk" },
      },
    });
    expect(promptResolved).toBe(false);

    finishPrompt?.();
    await prompt;
    const chunkSeq = firstChunk.value?.seq ?? -1;
    const durable = mocks.persistSessionEvents.mock.calls.flatMap(
      ([events]) => events as AgentSessionEventVO[],
    );
    expect(
      durable.filter(
        (event) =>
          (event.acpUpdate as { sessionUpdate?: unknown } | undefined)?.sessionUpdate ===
          "agent_message_chunk",
      ),
    ).toHaveLength(1);

    await ownerSubscription.return(undefined);
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.delete(record.session.id);
    mocks.loadSessionEvents.mockImplementation(async (_sessionId: string, afterSeq: number) =>
      durable.filter((event) => event.seq > afterSeq),
    );
    const controller = new AbortController();
    const replay = subscribeAgentSession(record.session.id, chunkSeq, controller.signal);
    await expect(replay.next()).resolves.toMatchObject({
      value: {
        kind: "acpExtension",
        acpExtension: {
          method: "_acp-ui/lifecycle",
          params: { event: { type: "turn_finished", stopReason: "end_turn" } },
        },
      },
      done: false,
    });
    await expect(replay.next()).resolves.toMatchObject({
      value: { kind: "status", status: "idle" },
      done: false,
    });
    const afterIdle = replay.next();
    setTimeout(() => controller.abort(), 10);
    await expect(afterIdle).resolves.toEqual({ value: undefined, done: true });
  });

  it("does not let a delayed startup idle write clear the first prompt lease", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [], { promptChunkText: "race survived" });
    let releaseStartupFlush: (() => void) | undefined;
    const startupFlush = new Promise<void>((resolve) => {
      releaseStartupFlush = resolve;
    });
    let eventWriteCount = 0;
    mocks.persistSessionEvents.mockImplementation(async (events, fence) => {
      eventWriteCount += 1;
      if (eventWriteCount === 1) await startupFlush;
      const stored = mocks.storedSessions.find((session) => session.id === events[0]?.sessionId);
      return !fence || stored?.status === "busy";
    });

    const session = await createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID });
    await vi.waitFor(() => expect(mocks.persistSessionEvents).toHaveBeenCalledTimes(1));
    const prompt = promptAgentSession(session.id, "win the startup race");
    await vi.waitFor(() => expect(mocks.acquireSessionLease).toHaveBeenCalled());
    releaseStartupFlush?.();

    await expect(prompt).resolves.toBeUndefined();
    expect(agent.promptTexts()).toEqual(["win the startup race"]);
    const startupIdleWrite = mocks.persistSessionState.mock.calls.find(
      ([update, , options]) =>
        update.status === "idle" && options?.expectedStatuses?.includes("connecting"),
    );
    expect(startupIdleWrite?.[4]).toBeUndefined();
    await closeAgentSessions([session.id]);
  });

  it("does not revive a failed pre-send user message on the next prompt", async () => {
    const record = runtimeRecord({ id: "ags-persist-retry" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, []);
    const durable: AgentSessionEventVO[] = [];
    let attempt = 0;
    mocks.persistSessionEvents.mockImplementation(async (events: AgentSessionEventVO[]) => {
      attempt += 1;
      if (attempt === 1) return false;
      durable.push(...events);
      return true;
    });

    await expect(promptAgentSession(record.session.id, "never sent")).rejects.toThrow(
      /could not persist/i,
    );
    await promptAgentSession(record.session.id, "send once");

    expect(agent.promptTexts()).toEqual(["send once"]);
    expect(JSON.stringify(durable)).not.toContain("never sent");
    expect(JSON.stringify(durable)).toContain("send once");
    expect(
      durable.filter(
        (event) =>
          (event.acpUpdate as { sessionUpdate?: unknown } | undefined)?.sessionUpdate ===
          "user_message",
      ),
    ).toHaveLength(1);

    await closeAgentSessions([record.session.id]);
  });

  it("evicts the live remote socket when heartbeat renewal loses the lease", async () => {
    const record = runtimeRecord({ id: "ags-lost-heartbeat" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.sessionLeaseTtlSeconds = 1;
    mocks.renewSessionLease.mockResolvedValue(true);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishPrompt: (() => void) | undefined;
    const promptGate = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [], { promptGate });

    const prompt = promptAgentSession(record.session.id, "hold the lease").catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["hold the lease"]));
    mocks.renewSessionLease.mockResolvedValue(false);
    await vi.waitFor(
      () => {
        expect(mocks.renewSessionLease).toHaveBeenCalled();
        expect(
          (
            globalThis as typeof globalThis & {
              __busabaseAgentSessions?: Map<string, unknown>;
            }
          ).__busabaseAgentSessions?.has(record.session.id),
        ).toBe(false);
      },
      { timeout: 2_000 },
    );

    finishPrompt?.();
    await prompt;
  });

  it("renews immediately and throughout initialize before sending a reattached prompt", async () => {
    const record = runtimeRecord({ id: "ags-slow-startup" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.sessionLeaseTtlSeconds = 1;
    let finishInitialize = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [], { initializeGate });
    const completion = promptAgentSession(record.session.id, "after startup");
    await vi.waitFor(() =>
      expect(mocks.renewSessionLease.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(agent.promptTexts()).toEqual([]);
    expect(mocks.releaseSessionLease).not.toHaveBeenCalled();
    expect(mocks.renewSessionLease).toHaveBeenCalledWith(
      record.session.id,
      mocks.acquireSessionLease.mock.calls[0]?.[1],
      1,
      1,
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: null,
      },
    );
    finishInitialize();
    await completion;
    expect(agent.promptTexts()).toEqual(["after startup"]);
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
    await closeAgentSessions([record.session.id]);
  });

  it("never sends a prompt after losing the lease during initialize", async () => {
    const record = runtimeRecord({ id: "ags-startup-loss" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.sessionLeaseTtlSeconds = 1;
    mocks.renewSessionLease.mockResolvedValueOnce(true).mockResolvedValue(false);
    let finishInitialize = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [], { initializeGate });
    const completion = promptAgentSession(record.session.id, "must not send").catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(mocks.renewSessionLease).toHaveBeenCalledTimes(2));
    finishInitialize();
    expect(await completion).toBeInstanceOf(Error);
    expect(agent.promptTexts()).toEqual([]);
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(record.session.id),
    ).toBe(false);
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
  });

  it("does not restore a lease lost while the post-claim runtime read was pending", async () => {
    const record = runtimeRecord({ id: "ags-delayed-claim-read" });
    let finishRead = () => {};
    const readGate = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    mocks.loadSessionRuntime.mockResolvedValueOnce(record).mockImplementationOnce(async () => {
      await readGate;
      return record;
    });
    mocks.renewSessionLease.mockResolvedValue(false);
    const completion = promptAgentSession(record.session.id, "must not reconnect").catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(mocks.renewSessionLease).toHaveBeenCalledOnce());
    finishRead();
    expect(await completion).toBeInstanceOf(Error);
    expect(mocks.createWebSocketStream).not.toHaveBeenCalled();
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
  });

  it("renews configuration startup and prevents dispatch after losing its lease", async () => {
    const record = runtimeRecord({
      id: "ags-config-startup-loss",
      modelOption: {
        id: "model",
        name: "Model",
        currentValue: "auto",
        options: [{ value: "auto", name: "Auto" }],
      },
    });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.sessionLeaseTtlSeconds = 1;
    mocks.renewSessionLease.mockResolvedValueOnce(true).mockResolvedValue(false);
    let finishInitialize = () => {};
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], { initializeGate });
    const completion = setAgentSessionConfigOption(record.session.id, "model", "auto").catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(mocks.renewSessionLease).toHaveBeenCalledTimes(2));
    finishInitialize();
    expect(await completion).toBeInstanceOf(Error);
    expect(agent.setConfigCallCount()).toBe(0);
    expect(mocks.releaseSessionLease).toHaveBeenCalledOnce();
  });

  it("uses a fresh guard when a retained remote socket runs another operation", async () => {
    const record = runtimeRecord({ id: "ags-reused-operation-guard" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    await promptAgentSession(record.session.id, "first guard");
    await promptAgentSession(record.session.id, "second guard");
    expect(agent.promptTexts()).toEqual(["first guard", "second guard"]);
    expect(mocks.createWebSocketStream).toHaveBeenCalledOnce();
    expect(mocks.releaseSessionLease).toHaveBeenCalledTimes(2);
    expect(mocks.acquireSessionLease.mock.calls[0]?.[1]).not.toBe(
      mocks.acquireSessionLease.mock.calls[1]?.[1],
    );
    await closeAgentSessions([record.session.id]);
  });

  it("shares the operation guard with ACP callbacks created by another module instance", async () => {
    const record = runtimeRecord({
      id: "ags-cross-module-guard",
      modelOption: {
        id: "model",
        name: "Model",
        currentValue: "auto",
        options: [
          { value: "auto", name: "Auto" },
          { value: "fast", name: "Fast" },
        ],
      },
    });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    let token = 0;
    mocks.acquireSessionLease.mockImplementation(async (sessionId: string, ownerId: string) => ({
      sessionId,
      ownerId,
      fencingToken: ++token,
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    }));
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    await promptAgentSession(record.session.id, "module A");
    vi.resetModules();
    const managerB = await import("./agent-session-manager");
    const renewalsBefore = mocks.renewSessionLease.mock.calls.length;
    await managerB.promptAgentSession(record.session.id, "module B");
    await managerB.setAgentSessionConfigOption(record.session.id, "model", "fast");
    expect(agent.promptTexts()).toEqual(["module A", "module B"]);
    expect(agent.setConfigCallCount()).toBe(1);
    expect(mocks.createWebSocketStream).toHaveBeenCalledOnce();
    expect(mocks.renewSessionLease.mock.calls.length - renewalsBefore).toBeGreaterThanOrEqual(4);
    const ownerA = mocks.acquireSessionLease.mock.calls[0]?.[1];
    const ownerB = mocks.acquireSessionLease.mock.calls[1]?.[1];
    const configOwnerB = mocks.acquireSessionLease.mock.calls[2]?.[1];
    expect(ownerB).not.toBe(ownerA);
    expect(mocks.renewSessionLease.mock.calls.filter((call) => call[1] === ownerB)).toEqual([
      [record.session.id, ownerB, 2, 45, { spaceId: LOCAL_SPACE_ID, actorId: null }],
      [record.session.id, ownerB, 2, 45, { spaceId: LOCAL_SPACE_ID, actorId: null }],
    ]);
    expect(mocks.renewSessionLease.mock.calls.filter((call) => call[1] === configOwnerB)).toEqual([
      [record.session.id, configOwnerB, 3, 45, { spaceId: LOCAL_SPACE_ID, actorId: null }],
      [record.session.id, configOwnerB, 3, 45, { spaceId: LOCAL_SPACE_ID, actorId: null }],
    ]);
    expect(mocks.releaseSessionLease).toHaveBeenCalledTimes(3);
    await managerB.closeAgentSessions([record.session.id]);
  });

  it.each(["prompt", "config"] as const)(
    "rejects cross-module %s dispatch when the dispatch-time renewal detects takeover",
    async (operation) => {
      const record = runtimeRecord({
        id: `ags-cross-module-${operation}-loss`,
        modelOption: {
          id: "model",
          name: "Model",
          currentValue: "auto",
          options: [
            { value: "auto", name: "Auto" },
            { value: "fast", name: "Fast" },
          ],
        },
      });
      mocks.loadSessionRuntime.mockResolvedValue(record);
      const [clientSide, agentSide] = linkedStreams();
      mocks.createWebSocketStream.mockReturnValue(clientSide);
      const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
      await promptAgentSession(record.session.id, "establish module A socket");
      vi.resetModules();
      const managerB = await import("./agent-session-manager");
      mocks.renewSessionLease.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const completion =
        operation === "prompt"
          ? managerB.promptAgentSession(record.session.id, "must not dispatch")
          : managerB.setAgentSessionConfigOption(record.session.id, "model", "fast");
      await expect(completion).rejects.toThrow(/lost the agent session lease/i);
      expect(agent.promptTexts()).toEqual(["establish module A socket"]);
      expect(agent.setConfigCallCount()).toBe(0);
      expect(mocks.releaseSessionLease).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed when retained remote ACP callbacks have a lease but no guard", async () => {
    const record = runtimeRecord({ id: "ags-missing-dispatch-guard" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    await promptAgentSession(record.session.id, "establish callback");
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          {
            lease: unknown;
            operationGuard?: unknown;
            prompt: (text: string) => Promise<void>;
            setConfigOption: (configId: string, value: string) => Promise<unknown>;
          }
        >;
      }
    ).__busabaseAgentSessions?.get(record.session.id);
    if (!live) throw new Error("Expected retained remote session");
    live.lease = {
      sessionId: record.session.id,
      ownerId: "missing-guard",
      fencingToken: 10,
      expiresAt: new Date().toISOString(),
    };
    live.operationGuard = null;
    await expect(live.prompt("must not dispatch")).rejects.toThrow(/lost the agent session lease/i);
    await expect(live.setConfigOption("model", "fast")).rejects.toThrow(
      /lost the agent session lease/i,
    );
    expect(agent.promptTexts()).toEqual(["establish callback"]);
    expect(agent.setConfigCallCount()).toBe(0);
    live.lease = null;
    await closeAgentSessions([record.session.id]);
  });

  it("does not remove a replacement guard when an older module's operation cleans up", async () => {
    const record = runtimeRecord({ id: "ags-cross-module-replaced-guard" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishPrompt = () => {};
    const promptGate = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], { promptGate });
    const completion = promptAgentSession(record.session.id, "old operation").catch(
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(agent.promptTexts()).toEqual(["old operation"]));
    vi.resetModules();
    await import("./agent-session-manager");
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          {
            lease: unknown;
            operationGuard?: unknown;
          }
        >;
      }
    ).__busabaseAgentSessions?.get(record.session.id);
    if (!live) throw new Error("Expected active remote session");
    const replacementLease = {
      sessionId: record.session.id,
      ownerId: "replacement-owner",
      fencingToken: 10,
      expiresAt: new Date().toISOString(),
    };
    const replacementGuard = {
      lease: replacementLease,
      scope: { spaceId: LOCAL_SPACE_ID, actorId: null },
      assertOwned: () => {},
      ready: async () => {},
      release: async () => {},
    };
    live.lease = replacementLease;
    live.operationGuard = replacementGuard;
    finishPrompt();
    expect(await completion).toBeInstanceOf(Error);
    expect(live.operationGuard).toBe(replacementGuard);
    expect(live.lease).toBe(replacementLease);
    live.operationGuard = null;
    live.lease = null;
    await closeAgentSessions([record.session.id]);
  });

  it("does not reattach local, terminal, missing, or inner-id-less sessions", async () => {
    const local = runtimeRecord({ transport: "local-subprocess" });
    mocks.loadSessionRuntime.mockResolvedValueOnce(local);
    await expect(promptAgentSession(local.session.id, "local")).rejects.toThrow(
      `Unknown agent session: ${local.session.id}`,
    );

    const terminal = runtimeRecord({ id: "ags-ended", status: "ended" });
    mocks.loadSessionRuntime.mockResolvedValue(terminal);
    mocks.acquireSessionLease.mockResolvedValueOnce(null);
    await expect(promptAgentSession(terminal.session.id, "ended")).rejects.toMatchObject({
      name: AgentSessionTerminalError.name,
      status: "ended",
      promptRecorded: false,
    });

    const withoutInnerId = runtimeRecord({ id: "ags-no-inner" }, null);
    mocks.loadSessionRuntime.mockResolvedValueOnce(withoutInnerId);
    await expect(promptAgentSession(withoutInnerId.session.id, "not ready")).rejects.toThrow(
      /still starting/i,
    );

    mocks.loadSessionRuntime.mockResolvedValueOnce(null);
    await expect(promptAgentSession("ags-other-actor", "private")).rejects.toThrow(
      "Unknown agent session: ags-other-actor",
    );
    expect(mocks.createWebSocketStream).not.toHaveBeenCalled();
  });

  it("keeps a failed session/load retryable and removes the partial live entry", async () => {
    const record = runtimeRecord({ id: "ags-load-fails" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    serveFakeAgent(agentSide, [], { loadError: new Error("remote session no longer exists") });

    await expect(promptAgentSession(record.session.id, "hello")).rejects.toThrow(
      "remote session no longer exists",
    );
    expect(
      (
        globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
      ).__busabaseAgentSessions?.has(record.session.id),
    ).toBe(false);
    expect(mocks.persistSessionState).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: record.session.id, status: "failed" }),
      record.acpSessionId,
      expect.anything(),
    );
  });

  it("does not call session/load when the agent does not advertise it", async () => {
    const record = runtimeRecord({ id: "ags-no-load" });
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [], { loadSessionSupported: false });

    await expect(promptAgentSession(record.session.id, "hello")).rejects.toThrow(
      /does not support reopening/i,
    );
    expect(agent.loadedSessionIds()).toEqual([]);
    expect(agent.promptTexts()).toEqual([]);
  });

  it("does not open an ACP socket when initial identity persistence fails", async () => {
    mocks.persistSessionCreated.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      createAgentSession({ slug: "test-agent", spaceId: LOCAL_SPACE_ID }),
    ).rejects.toThrow("database unavailable");
    expect(mocks.createWebSocketStream).not.toHaveBeenCalled();
  });

  it("polls durable events when the subscription lands on a non-owner worker", async () => {
    const record = runtimeRecord({ id: "ags-polled" });
    const event: AgentSessionEventVO = {
      sessionId: record.session.id,
      seq: 5,
      kind: "acpUpdate",
      acpUpdate: { sessionUpdate: "agent_message_chunk", text: "from owner worker" },
      at: new Date().toISOString(),
    };
    mocks.loadSessionRuntime.mockResolvedValue(record);
    mocks.loadSessionEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([event])
      .mockResolvedValue([]);
    const controller = new AbortController();
    const subscription = subscribeAgentSession(record.session.id, 4, controller.signal);

    await expect(subscription.next()).resolves.toEqual({ value: event, done: false });
    expect(mocks.loadSessionEvents).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(subscription.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
