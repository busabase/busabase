import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseAgentSessionCommands, busabaseAgentSessions } from "../src/db/schema";
import { agentSessionCommandDigest } from "../src/domains/agents/logic/agent-session-journal-policy";
import * as journalStore from "../src/domains/agents/logic/agent-session-journal-store";
import {
  admitSessionCommand,
  getJournalRuntime,
  loadSessionCommands,
  touchJournalDemand,
} from "../src/domains/agents/logic/agent-session-journal-store";
import { loadSessionEvents } from "../src/domains/agents/logic/agent-session-store";
import {
  AgentSessionSupervisorAuthorizationError,
  startAgentSessionSupervisorHost,
  stopAgentSessionSupervisorHost,
  wakeAgentSessionSupervisor,
} from "../src/domains/agents/logic/agent-session-supervisor";
import { seedScenario } from "./helpers/seed-scenario";

const transport = vi.hoisted(() => ({
  createWebSocketStream: vi.fn<() => Stream>(),
  launch: {
    url: "wss://fixture.invalid/acp",
    authHeader: "Bearer synthetic_fixture_old",
    bindingRef: "vault:supervision-v1",
  },
}));
vi.mock("@agentclientprotocol/sdk/experimental/ws-client", () => ({
  createWebSocketStream: transport.createWebSocketStream,
}));
vi.mock("../src/domains/agents/logic/agent-workspace", () => ({
  prepareAgentWorkspace: async () => "/tmp/agent-session-supervision-fixture",
}));
vi.mock("../src/domains/agents/logic/agent-workspace-guide", () => ({
  resolveBusabaseMcpUrl: () => "http://127.0.0.1/mcp-fixture",
}));
vi.mock("../src/domains/agents/logic/agent-catalog", () => ({
  resolveLaunch: async (slug: string) => ({
    slug,
    name: "Supervised protocol fixture",
    transport: "remote-websocket",
    ...transport.launch,
  }),
}));

const {
  createAgentSession,
  promptAgentSession,
  cancelAgentSession,
  respondToAgentPermission,
  setAgentSessionConfigOption,
  closeAgentSessions,
} = await import("../src/domains/agents/logic/agent-session-manager");

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface ReceiptFixture {
  commandId: string;
  turnId: string;
  state: "accepted" | "rejected";
  targetedCancel: boolean;
  cancelOutcome: "requested" | "unknown";
  lookups: string[];
  cancellations: Record<string, unknown>[];
}

interface EndpointOptions {
  configOptions?: acp.SessionConfigOption[];
  modes?: acp.SessionModeState;
  loadSession?: boolean;
  loadGate?: ReturnType<typeof gate>;
  replayThroughSeq?: number;
  loadCursorExpired?: boolean;
  newGate?: ReturnType<typeof gate>;
  promptGate?: ReturnType<typeof gate>;
  permission?: boolean;
  eventStream?: boolean;
  loadUpdates?: Record<string, unknown>[];
  extraInitialUpdate?: boolean;
  receipt?: ReceiptFixture;
}

/** ACP is real; only the remote provider implementation and transport are fixtures. */
function endpoint(options: EndpointOptions, ordinal: number) {
  let clientWire: TransformStreamDefaultController | undefined;
  let agentWire: TransformStreamDefaultController | undefined;
  const clientToAgent = new TransformStream({
    start(controller) {
      clientWire = controller;
    },
  });
  const agentToClient = new TransformStream({
    start(controller) {
      agentWire = controller;
    },
  });
  let remoteId = `remote_fixture_${ordinal}`;
  const creationEntered = gate();
  const loadingEntered = gate();
  const prompts: string[] = [];
  const decisions: acp.RequestPermissionOutcome[] = [];
  const cancellations: string[] = [];
  const loadedIds: string[] = [];
  const createdIds: string[] = [];
  const configChanges: Array<{ configId: string; value: string }> = [];
  const modeChanges: string[] = [];
  let configOptions = structuredClone(options.configOptions ?? []);
  let modes = options.modes ? structuredClone(options.modes) : undefined;
  let protocolContext: acp.AgentContext | undefined;
  let sourceSeq = 0;
  acp
    .agent()
    .onRequest(acp.methods.agent.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: options.loadSession !== false,
        ...(options.eventStream === false
          ? {}
          : {
              _meta: {
                "buda.im": {
                  eventStream: 1,
                  replayCursor: 1,
                  journalCoverage: 1,
                  ...(options.receipt
                    ? {
                        commandReceipts: 1,
                        writerEpoch: 1,
                        ...(options.receipt.targetedCancel ? { targetedCancel: 1 } : {}),
                      }
                    : {}),
                },
              },
            }),
      },
    }))
    .onRequest(
      "_buda.im/client/register_writer",
      z.record(z.string(), z.unknown()),
      ({ params }) => ({
        bindingId: params.bindingId,
        writerEpoch: params.writerEpoch,
        registered: true,
      }),
    )
    .onRequest("_buda.im/command/receipt", z.record(z.string(), z.unknown()), ({ params }) => {
      const receipt = options.receipt;
      receipt?.lookups.push(String(params.commandId));
      return {
        receipt:
          receipt && params.commandId === receipt.commandId
            ? {
                bindingId: params.bindingId,
                commandId: receipt.commandId,
                writerEpoch: 1,
                kind: "prompt",
                state: receipt.state,
                sessionId: remoteId,
                turnId: receipt.turnId,
                result: receipt.state === "rejected" ? { code: "CANCELLED_BEFORE_DISPATCH" } : null,
              }
            : null,
      };
    })
    .onRequest("_buda.im/session/cancel_turn", z.record(z.string(), z.unknown()), ({ params }) => {
      const receipt = options.receipt;
      if (
        !receipt ||
        params.targetCommandId !== receipt.commandId ||
        params.turnId !== receipt.turnId
      )
        throw acp.RequestError.invalidParams(undefined, "Incorrect cancellation target");
      receipt.cancellations.push(params);
      if (receipt.cancelOutcome === "requested") receipt.state = "rejected";
      return { outcome: receipt.cancelOutcome, turnId: receipt.turnId };
    })
    .onRequest(acp.methods.agent.session.new, async (ctx) => {
      createdIds.push(remoteId);
      creationEntered.resolve();
      await options.newGate?.promise;
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: remoteId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [],
          ...(options.eventStream === false ? {} : { _meta: { "buda.im": { seq: ++sourceSeq } } }),
        },
      });
      if (options.extraInitialUpdate)
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: remoteId,
          update: {
            sessionUpdate: "session_info_update",
            title: "initial metadata",
            _meta: { "buda.im": { seq: ++sourceSeq } },
          },
        });
      return { sessionId: remoteId, configOptions, ...(modes ? { modes } : {}) };
    })
    .onRequest(acp.methods.agent.session.load, async (ctx) => {
      remoteId = ctx.params.sessionId;
      loadedIds.push(remoteId);
      if (options.loadCursorExpired)
        throw new acp.RequestError(-32003, "ACP replay cursor expired past journal retention.");
      const after = (ctx.params._meta?.["buda.im"] as { afterSeq?: number } | undefined)?.afterSeq;
      sourceSeq = Math.max(sourceSeq, after ?? 1);
      for (const update of options.loadUpdates ?? []) {
        const seq = (update._meta as { "buda.im"?: { seq?: number } } | undefined)?.["buda.im"]
          ?.seq;
        if (typeof seq === "number") sourceSeq = Math.max(sourceSeq, seq);
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: remoteId,
          update: update as acp.SessionUpdate,
        });
      }
      loadingEntered.resolve();
      await options.loadGate?.promise;
      return {
        configOptions,
        ...(modes ? { modes } : {}),
        ...(options.eventStream === false
          ? {}
          : { _meta: { "buda.im": { replayThroughSeq: options.replayThroughSeq ?? sourceSeq } } }),
      };
    })
    .onRequest(acp.methods.agent.session.setConfigOption, async (ctx) => {
      const value = "value" in ctx.params ? String(ctx.params.value) : "";
      const selected = configOptions.find((option) => option.id === ctx.params.configId);
      if (
        !selected ||
        selected.type !== "select" ||
        !selected.options.some((choice) =>
          "options" in choice
            ? choice.options.some((option) => option.value === value)
            : choice.value === value,
        )
      )
        throw acp.RequestError.invalidParams(
          undefined,
          "The selected fixture option is unavailable",
        );
      configChanges.push({ configId: ctx.params.configId, value });
      configOptions = configOptions.map((option) =>
        option.id === ctx.params.configId && option.type === "select"
          ? { ...option, currentValue: value }
          : option,
      );
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: remoteId,
        update: { sessionUpdate: "config_option_update", configOptions },
      });
      return { configOptions };
    })
    .onRequest(acp.methods.agent.session.setMode, async (ctx) => {
      if (!modes?.availableModes.some((mode) => mode.id === ctx.params.modeId))
        throw acp.RequestError.invalidParams(undefined, "The selected fixture mode is unavailable");
      modeChanges.push(ctx.params.modeId);
      modes = { ...modes, currentModeId: ctx.params.modeId };
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: remoteId,
        update: { sessionUpdate: "current_mode_update", currentModeId: ctx.params.modeId },
      });
      return {};
    })
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      const text = ctx.params.prompt.find((block) => block.type === "text");
      prompts.push(text?.type === "text" ? text.text : "");
      if (options.permission) {
        const response = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId: remoteId,
          toolCall: {
            toolCallId: "fixture_read",
            title: "Read the fixture",
            kind: "read",
            status: "pending",
          },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        });
        decisions.push(response.outcome);
      }
      await options.promptGate?.promise;
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: remoteId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `reply: ${prompts.at(-1)}` },
          ...(options.eventStream === false ? {} : { _meta: { "buda.im": { seq: ++sourceSeq } } }),
        },
      });
      return { stopReason: "end_turn" as const };
    })
    .onNotification(acp.methods.agent.session.cancel, async ({ params }) => {
      cancellations.push(params.sessionId);
      options.promptGate?.resolve();
    })
    .connectWith(
      { readable: clientToAgent.readable, writable: agentToClient.writable },
      (context) => {
        protocolContext = context;
        return new Promise(() => {});
      },
    )
    .catch(() => {});
  return {
    options,
    remoteId,
    creationEntered,
    loadingEntered,
    prompts,
    decisions,
    cancellations,
    loadedIds,
    createdIds,
    configChanges,
    modeChanges,
    notify: async (update: acp.SessionUpdate) => {
      if (!protocolContext) throw new Error("Fixture protocol connection is not ready");
      const seq = (update._meta?.["buda.im"] as { seq?: number } | undefined)?.seq;
      if (typeof seq === "number") sourceSeq = Math.max(sourceSeq, seq);
      await protocolContext.notify(acp.methods.client.session.update, {
        sessionId: remoteId,
        update,
      });
    },
    disconnect: () => {
      clientWire?.error(new Error("fixture transport disconnected"));
      agentWire?.error(new Error("fixture transport disconnected"));
    },
    stream: { readable: agentToClient.readable, writable: clientToAgent.writable },
  };
}

describe("session supervision through real manager, journals, ACP and PGLite", () => {
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  const scope = { spaceId: LOCAL_SPACE_ID, actorId: "supervision-fixture-actor" };
  const run = <T>(operation: () => Promise<T>) =>
    runWithBusabaseContext({ db, ...scope, isSpaceManager: true }, operation);
  const sessionIds: string[] = [];
  const optionsQueue: EndpointOptions[] = [];
  const endpoints: ReturnType<typeof endpoint>[] = [];
  beforeAll(async () => {
    ({ db } = await seedScenario("agent-session-supervision"));
  });
  beforeEach(() => {
    transport.launch = {
      url: "wss://fixture.invalid/acp",
      authHeader: "Bearer synthetic_fixture_old",
      bindingRef: "vault:supervision-v1",
    };
    vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
    transport.createWebSocketStream.mockImplementation(() => {
      const connected = endpoint(optionsQueue.shift() ?? {}, endpoints.length + 1);
      endpoints.push(connected);
      return connected.stream;
    });
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: (context, operation) =>
        runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        ),
    });
  });
  afterEach(async () => {
    for (const connected of endpoints) {
      connected.options.newGate?.resolve();
      connected.options.loadGate?.resolve();
      connected.options.promptGate?.resolve();
    }
    const state = (
      globalThis as typeof globalThis & {
        __busabaseSessionSupervisor?: {
          owners: Map<
            string,
            {
              data: Promise<void> | null;
              connecting: Promise<void> | null;
              controls: Map<string, Promise<void>>;
            }
          >;
        };
      }
    ).__busabaseSessionSupervisor;
    const inFlight = [...(state?.owners.values() ?? [])]
      .flatMap((owner) => [owner.data, owner.connecting, ...owner.controls.values()])
      .filter((operation): operation is Promise<void> => operation !== null);
    await stopAgentSessionSupervisorHost();
    await Promise.allSettled(inFlight);
    await run(() => closeAgentSessions(sessionIds));
    if (sessionIds.length)
      await db.delete(busabaseAgentSessions).where(inArray(busabaseAgentSessions.id, sessionIds));
    sessionIds.length = 0;
    endpoints.length = 0;
    optionsQueue.length = 0;
    transport.createWebSocketStream.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function create(options: EndpointOptions = {}) {
    optionsQueue.push(options);
    const session = await run(() =>
      createAgentSession({ slug: "buda:supervision-fixture", spaceId: scope.spaceId }),
    );
    sessionIds.push(session.id);
    return session;
  }
  async function commandState(sessionId: string, commandId: string, state: string) {
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const command = (await run(() => loadSessionCommands(sessionId, scope))).find(
          (item) => item.commandId === commandId,
        );
        expect(command?.state).toBe(state);
      },
      { timeout: 8_000, interval: 25 },
    );
  }
  const updates = (events: AgentSessionEventVO[], tag: string) =>
    events.filter(
      (event) => (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === tag,
    );

  const configurationChoices: acp.SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue: "balanced",
      options: [
        { value: "balanced", name: "Balanced" },
        { value: "fast", name: "Fast" },
      ],
    },
    {
      id: "thinking_level",
      name: "Thinking",
      type: "select",
      category: "thought_level",
      currentValue: "medium",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
    {
      id: "permission_mode",
      name: "Permissions",
      type: "select",
      category: "mode",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    },
  ];

  it.each([
    { configId: "model", value: "fast", previous: "balanced", property: "modelOption" },
    { configId: "thinking_level", value: "high", previous: "medium", property: "thinkingOption" },
    { configId: "permission_mode", value: "plan", previous: "default", property: "modeOption" },
  ] as const)(
    "dispatches supervised $configId configuration through its inbox and persists the confirmed choice",
    async ({ configId, value, previous, property }) => {
      const session = await create({ configOptions: configurationChoices });
      await vi.waitFor(async () => {
        await wakeAgentSessionSupervisor();
        expect(
          (await run(() => getJournalRuntime(session.id, scope)))?.session[property]?.currentValue,
        ).toBe(previous);
      });
      const commandId = `cmd_supervised_config_${configId}`;
      const confirmed = await run(() =>
        setAgentSessionConfigOption(session.id, configId, value, "config", commandId),
      );
      expect(confirmed[property]?.currentValue).toBe(value);
      await commandState(session.id, commandId, "completed");
      expect(endpoints[0].configChanges).toEqual([{ configId, value }]);
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session[property]?.currentValue,
      ).toBe(value);
      const retry = await run(() =>
        setAgentSessionConfigOption(session.id, configId, value, "config", commandId),
      );
      expect(retry[property]?.currentValue).toBe(value);
      expect(endpoints[0].configChanges).toHaveLength(1);
      await expect(
        run(() => setAgentSessionConfigOption(session.id, configId, previous, "config", commandId)),
      ).rejects.toThrow(/different content/i);
      expect(endpoints[0].configChanges).toHaveLength(1);
      expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
      expect(
        (await run(() => loadSessionCommands(session.id, scope))).find(
          (command) => command.commandId === commandId,
        ),
      ).toMatchObject({ kind: "config", state: "completed" });
    },
  );

  it("dispatches supervised legacy modes through session/set_mode without using the config method", async () => {
    const session = await create({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
      },
    });
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.modeOption,
      ).toMatchObject({ source: "legacy", currentValue: "default" });
    });
    const result = await run(() =>
      setAgentSessionConfigOption(
        session.id,
        "mode",
        "plan",
        "legacy",
        "cmd_supervised_legacy_mode",
      ),
    );
    expect(result.modeOption).toMatchObject({ source: "legacy", currentValue: "plan" });
    expect(endpoints[0].modeChanges).toEqual(["plan"]);
    expect(endpoints[0].configChanges).toEqual([]);
    await commandState(session.id, "cmd_supervised_legacy_mode", "completed");
  });

  it("keeps generic no-load recovery explicit and never creates a replacement remote conversation", async () => {
    const session = await create({ eventStream: false, loadSession: false });
    await run(() =>
      promptAgentSession(session.id, "retain this conversation", undefined, {
        commandId: "cmd_generic_no_load",
      }),
    );
    await commandState(session.id, "cmd_generic_no_load", "completed");
    const before = await run(() => loadSessionEvents(session.id, -1));
    optionsQueue.push({ eventStream: false, loadSession: false });
    endpoints[0].disconnect();
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        expect(
          (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability
            ?.synchronization,
        ).toBe("gap");
      },
      { timeout: 8_000, interval: 25 },
    );
    expect(endpoints.flatMap((connected) => connected.createdIds)).toHaveLength(1);
    expect(endpoints.flatMap((connected) => connected.loadedIds)).toEqual([]);
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([
      "retain this conversation",
    ]);
    expect(await run(() => loadSessionEvents(session.id, -1))).toEqual(before);
  });

  it("releases a no-demand idle owner after actual database-clock grace without deleting history", async () => {
    const session = await create();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    const before = await run(() => loadSessionEvents(session.id, -1));
    const graceStarted = performance.now();
    expect(await run(() => touchJournalDemand(session.id, scope, 1))).toBe(true);
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const runtime = await run(() => getJournalRuntime(session.id, scope));
        expect(runtime?.writerOwnerId).toBeNull();
        expect(runtime?.session.reliability?.connection).toBe("disconnected");
      },
      { timeout: 5_000, interval: 50 },
    );
    await wakeAgentSessionSupervisor();
    expect(performance.now() - graceStarted).toBeGreaterThanOrEqual(750);
    expect(endpoints).toHaveLength(1);
    expect(await run(() => loadSessionEvents(session.id, -1))).toEqual(before);
    const live = (
      globalThis as typeof globalThis & { __busabaseAgentSessions?: Map<string, unknown> }
    ).__busabaseAgentSessions;
    expect(live?.has(session.id)).toBe(false);
  });

  it("orders replay-only sparse source records and overlapping live output before dispatching queued work", async () => {
    const session = await create();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    const original = {
      sessionUpdate: "agent_message_chunk" as const,
      messageId: "overlap_original",
      content: { type: "text" as const, text: "original" },
      _meta: { "buda.im": { seq: 2 } },
    };
    await endpoints[0].notify(original);
    await vi.waitFor(async () =>
      expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBe(2),
    );
    await stopAgentSessionSupervisorHost();
    const load = gate();
    optionsQueue.push({
      loadGate: load,
      loadUpdates: [
        { ...original, _meta: { "buda.im": { seq: 2, replay: true } } },
        {
          sessionUpdate: "user_message_chunk",
          messageId: "replay_only_external_user",
          content: { type: "text", text: "replay-only history" },
          _meta: { "buda.im": { seq: 4, replay: true } },
        },
      ],
    });
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: (context, operation) =>
        runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        ),
    });
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(endpoints).toHaveLength(2);
    });
    await endpoints[1].loadingEntered.promise;
    await endpoints[1].notify({
      sessionUpdate: "agent_message_chunk",
      messageId: "overlap_live",
      content: { type: "text", text: "live while loading" },
      _meta: { "buda.im": { seq: 6 } },
    });
    await run(() =>
      promptAgentSession(session.id, "after ordered history", undefined, {
        commandId: "cmd_overlap_after_replay",
      }),
    );
    await vi.waitFor(async () =>
      expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBe(6),
    );
    expect(endpoints.flatMap((peer) => peer.prompts)).toEqual([]);
    expect(
      (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
    ).not.toBe("connected");
    load.resolve();
    await commandState(session.id, "cmd_overlap_after_replay", "completed");
    const persisted = await run(() => loadSessionEvents(session.id, -1));
    const source = persisted.filter(
      (event) =>
        typeof (event.acpUpdate as { _meta?: { "buda.im"?: { seq?: number } } } | undefined)
          ?._meta?.["buda.im"]?.seq === "number",
    );
    expect(
      source.map(
        (event) =>
          (event.acpUpdate as { _meta: { "buda.im": { seq: number } } })._meta["buda.im"].seq,
      ),
    ).toEqual([1, 2, 4, 6, 7]);
    expect(
      updates(persisted, "agent_message_chunk").map(
        (event) => (event.acpUpdate as { content: { text: string } }).content.text,
      ),
    ).toEqual(["original", "live while loading", "reply: after ordered history"]);
    expect(updates(persisted, "user_message_chunk")).toHaveLength(1);
    expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBe(7);
    expect(endpoints.flatMap((peer) => peer.prompts)).toEqual(["after ordered history"]);
  });

  it.each(["restored-older-prefix", "retention-expired"] as const)(
    "preserves ambiguous execution and saved history when native recovery has a %s gap",
    async (variant) => {
      const held = gate();
      const session = await create({ promptGate: held });
      await run(() =>
        promptAgentSession(session.id, "already possibly executed", undefined, {
          commandId: "cmd_native_gap_unknown",
        }),
      );
      await vi.waitFor(() => expect(endpoints[0]?.prompts).toEqual(["already possibly executed"]));
      const before = await run(() => loadSessionEvents(session.id, -1));
      const checkpoint = (await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint;
      optionsQueue.push(
        variant === "restored-older-prefix" ? { replayThroughSeq: 0 } : { loadCursorExpired: true },
      );
      endpoints[0].disconnect();
      await vi.waitFor(
        async () => {
          await wakeAgentSessionSupervisor();
          expect(
            (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability
              ?.synchronization,
          ).toBe("gap");
        },
        { timeout: 8_000, interval: 25 },
      );
      expect(
        (await run(() => loadSessionCommands(session.id, scope))).find(
          (command) => command.commandId === "cmd_native_gap_unknown",
        )?.state,
      ).toBe("unknown");
      expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBe(
        checkpoint,
      );
      expect(await run(() => loadSessionEvents(session.id, -1))).toEqual(before);
      expect(endpoints.flatMap((peer) => peer.createdIds)).toHaveLength(1);
      expect(endpoints.flatMap((peer) => peer.prompts)).toEqual(["already possibly executed"]);
      await expect(
        run(() =>
          promptAgentSession(session.id, "must not blindly resend", undefined, {
            commandId: "cmd_native_gap_new",
          }),
        ),
      ).rejects.toThrow(/not accepting|unknown|reconcile/i);
      expect(endpoints.flatMap((peer) => peer.prompts)).toHaveLength(1);
      held.resolve();
    },
  );

  it("journals one accepted prompt and source reply, and never redispatches an identical command", async () => {
    const session = await create();
    expect(session.reliability).toEqual({
      connection: "connecting",
      execution: "idle",
      synchronization: "recovering",
    });
    await run(() =>
      promptAgentSession(session.id, "hello", undefined, { commandId: "cmd_supervised_first" }),
    );
    await commandState(session.id, "cmd_supervised_first", "completed");
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].prompts).toEqual(["hello"]);
    const events = await run(() => loadSessionEvents(session.id, -1));
    expect(updates(events, "user_message")).toHaveLength(1);
    expect(updates(events, "user_message")[0].commandId).toBe("cmd_supervised_first");
    expect(updates(events, "agent_message_chunk")).toHaveLength(1);
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
    await run(() =>
      promptAgentSession(session.id, "hello", undefined, { commandId: "cmd_supervised_first" }),
    );
    await wakeAgentSessionSupervisor();
    expect(endpoints[0].prompts).toEqual(["hello"]);
    const after = await run(() => loadSessionEvents(session.id, -1));
    expect(updates(after, "user_message")).toHaveLength(1);
    expect(
      (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability,
    ).toMatchObject({ execution: "idle", synchronization: "synced" });
  });

  it("runs distinct sessions at the same endpoint concurrently", async () => {
    const hold = gate();
    const a = await create({ promptGate: hold });
    const b = await create({ promptGate: hold });
    await Promise.all([
      run(() => promptAgentSession(a.id, "first", undefined, { commandId: "cmd_parallel_first" })),
      run(() =>
        promptAgentSession(b.id, "second", undefined, { commandId: "cmd_parallel_second" }),
      ),
    ]);
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        expect(endpoints.flatMap((connected) => connected.prompts).sort()).toEqual([
          "first",
          "second",
        ]);
      },
      { timeout: 8_000, interval: 25 },
    );
    expect(endpoints).toHaveLength(2);
    hold.resolve();
    await commandState(a.id, "cmd_parallel_first", "completed");
    await commandState(b.id, "cmd_parallel_second", "completed");
  });

  it("cancels a durable prompt before the blocked startup can dispatch it", async () => {
    const startup = gate();
    const session = await create({ newGate: startup });
    await run(() =>
      promptAgentSession(session.id, "must not run", undefined, {
        commandId: "cmd_cancel_startup",
      }),
    );
    await vi.waitFor(() => expect(endpoints).toHaveLength(1));
    await endpoints[0].creationEntered.promise;
    await run(() => cancelAgentSession(session.id));
    await commandState(session.id, "cmd_cancel_startup", "rejected");
    startup.resolve();
    await wakeAgentSessionSupervisor();
    expect(endpoints[0].prompts).toEqual([]);
  });

  it("answers permission through the control lane while the original prompt remains stalled", async () => {
    const hold = gate();
    const session = await create({ permission: true, promptGate: hold });
    await run(() =>
      promptAgentSession(session.id, "read the fixture", undefined, {
        commandId: "cmd_permission_wait",
      }),
    );
    let requestId: string | undefined;
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const events = await run(() => loadSessionEvents(session.id, -1));
        requestId = events.find((event) => event.kind === "permissionRequest")?.permissionRequest
          ?.requestId;
        expect(requestId).toBeTruthy();
      },
      { timeout: 8_000, interval: 25 },
    );
    const pendingRequestId = requestId;
    if (!pendingRequestId) throw new Error("Missing durable permission request");
    const started = performance.now();
    await run(() =>
      Promise.resolve(
        respondToAgentPermission(
          session.id,
          pendingRequestId,
          "allow",
          "cmd_permission_response_retry",
        ),
      ),
    );
    expect(performance.now() - started).toBeLessThan(1_000);
    await run(() =>
      Promise.resolve(
        respondToAgentPermission(
          session.id,
          pendingRequestId,
          "allow",
          "cmd_permission_response_retry",
        ),
      ),
    );
    await expect(
      run(() =>
        Promise.resolve(
          respondToAgentPermission(
            session.id,
            pendingRequestId,
            "deny",
            "cmd_permission_response_retry",
          ),
        ),
      ),
    ).rejects.toThrow(/different content/i);
    expect(endpoints[0].decisions).toEqual([{ outcome: "selected", optionId: "allow" }]);
    const pending = (await run(() => loadSessionCommands(session.id, scope))).find(
      (command) => command.commandId === "cmd_permission_wait",
    );
    expect(pending?.state).toBe("dispatching");
    hold.resolve();
    await commandState(session.id, "cmd_permission_wait", "completed");
  });

  it("reconciles a real committed user-event batch after losing its commit acknowledgement", async () => {
    const append = journalStore.appendJournalEvents;
    let lostAcknowledgement = false;
    vi.spyOn(journalStore, "appendJournalEvents").mockImplementation(async (...args) => {
      const result = await append(...args);
      if (
        !lostAcknowledgement &&
        result.outcome === "committed" &&
        args[1].some(
          (input) =>
            (input.event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
        )
      ) {
        lostAcknowledgement = true;
        return { outcome: "transient_failure", diagnosticRef: "diag_lost_commit_ack" };
      }
      return result;
    });
    const session = await create();
    await run(() =>
      promptAgentSession(session.id, "commit once", undefined, {
        commandId: "cmd_lost_commit_ack",
      }),
    );
    await commandState(session.id, "cmd_lost_commit_ack", "completed");
    expect(lostAcknowledgement).toBe(true);
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual(["commit once"]);
    const events = await run(() => loadSessionEvents(session.id, -1));
    expect(updates(events, "user_message")).toHaveLength(1);
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
  });

  it("keeps generic dispatch unknown after a socket drop and isolates recovered history instead of resending", async () => {
    const hold = gate();
    const session = await create({ promptGate: hold, eventStream: false });
    await run(() =>
      promptAgentSession(session.id, "ambiguous execution", undefined, {
        commandId: "cmd_generic_unknown",
      }),
    );
    await vi.waitFor(() => expect(endpoints[0]?.prompts).toEqual(["ambiguous execution"]));
    optionsQueue.push({
      eventStream: false,
      loadUpdates: [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "ambiguous execution" },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Recovered partial answer" },
        },
      ],
    });
    endpoints[0].disconnect();
    await commandState(session.id, "cmd_generic_unknown", "unknown");
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const runtime = await run(() => getJournalRuntime(session.id, scope));
        expect(
          runtime?.session.recoverySnapshot?.updates,
          JSON.stringify({
            state: runtime?.session.reliability,
            snapshotPresent: Boolean(runtime?.session.recoverySnapshot),
            loadedIds: endpoints.flatMap((connected) => connected.loadedIds),
          }),
        ).toHaveLength(2);
        expect(runtime?.session.reliability).toMatchObject({
          execution: "unknown",
          synchronization: "gap",
        });
      },
      { timeout: 8_000, interval: 25 },
    );
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual(["ambiguous execution"]);
    const events = await run(() => loadSessionEvents(session.id, -1));
    expect(updates(events, "user_message")).toHaveLength(1);
    expect(updates(events, "agent_message_chunk")).toHaveLength(0);
    hold.resolve();
  });

  it("rediscovers a durable queued command after host restart and dispatches its identity once", async () => {
    const session = await create();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect((await run(() => getJournalRuntime(session.id, scope)))?.acpSessionId).toBeTruthy();
    });
    const originalRemote = (await run(() => getJournalRuntime(session.id, scope)))?.acpSessionId;
    await stopAgentSessionSupervisorHost();
    // This is the persisted crash boundary: admission committed, process died
    // before its local wakeup. No store result or journal is mocked.
    const payload = {
      text: "after restart",
      resourceContext: [],
      requestDigest: agentSessionCommandDigest({ text: "after restart" }),
    };
    expect(
      await run(() =>
        admitSessionCommand(
          session.id,
          { commandId: "cmd_host_restart", kind: "prompt", payload, presentation: payload },
          scope,
        ),
      ),
    ).toMatchObject({ outcome: "accepted" });
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: (context, operation) =>
        runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        ),
    });
    await commandState(session.id, "cmd_host_restart", "completed");
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual(["after restart"]);
    expect(endpoints.flatMap((connected) => connected.loadedIds)).toContain(originalRemote);
    await run(() =>
      promptAgentSession(session.id, "after restart", undefined, { commandId: "cmd_host_restart" }),
    );
    await wakeAgentSessionSupervisor();
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual(["after restart"]);
  });

  it.each([
    {
      label: "confirmed targeted rejection",
      targetedCancel: true,
      cancelOutcome: "requested" as const,
      expected: "rejected",
    },
    {
      label: "unsupported targeted cancellation",
      targetedCancel: false,
      cancelOutcome: "requested" as const,
      expected: "unknown",
    },
    {
      label: "unconfirmed targeted cancellation",
      targetedCancel: true,
      cancelOutcome: "unknown" as const,
      expected: "unknown",
    },
  ])(
    "reconciles expired remote-accepted work via $label without silently clearing its reservation",
    async ({ targetedCancel, cancelOutcome, expected }) => {
      const commandId = "cmd_expired_remote_accepted";
      const receipt: ReceiptFixture = {
        commandId,
        turnId: "turn_expired_remote_accepted",
        state: "accepted",
        targetedCancel,
        cancelOutcome,
        lookups: [],
        cancellations: [],
      };
      const session = await create({ receipt });
      await vi.waitFor(async () => {
        await wakeAgentSessionSupervisor();
        expect((await run(() => getJournalRuntime(session.id, scope)))?.acpSessionId).toBeTruthy();
      });
      await stopAgentSessionSupervisorHost();
      const payload = {
        text: "accepted before outage",
        resourceContext: [],
        requestDigest: agentSessionCommandDigest({ text: "accepted before outage" }),
      };
      expect(
        await run(() =>
          admitSessionCommand(
            session.id,
            { commandId, kind: "prompt", payload, presentation: payload },
            scope,
          ),
        ),
      ).toMatchObject({ outcome: "accepted" });
      const lease = await run(() =>
        journalStore.claimWriterLease(session.id, "expiry_fixture_writer", 45, scope),
      );
      if (!lease) throw new Error("Fixture could not acquire writer lease");
      expect(
        await run(() =>
          journalStore.appendJournalEvents(
            session.id,
            [
              {
                identity: `command:${commandId}:user`,
                event: {
                  kind: "acpUpdate",
                  at: new Date().toISOString(),
                  commandId,
                  acpUpdate: { sessionUpdate: "user_message", text: payload.text, commandId },
                },
              },
            ],
            lease,
            scope,
          ),
        ),
      ).toMatchObject({ outcome: "committed" });
      expect(
        await run(() =>
          journalStore.transitionSessionCommand(
            session.id,
            commandId,
            ["queued"],
            "dispatching",
            lease,
            scope,
          ),
        ),
      ).toBe(true);
      await db
        .update(busabaseAgentSessionCommands)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(busabaseAgentSessionCommands.commandId, commandId));
      await run(() => journalStore.releaseWriterLease(session.id, lease, scope));
      optionsQueue.push({ receipt });
      startAgentSessionSupervisorHost({
        database: async () => db,
        runAs: (context, operation) =>
          runWithBusabaseContext(
            { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
            operation,
          ),
      });
      await commandState(session.id, commandId, expected);
      await vi.waitFor(async () => {
        await wakeAgentSessionSupervisor();
        const runtime = await run(() => getJournalRuntime(session.id, scope));
        expect(receipt.lookups.length).toBeGreaterThan(0);
        if (expected === "rejected") {
          expect(receipt.state).toBe("rejected");
          expect(runtime?.activeCommandId).toBeNull();
        } else {
          expect(runtime?.activeCommandId).toBe(commandId);
          expect(runtime?.session.reliability).toMatchObject({
            execution: "unknown",
            synchronization: "gap",
          });
        }
      });
      expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
      if (targetedCancel)
        expect(receipt.cancellations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ targetCommandId: commandId, turnId: receipt.turnId }),
          ]),
        );
      else expect(receipt.cancellations).toEqual([]);
    },
  );

  it("rejects queued work after host authorization is revoked without using the retained socket", async () => {
    const startup = gate();
    const session = await create({ newGate: startup });
    await run(() =>
      promptAgentSession(session.id, "revoked command", undefined, {
        commandId: "cmd_revoked_access",
      }),
    );
    await vi.waitFor(() => expect(endpoints).toHaveLength(1));
    await endpoints[0].creationEntered.promise;
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: async () => {
        throw new AgentSessionSupervisorAuthorizationError("fixture access revoked");
      },
    });
    await commandState(session.id, "cmd_revoked_access", "rejected");
    const command = (await run(() => loadSessionCommands(session.id, scope))).find(
      (item) => item.commandId === "cmd_revoked_access",
    );
    expect(command?.errorCode).toBe("ACTOR_ACCESS_REVOKED");
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
    startup.resolve();
  });

  it("does not advance the source checkpoint past failed initial metadata", async () => {
    const append = journalStore.appendJournalEvents;
    let failed = 0;
    vi.spyOn(journalStore, "appendJournalEvents").mockImplementation(async (...args) => {
      if (args[1].some((input) => input.sourceSeq === 1)) {
        failed += 1;
        return { outcome: "transient_failure", diagnosticRef: "diag_initial_metadata_outage" };
      }
      return append(...args);
    });
    const session = await create({ extraInitialUpdate: true });
    await vi.waitFor(() => expect(failed).toBeGreaterThanOrEqual(4), {
      timeout: 8_000,
      interval: 25,
    });
    await stopAgentSessionSupervisorHost();
    const runtime = await run(() => getJournalRuntime(session.id, scope));
    expect(runtime?.sourceCheckpoint ?? 0).toBe(0);
    const events = await run(() => loadSessionEvents(session.id, -1));
    expect(updates(events, "session_info_update")).toHaveLength(0);
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
  });

  it.each(["endpoint", "principal", "token"] as const)(
    "checks retained-socket %s binding immediately before dispatch",
    async (rotation) => {
      const session = await create();
      await run(() =>
        promptAgentSession(session.id, "saved baseline", undefined, {
          commandId: "cmd_binding_baseline",
        }),
      );
      await commandState(session.id, "cmd_binding_baseline", "completed");
      const before = await run(() => loadSessionEvents(session.id, -1));
      const releaseClaim = gate();
      let claimed = false;
      const claim = journalStore.claimSessionCommands;
      vi.spyOn(journalStore, "claimSessionCommands").mockImplementation(async (...args) => {
        const commands = await claim(...args);
        if (
          args[3] === "data" &&
          commands.some((command) => command.commandId === "cmd_binding_rotation")
        ) {
          claimed = true;
          await releaseClaim.promise;
        }
        return commands;
      });
      try {
        await run(() =>
          promptAgentSession(session.id, "queued before rotation", undefined, {
            commandId: "cmd_binding_rotation",
          }),
        );
        await vi.waitFor(() => expect(claimed).toBe(true), { timeout: 8_000, interval: 25 });
        if (rotation === "endpoint") transport.launch.url = "wss://another-fixture.invalid/acp";
        if (rotation === "principal") transport.launch.bindingRef = "vault:supervision-v2";
        if (rotation === "token")
          transport.launch.authHeader = "Bearer synthetic_fixture_refreshed";
        releaseClaim.resolve();
        await commandState(
          session.id,
          "cmd_binding_rotation",
          rotation === "token" ? "completed" : "rejected",
        );
        const after = await run(() => loadSessionEvents(session.id, -1));
        expect(after.slice(0, before.length)).toEqual(before);
        if (rotation === "token") {
          expect(endpoints).toHaveLength(1);
          expect(endpoints[0].prompts).toEqual(["saved baseline", "queued before rotation"]);
        } else {
          expect(endpoints.flatMap((connected) => connected.prompts)).toEqual(["saved baseline"]);
          expect(
            (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability
              ?.synchronization,
          ).toBe("gap");
        }
      } finally {
        releaseClaim.resolve();
      }
    },
  );

  it("rejects an accepted command when its pinned binding changes before owner connection", async () => {
    const releaseHost = gate();
    let enteredHost = false;
    startAgentSessionSupervisorHost({
      database: async () => db,
      async runAs(context, operation) {
        enteredHost = true;
        await releaseHost.promise;
        return runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        );
      },
    });
    try {
      const session = await create();
      await run(() =>
        promptAgentSession(session.id, "accepted under old binding", undefined, {
          commandId: "cmd_pin_changed_before_connect",
        }),
      );
      await vi.waitFor(() => expect(enteredHost).toBe(true), { timeout: 8_000, interval: 25 });
      transport.launch.url = "wss://replacement-fixture.invalid/acp";
      transport.launch.bindingRef = "vault:replacement-principal";
      releaseHost.resolve();
      await commandState(session.id, "cmd_pin_changed_before_connect", "rejected");
      const command = (await run(() => loadSessionCommands(session.id, scope))).find(
        (item) => item.commandId === "cmd_pin_changed_before_connect",
      );
      expect(command?.errorCode).toBe("CONNECTION_BINDING_CHANGED");
      expect(transport.createWebSocketStream).not.toHaveBeenCalled();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability
          ?.synchronization,
      ).toBe("gap");
      expect(await run(() => loadSessionEvents(session.id, -1))).toEqual([]);
    } finally {
      releaseHost.resolve();
    }
  });

  it("bounds a thousand-event ordered replay and preserves its history across another reload", async () => {
    const session = await create();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    await stopAgentSessionSupervisorHost();
    const append = journalStore.appendJournalEvents;
    const batchSizes: number[] = [];
    vi.spyOn(journalStore, "appendJournalEvents").mockImplementation(async (...args) => {
      batchSizes.push(args[1].length);
      return append(...args);
    });
    const replay = Array.from({ length: 1_000 }, (_, index) => ({
      sessionUpdate: "agent_message_chunk",
      messageId: "burst_message",
      content: { type: "text", text: `chunk_${index}|` },
      _meta: { "buda.im": { seq: index + 2 } },
    }));
    optionsQueue.push({ loadUpdates: replay });
    const start = () =>
      startAgentSessionSupervisorHost({
        database: async () => db,
        runAs: (context, operation) =>
          runWithBusabaseContext(
            { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
            operation,
          ),
      });
    const replayStarted = performance.now();
    start();
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const runtime = await run(() => getJournalRuntime(session.id, scope));
        expect(runtime?.sourceCheckpoint).toBe(1_001);
        expect(runtime?.session.reliability?.connection).toBe("connected");
      },
      { timeout: 15_000, interval: 25 },
    );
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<
          string,
          {
            journal?: {
              stats?: {
                maxPending: number;
                batchCount: number;
                maxBatchSize: number;
                backpressureCount: number;
              };
            };
          }
        >;
      }
    ).__busabaseAgentSessions?.get(session.id);
    const elapsedMs = performance.now() - replayStarted;
    const stats = live?.journal?.stats;
    expect(stats).toBeDefined();
    expect(stats?.maxPending).toBeLessThanOrEqual(500);
    expect(stats?.maxBatchSize).toBeLessThanOrEqual(256);
    expect(stats?.maxBatchSize).toBeGreaterThan(1);
    expect(batchSizes.length).toBeLessThan(100);
    expect(batchSizes.every((size) => size <= 256)).toBe(true);
    const before = updates(
      await run(() => loadSessionEvents(session.id, -1)),
      "agent_message_chunk",
    );
    expect(before).toHaveLength(1_000);
    expect(
      before.map((event) => (event.acpUpdate as { content: { text: string } }).content.text),
    ).toEqual(replay.map((update) => update.content.text));
    expect(new Set(before.map((event) => event.seq)).size).toBe(1_000);
    await stopAgentSessionSupervisorHost();
    optionsQueue.push({});
    start();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    expect(
      updates(await run(() => loadSessionEvents(session.id, -1)), "agent_message_chunk"),
    ).toEqual(before);
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
    process.stdout.write(
      `${JSON.stringify({ verification: "local_acp_pglite_burst", events: 1_000, ...stats, observedBatches: batchSizes.length, elapsedMs })}\n`,
    );
  }, 25_000);

  it("ignores unnegotiated source numbers for generic live updates and isolates their full replay", async () => {
    const session = await create({ eventStream: false });
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    for (const [messageId, text] of [
      ["generic_distinct_one", "First distinct live message"],
      ["generic_distinct_two", "Second distinct live message"],
    ])
      await endpoints[0].notify({
        sessionUpdate: "agent_message_chunk",
        messageId,
        content: { type: "text", text },
        _meta: { "buda.im": { seq: 1 } },
      } as acp.SessionUpdate);
    const conversationEvents = (events: AgentSessionEventVO[]) =>
      events.filter((event) =>
        ["user_message", "user_message_chunk", "agent_message_chunk"].includes(
          (event.acpUpdate as { sessionUpdate?: string })?.sessionUpdate ?? "",
        ),
      );
    let before: AgentSessionEventVO[] = [];
    await vi.waitFor(async () => {
      before = conversationEvents(await run(() => loadSessionEvents(session.id, -1)));
      expect(before).toHaveLength(2);
    });
    expect(
      before.map((event) => (event.acpUpdate as { content: { text: string } }).content.text),
    ).toEqual(["First distinct live message", "Second distinct live message"]);
    expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBeNull();
    await stopAgentSessionSupervisorHost();
    optionsQueue.push({
      eventStream: false,
      loadUpdates: [
        {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Generic recovered user" },
          _meta: { "buda.im": { seq: 1 } },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Generic recovered answer" },
          _meta: { "buda.im": { seq: 2 } },
        },
      ],
    });
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: (context, operation) =>
        runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        ),
    });
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        const runtime = await run(() => getJournalRuntime(session.id, scope));
        expect(runtime?.session.recoverySnapshot?.updates).toHaveLength(2);
        expect(runtime?.session.reliability?.synchronization).toBe("gap");
      },
      { timeout: 8_000, interval: 25 },
    );
    expect(conversationEvents(await run(() => loadSessionEvents(session.id, -1)))).toEqual(before);
    expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBeNull();
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
  });

  it("latches the first integrity failure during a large replay without advancing its checkpoint or reconnecting", async () => {
    const session = await create();
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(
        (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.connection,
      ).toBe("connected");
    });
    const checkpoint = (await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint;
    expect(checkpoint).toBe(1);
    await stopAgentSessionSupervisorHost();
    const append = journalStore.appendJournalEvents;
    let failedSourceAppends = 0;
    vi.spyOn(journalStore, "appendJournalEvents").mockImplementation(async (...args) => {
      if (args[1].some((input) => (input.sourceSeq ?? 0) >= 2)) {
        failedSourceAppends += 1;
        return { outcome: "integrity_failure", diagnosticRef: "diag_latched_integrity" };
      }
      return append(...args);
    });
    optionsQueue.push({
      loadUpdates: Array.from({ length: 1_000 }, (_, index) => ({
        sessionUpdate: "agent_message_chunk",
        messageId: "failed_replay",
        content: { type: "text", text: `uncommitted_${index}|` },
        _meta: { "buda.im": { seq: index + 2 } },
      })),
    });
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: (context, operation) =>
        runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        ),
    });
    await vi.waitFor(
      async () => {
        await wakeAgentSessionSupervisor();
        expect(failedSourceAppends).toBe(1);
        expect(
          (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability
            ?.synchronization,
        ).toBe("gap");
      },
      { timeout: 8_000, interval: 25 },
    );
    for (let index = 0; index < 10; index++) await wakeAgentSessionSupervisor();
    expect(failedSourceAppends).toBe(1);
    expect((await run(() => getJournalRuntime(session.id, scope)))?.sourceCheckpoint).toBe(
      checkpoint,
    );
    expect(
      updates(await run(() => loadSessionEvents(session.id, -1)), "agent_message_chunk"),
    ).toHaveLength(0);
    expect(transport.createWebSocketStream).toHaveBeenCalledTimes(2);
  });
  it("reuses one scoped outer session and remote creation for a retried creation identity", async () => {
    const input = {
      slug: "buda:supervision-fixture",
      spaceId: scope.spaceId,
      commandId: "create_same_intent",
    };
    const [first, retried] = await run(() =>
      Promise.all([createAgentSession(input), createAgentSession(input)]),
    );
    sessionIds.push(first.id);
    expect(retried.id).toBe(first.id);
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect((await run(() => getJournalRuntime(first.id, scope)))?.acpSessionId).toBeTruthy();
    });
    expect(endpoints).toHaveLength(1);
    await expect(
      run(() => createAgentSession({ ...input, slug: "buda:another-connection" })),
    ).rejects.toThrow(/different connection/i);
    expect(endpoints).toHaveLength(1);
  });

  it("keeps the original cancellation target when the same control identity is retried after it ends", async () => {
    const startup = gate();
    const session = await create({ newGate: startup });
    await run(() =>
      promptAgentSession(session.id, "cancel this saved intent", undefined, {
        commandId: "cmd_control_retry_target",
      }),
    );
    await vi.waitFor(() => expect(endpoints).toHaveLength(1));
    await endpoints[0].creationEntered.promise;
    await run(() => cancelAgentSession(session.id, "cmd_control_retry_cancel"));
    await run(() => cancelAgentSession(session.id, "cmd_control_retry_cancel"));
    const commands = await run(() => loadSessionCommands(session.id, scope));
    const controls = commands.filter((command) => command.kind === "cancel");
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      commandId: "cmd_control_retry_cancel",
      targetCommandId: "cmd_control_retry_target",
      state: "completed",
    });
    expect(
      commands.find((command) => command.commandId === "cmd_control_retry_target")?.state,
    ).toBe("rejected");
    startup.resolve();
    await wakeAgentSessionSupervisor();
    expect(endpoints.flatMap((connected) => connected.prompts)).toEqual([]);
  });
  it("expires known-unsent work and backs off when a remote transport never becomes ready", async () => {
    transport.createWebSocketStream.mockImplementation(() => {
      throw Object.assign(new Error("isolated fixture endpoint offline"), { code: "ECONNREFUSED" });
    });
    const session = await create();
    await run(() =>
      promptAgentSession(session.id, "never dispatch this expired intent", undefined, {
        commandId: "cmd_never_ready_expiry",
      }),
    );
    await vi.waitFor(async () => {
      await wakeAgentSessionSupervisor();
      expect(transport.createWebSocketStream).toHaveBeenCalledTimes(1);
    });
    for (let index = 0; index < 8; index++) await wakeAgentSessionSupervisor();
    expect(transport.createWebSocketStream).toHaveBeenCalledTimes(1);
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(busabaseAgentSessionCommands.commandId, "cmd_never_ready_expiry"));
    await commandState(session.id, "cmd_never_ready_expiry", "rejected");
    expect((await run(() => getJournalRuntime(session.id, scope)))?.activeCommandId).toBeNull();
    expect(transport.createWebSocketStream.mock.calls.length).toBeLessThanOrEqual(3);
    expect(endpoints).toHaveLength(0);
  });
  it("stops a permanent connection rejection before retrying or losing its saved message", async () => {
    const admissionGate = gate();
    startAgentSessionSupervisorHost({
      database: async () => db,
      runAs: async (context, operation) => {
        await admissionGate.promise;
        return runWithBusabaseContext(
          { db, ...context, actorId: context.actorId ?? undefined, isSpaceManager: true },
          operation,
        );
      },
    });
    transport.createWebSocketStream.mockImplementation(() => {
      throw Object.assign(new Error("isolated authentication rejection"), { code: "28000" });
    });
    const session = await create();
    await run(() =>
      promptAgentSession(session.id, "keep this not-sent message", undefined, {
        commandId: "cmd_permanent_connect_failure",
      }),
    );
    admissionGate.resolve();
    await commandState(session.id, "cmd_permanent_connect_failure", "rejected");
    for (let index = 0; index < 8; index++) await wakeAgentSessionSupervisor();
    expect(transport.createWebSocketStream).toHaveBeenCalledTimes(1);
    const runtime = await run(() => getJournalRuntime(session.id, scope));
    expect(runtime?.session.reliability?.synchronization).toBe("gap");
    expect(runtime?.activeCommandId).toBeNull();
    expect(
      (await run(() => loadSessionCommands(session.id, scope))).find(
        (command) => command.commandId === "cmd_permanent_connect_failure",
      )?.payload.text,
    ).toBe("keep this not-sent message");
  });

  it("stops after its finite confirmed-transient connection retry budget", async () => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    transport.createWebSocketStream.mockImplementation(() => {
      throw Object.assign(new Error("isolated connection unavailable"), { code: "ECONNREFUSED" });
    });
    const session = await create();
    await run(() =>
      promptAgentSession(session.id, "preserve this retry-budget message", undefined, {
        commandId: "cmd_connect_budget",
      }),
    );
    for (let attempt = 1; attempt <= 6; attempt++) {
      await vi.waitFor(
        async () => {
          await wakeAgentSessionSupervisor();
          expect(transport.createWebSocketStream).toHaveBeenCalledTimes(attempt);
          expect((await run(() => getJournalRuntime(session.id, scope)))?.writerOwnerId).toBeNull();
        },
        { timeout: 8_000, interval: 25 },
      );
      clock += 35_000;
    }
    await commandState(session.id, "cmd_connect_budget", "rejected");
    for (let index = 0; index < 8; index++) await wakeAgentSessionSupervisor();
    expect(transport.createWebSocketStream).toHaveBeenCalledTimes(6);
    expect(
      (await run(() => getJournalRuntime(session.id, scope)))?.session.reliability?.synchronization,
    ).toBe("gap");
    expect(endpoints).toHaveLength(0);
  });
});
