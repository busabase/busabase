import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Model-config-option coverage for the session manager, driven over a real
 * ACP client/agent pair — the same in-process approach
 * `acp-agent-implementation.test.ts` (apps/buda) uses, minus the HTTP
 * transport that test's server-side role needs and this domain's
 * `remote-websocket` launches don't: two `Stream`s built directly from
 * `TransformStream`s stand in for `createWebSocketStream`, so no bytes, JSON
 * framing, or real socket are involved.
 *
 * Persistence, the workspace directory, and the MCP URL are mocked — this
 * suite is about the ACP `configOptions` contract, not disk or the database.
 */

const mocks = vi.hoisted(() => ({
  createWebSocketStream: vi.fn<() => Stream>(),
  persistSessionEvents: vi.fn(),
}));

vi.mock("./agent-session-store", () => ({
  persistSessionCreated: async () => {},
  persistSessionState: async () => {},
  persistSessionEvents: mocks.persistSessionEvents,
  loadSessions: async () => [],
  loadSessionEvents: async () => [],
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
  AgentSessionTerminalError,
  createAgentSession,
  setAgentSessionConfigOption,
  closeAgentSessions,
  listAgentSessions,
  promptAgentSession,
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

/** Runs a scripted fake agent over one side of a linked stream pair. */
function serveFakeAgent(
  stream: Stream,
  initialConfigOptions: acp.SessionConfigOption[],
  options?: { initializeGate?: Promise<void> },
) {
  let configOptions = initialConfigOptions;
  let setConfigCalls = 0;
  const promptTexts: string[] = [];
  let connected: acp.AgentContext | undefined;
  const ready = new Promise<void>((resolve) => {
    acp
      .agent()
      .onRequest(acp.methods.agent.initialize, async () => {
        await options?.initializeGate;
        return {
          protocolVersion: acp.PROTOCOL_VERSION,
          agentCapabilities: {},
        };
      })
      .onRequest(acp.methods.agent.session.new, async () => ({
        sessionId: "acp-sess-1",
        configOptions,
      }))
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        const text = ctx.params.prompt.find((block) => block.type === "text");
        if (text?.type === "text") promptTexts.push(text.text);
        return { stopReason: "end_turn" as const };
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
    setConfigCallCount: () => setConfigCalls,
    promptTexts: () => promptTexts,
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
    const [clientSide, side] = linkedStreams();
    agentSide = side;
    mocks.createWebSocketStream.mockReturnValue(clientSide);
  });

  it("stores the advertised model option from session/new and surfaces it on the VO", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });

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

  it("leaves modelOption null when the agent advertises no model select", async () => {
    serveFakeAgent(agentSide, []);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });

    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption).toBeNull();

    await closeAgentSessions([session.id]);
  });

  it("does not emit a note when the agent lacks HTTP MCP support (PUL-214)", async () => {
    // `serveFakeAgent`'s `initialize` responds with `agentCapabilities: {}` —
    // no `mcpCapabilities.http` — so this exercises the exact branch that
    // used to synthesize the "does not support HTTP MCP servers" note.
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });
    await waitUntilSettled(session.id);

    const events = [];
    for await (const event of subscribeAgentSession(session.id, -1)) {
      events.push(event);
      if (event.kind === "status" && event.status === "idle") break;
    }
    const noteTexts = events
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
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });

    const settled = await waitUntilSettled(session.id);
    expect(settled.modelOption?.id).toBe("model");

    await closeAgentSessions([session.id]);
  });

  it("rejects a value the agent never advertised, without sending it over ACP", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });
    await waitUntilSettled(session.id);

    await expect(
      setAgentSessionConfigOption(session.id, "model", "not-a-real-model"),
    ).rejects.toThrow(/not one of the offered options/i);
    expect(agent.setConfigCallCount()).toBe(0);

    await closeAgentSessions([session.id]);
  });

  it("replaces the local option from the complete session/set_config_option response", async () => {
    serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });
    await waitUntilSettled(session.id);

    const updated = await setAgentSessionConfigOption(session.id, "model", "fast");
    expect(updated.modelOption?.currentValue).toBe("fast");

    await closeAgentSessions([session.id]);
  });

  it("refreshes the local option from an unprompted config_option_update notification", async () => {
    const agent = serveFakeAgent(agentSide, [MODEL_CONFIG]);
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });
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
});

describe("promptAgentSession", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.persistSessionEvents.mockResolvedValue(undefined);
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
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess",
      status: "connecting",
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready,
      promptStarting: false,
      prompt,
      cancel: vi.fn(),
      close: vi.fn(),
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
      buffer: [],
      listeners: new Set([listener]),
      pendingPermission: null,
      permissionCounter: 0,
    };
    (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions?.set(session.id, session);

    const result = promptAgentSession(session.id, "hello while starting");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      kind: "acpUpdate",
      acpUpdate: { sessionUpdate: "user_message", text: "hello while starting" },
    });
    await vi.waitFor(() => expect(mocks.persistSessionEvents).toHaveBeenCalledTimes(1));
    expect(prompt).not.toHaveBeenCalled();

    resolveReady?.();
    await result;
    expect(prompt).toHaveBeenCalledWith("hello while starting", undefined);
  });

  it("marks a terminal rejection before echo as safe for continuation", async () => {
    const session = {
      id: "session-terminal-before-echo",
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess",
      status: "failed",
      error: "ACP connection closed",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready: Promise.resolve(),
      promptStarting: false,
      prompt: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      closed: false,
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
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
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess",
      status: "connecting",
      error: null as string | null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready,
      promptStarting: false,
      prompt: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      closed: false,
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
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
    expect(session.buffer).toHaveLength(1);
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
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });

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

  it("disconnects without waiting for a stalled ACP initialization", async () => {
    const [clientSide, agentSide] = linkedStreams();
    mocks.createWebSocketStream.mockReturnValue(clientSide);
    let finishInitialize: (() => void) | undefined;
    const initializeGate = new Promise<void>((resolve) => {
      finishInitialize = resolve;
    });
    serveFakeAgent(agentSide, [], { initializeGate });
    const session = await createAgentSession({ slug: "test-agent", spaceId: "space-1" });

    const closed = closeAgentSessions([session.id]).then(() => "closed" as const);
    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 100);
    });
    await expect(Promise.race([closed, timeout])).resolves.toBe("closed");
    expect((await listAgentSessions()).some((candidate) => candidate.id === session.id)).toBe(
      false,
    );

    finishInitialize?.();
  });

  it("rejects a second startup prompt without publishing a phantom user message", async () => {
    const session = {
      id: "session-2",
      slug: "claude",
      agentName: "Claude Code",
      transport: "local-subprocess",
      status: "connecting",
      error: null,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      acpSessionId: null,
      child: null,
      ready: new Promise<void>(() => {}),
      promptStarting: true,
      prompt: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      modelOption: null,
      setConfigOption: vi.fn(),
      seq: 0,
      persistedSeq: 0,
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
});
