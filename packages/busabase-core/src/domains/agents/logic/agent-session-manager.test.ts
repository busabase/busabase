import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionEventVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getContextActorId,
  getContextSpaceId,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
} from "../../../context";
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
  // Backing store for `loadSessions()` — kept alongside the PUL-223 harness
  // above because "database-authoritative session identity" pushes rows
  // directly and asserts `listAgentSessions()` surfaces them, independent of
  // the reattachment-focused `loadSessionRuntime` mock.
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

const {
  cancelAgentSession,
  AgentSessionTerminalError,
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

const resetStoreMocks = () => {
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
    async (sessionId: string, modelOption: AgentSessionVO["modelOption"]) => {
      const session = scopedSession(sessionId);
      // Handoff tests supply an existing durable row through
      // `loadSessionRuntime` without duplicating it in `storedSessions`.
      if (!session) return true;
      if (session.transport !== "remote-websocket") return false;
      if (session.status === "ended" || session.status === "failed") return false;
      session.modelOption = modelOption;
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
    if (stored) stored.status = "idle";
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
  initialConfigOptions: acp.SessionConfigOption[],
  options?: {
    initializeGate?: Promise<void>;
    loadError?: Error;
    loadReplayText?: string;
    loadSessionSupported?: boolean;
    promptChunkText?: string;
    promptGate?: Promise<void>;
    requestPermission?: boolean;
    /**
     * When set, the fake agent does not resolve `session/prompt` on its own —
     * it waits for `session/cancel` and then resolves the *original* pending
     * prompt request with `stopReason: "cancelled"`, per ACP's cancellation
     * contract (the client must not treat the turn as over from the
     * notification alone).
     */
    cancelFirstPromptOnNotify?: boolean;
    cancelResponseGate?: Promise<void>;
  },
) {
  let configOptions = initialConfigOptions;
  let newSessionCalls = 0;
  let setConfigCalls = 0;
  const loadedSessionIds: string[] = [];
  const promptTexts: string[] = [];
  const promptSessionIds: string[] = [];
  const cancelledSessionIds: string[] = [];
  const cancelledRequestSessionIds: string[] = [];
  const cancelWaiters = new Map<string, () => void>();
  let connected: acp.AgentContext | undefined;
  const ready = new Promise<void>((resolve) => {
    acp
      .agent()
      .onRequest(acp.methods.agent.initialize, async () => {
        await options?.initializeGate;
        return {
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: { loadSession: options?.loadSessionSupported !== false },
        };
      })
      .onRequest(acp.methods.agent.session.new, async () => {
        newSessionCalls += 1;
        return { sessionId: "acp-sess-1", configOptions };
      })
      .onRequest(acp.methods.agent.session.load, async (ctx) => {
        loadedSessionIds.push(ctx.params.sessionId);
        if (options?.loadError) throw options.loadError;
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
        promptSessionIds.push(ctx.params.sessionId);
        const text = ctx.params.prompt.find((block) => block.type === "text");
        if (text?.type === "text") promptTexts.push(text.text);
        if (options?.requestPermission) {
          await ctx.client.request(acp.methods.client.session.requestPermission, {
            sessionId: ctx.params.sessionId,
            toolCall: {
              toolCallId: "tc-test-permission",
              title: "Run a test command",
              kind: "execute",
              status: "pending",
            },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "deny", name: "Deny", kind: "reject_once" },
            ],
          });
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
          return { stopReason: "cancelled" as const };
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
        configOptions = configOptions.map((option) => {
          if (option.id !== ctx.params.configId || option.type !== "select") return option;
          if (!("value" in ctx.params) || typeof ctx.params.value !== "string") return option;
          return { ...option, currentValue: ctx.params.value };
        });
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
    loadedSessionIds: () => loadedSessionIds,
    newSessionCallCount: () => newSessionCalls,
    promptSessionIds: () => promptSessionIds,
    setConfigCallCount: () => setConfigCalls,
    promptTexts: () => promptTexts,
    cancelledSessionIds: () => cancelledSessionIds,
    cancelledRequestSessionIds: () => cancelledRequestSessionIds,
    setConfigOptionsSilently: (nextConfigOptions: acp.SessionConfigOption[]) => {
      configOptions = nextConfigOptions;
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
    expect(mocks.releaseSessionLease).not.toHaveBeenCalled();

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

  it("does not emit a note when the agent lacks HTTP MCP support (PUL-214)", async () => {
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
    expect(mocks.releaseSessionLease).not.toHaveBeenCalled();
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
   * PUL-246 regression: before the durable mirror, `listAgentSessions` and
   * `listAgentSessionsPaged` could only recover `modelOption` from THIS
   * process's in-memory `sessions()` map. A `remote-websocket` session can be
   * reattached from any worker (PUL-223), so a list request served by a
   * worker that never held the live socket — simulated here by deleting the
   * entry from `__busabaseAgentSessions`, the same technique the
   * live-session-ownership tests below use — saw the same durable row with
   * `modelOption: null` even though the agent had already advertised one.
   * That is exactly the "intermittent" symptom: whichever worker happens to
   * answer the request decides whether the picker renders.
   */
  it("surfaces the durable model option to a worker with no live copy of the session (PUL-246)", async () => {
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

  it("keeps the durable model option authoritative over a stale live socket (PUL-246)", async () => {
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
      pendingPermission: null,
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
      pendingPermission: null,
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
      pendingPermission: null,
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
            { buffer: AgentSessionEventVO[]; pendingPermission: unknown }
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
      pendingPermission: null,
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
      pendingPermission: null,
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

describe("cancelAgentSession (PUL-244)", () => {
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

  it("cancels a prompt waiting for ACP readiness and keeps the session usable (PUL-250)", async () => {
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

  it("reattaches with session/load and sends the prompt to the preserved inner session", async () => {
    const record = runtimeRecord();
    mocks.loadSessionRuntime.mockResolvedValue(record);
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG], {
      loadReplayText: "already persisted remote history",
    });

    await promptAgentSession(record.session.id, "PUL-223 first prompt");

    expect(agent.newSessionCallCount()).toBe(0);
    expect(agent.loadedSessionIds()).toEqual([record.acpSessionId]);
    expect(agent.promptSessionIds()).toEqual([record.acpSessionId]);
    expect(agent.promptTexts()).toEqual(["PUL-223 first prompt"]);
    expect(mocks.persistSessionModelOption).toHaveBeenCalledWith(
      record.session.id,
      expect.objectContaining({ currentValue: "auto" }),
      { spaceId: LOCAL_SPACE_ID, actorId: null },
      expect.objectContaining({ fencingToken: 1 }),
    );
    expect(mocks.releaseSessionLease).not.toHaveBeenCalled();
    const persisted = mocks.persistSessionEvents.mock.calls.flatMap(
      ([events]) => events as AgentSessionEventVO[],
    );
    expect(persisted).toContainEqual(
      expect.objectContaining({
        sessionId: record.session.id,
        acpUpdate: expect.objectContaining({
          sessionUpdate: "user_message",
          text: "PUL-223 first prompt",
        }),
      }),
    );
    const userEvent = persisted.find(
      (event) =>
        (event.acpUpdate as { text?: unknown } | undefined)?.text === "PUL-223 first prompt",
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

  it("shares one in-process reattachment across concurrent prompt requests", async () => {
    const record = runtimeRecord();
    mocks.loadSessionRuntime.mockResolvedValue(record);
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
    mocks.renewSessionLease.mockResolvedValue(false);
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
