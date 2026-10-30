import { reduceAcpEvents } from "@acp-ui/core/reduce";
import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as originalContext from "../src/context";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import * as originalDb from "../src/db";
import { busabaseAgentSessions } from "../src/db/schema";
import { translateAgentSessionEvent } from "../src/domains/agents/hooks/use-agent-session";
import * as sessionStore from "../src/domains/agents/logic/agent-session-store";
import {
  acquireSessionLease,
  loadSessionEvents,
  loadSessionRuntime,
} from "../src/domains/agents/logic/agent-session-store";
import { seedScenario } from "./helpers/seed-scenario";

const mocks = vi.hoisted(() => ({ createWebSocketStream: vi.fn<() => Stream>() }));
vi.mock("@agentclientprotocol/sdk/experimental/ws-client", () => ({
  createWebSocketStream: mocks.createWebSocketStream,
}));
vi.mock("../src/domains/agents/logic/agent-workspace", () => ({
  prepareAgentWorkspace: async () => "/tmp/agent-lease-integration",
}));
vi.mock("../src/domains/agents/logic/agent-workspace-guide", () => ({
  resolveBusabaseMcpUrl: () => "http://localhost/mcp",
}));
vi.mock("../src/domains/agents/logic/agent-catalog", () => ({
  resolveLaunch: async () => ({
    slug: "lease-test",
    name: "Lease Test",
    transport: "remote-websocket",
    url: "wss://agent.test/acp",
  }),
}));

const { closeAgentSession, promptAgentSession, respondToAgentPermission } = await import(
  "../src/domains/agents/logic/agent-session-manager"
);

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeAgent(
  options: {
    loadGate?: Promise<void>;
    permission?: boolean;
    /** Tool titles whose permission requests are all in flight at once. */
    parallelPermissions?: string[];
    model?: boolean;
    embeddedContext?: boolean;
    budaEventStream?: boolean;
  } = {},
) {
  const aToB = new TransformStream();
  const bToA = new TransformStream();
  mocks.createWebSocketStream.mockReturnValue({
    writable: aToB.writable,
    readable: bToA.readable,
  });
  const loaded = gate();
  let connected: acp.AgentContext | undefined;
  const prompts: string[] = [];
  const promptContents: acp.ContentBlock[][] = [];
  const configChanges: string[] = [];
  const permissionOutcomes: Array<{ title: string; outcome: acp.RequestPermissionOutcome }> = [];
  let configOptions: acp.SessionConfigOption[] = options.model
    ? [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "auto",
          options: [
            { value: "auto", name: "Auto" },
            { value: "fast", name: "Fast" },
          ],
        },
      ]
    : [];
  acp
    .agent()
    .onRequest(acp.methods.agent.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        ...(options.budaEventStream ? { _meta: { "buda.im": { eventStream: 1 } } } : {}),
        promptCapabilities: { embeddedContext: options.embeddedContext },
      },
    }))
    .onRequest(acp.methods.agent.session.load, async () => {
      loaded.resolve();
      await options.loadGate;
      return { configOptions };
    })
    .onRequest(acp.methods.agent.session.setConfigOption, async (ctx) => {
      const value = "value" in ctx.params ? String(ctx.params.value) : "";
      configChanges.push(value);
      configOptions = configOptions.map((option) => ({ ...option, currentValue: value }));
      return { configOptions };
    })
    .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
      promptContents.push(ctx.params.prompt);
      const text = ctx.params.prompt.find((block) => block.type === "text");
      if (text?.type === "text") prompts.push(text.text);
      if (options.permission) {
        await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId: ctx.params.sessionId,
          toolCall: {
            toolCallId: "lease-permission",
            title: "Run command",
            kind: "execute",
            status: "pending",
          },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        });
      }
      if (options.parallelPermissions) {
        await Promise.all(
          options.parallelPermissions.map(async (title, index) => {
            const response = await ctx.client.request(
              acp.methods.client.session.requestPermission,
              {
                sessionId: ctx.params.sessionId,
                toolCall: {
                  toolCallId: `lease-parallel-${index}`,
                  title,
                  kind: "read",
                  status: "pending",
                },
                options: [
                  { optionId: "allow", name: "Allow", kind: "allow_once" },
                  { optionId: "deny", name: "Deny", kind: "reject_once" },
                ],
              },
            );
            permissionOutcomes.push({ title, outcome: response.outcome });
          }),
        );
      }
      return { stopReason: "end_turn" as const };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {})
    .connectWith({ readable: aToB.readable, writable: bToA.writable }, (ctx) => {
      connected = ctx;
      return new Promise(() => {});
    })
    .catch(() => {});
  return {
    loaded: loaded.promise,
    prompts,
    promptContents,
    configChanges,
    permissionOutcomes,
    notify: async (method: string, params: Record<string, unknown>) => {
      if (!connected) throw new Error("Agent is not connected");
      await connected.notify(method, params);
    },
  };
}

describe("operation lease lifecycle with real ACP and PGLite persistence", () => {
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  const sessionIds: string[] = [];
  const inScope = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext(
      {
        db,
        spaceId: LOCAL_SPACE_ID,
        actorId: "lease-actor",
        isSpaceManager: true,
        embedOrigin: "https://busa.test",
      },
      fn,
    );

  beforeAll(async () => {
    ({ db } = await seedScenario("agent-operation-leases"));
  });

  afterEach(async () => {
    for (const id of sessionIds.splice(0)) {
      await inScope(() => closeAgentSession(id)).catch(() => {});
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("../src/context");
    vi.doUnmock("../src/db");
    mocks.createWebSocketStream.mockReset();
  });

  async function insertSession(id: string) {
    vi.stubEnv("BUSABASE_AGENT_SESSION_LEASE_TTL_SECONDS", "3");
    sessionIds.push(id);
    await db.insert(busabaseAgentSessions).values({
      id,
      spaceId: LOCAL_SPACE_ID,
      actorId: "lease-actor",
      slug: "lease-test",
      agentName: "Lease Test",
      transport: "remote-websocket",
      status: "idle",
      acpSessionId: `acp-${id}`,
    });
  }

  async function row(id: string) {
    const [session] = await db
      .select()
      .from(busabaseAgentSessions)
      .where(eq(busabaseAgentSessions.id, id));
    if (!session) throw new Error(`Missing session ${id}`);
    return session;
  }

  it("persists overlapping Buda echoes and lifecycle events exactly once around a gated user insert", async () => {
    const id = "ags_buda_journal_overlap";
    await insertSession(id);
    const agent = fakeAgent({ budaEventStream: true });
    await inScope(() => promptAgentSession(id, "hi"));
    const before = await inScope(() => loadSessionEvents(id, -1));
    const afterSeq = before.at(-1)?.seq ?? -1;
    const writeGate = gate();
    const entered = gate();
    const persist = sessionStore.persistSessionEvents;
    const pendingInserts: AgentSessionEventVO[][] = [];
    let userWritePending = false;
    vi.spyOn(sessionStore, "persistSessionEvents").mockImplementation(async (...args) => {
      const events = args[0];
      if (events.some((event) => (event.acpUpdate as { text?: string })?.text === "PDF prompt")) {
        userWritePending = true;
        entered.resolve();
        await writeGate.promise;
        userWritePending = false;
      } else if (userWritePending) {
        pendingInserts.push(events);
      }
      return persist(...args);
    });
    const onAccepted = vi.fn();
    const prompt = inScope(() => promptAgentSession(id, "PDF prompt", undefined, { onAccepted }));
    try {
      await entered.promise;
      await agent.notify(acp.methods.client.session.update, {
        sessionId: `acp-${id}`,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "earlier-user",
          content: { type: "text", text: "Earlier Buda echo" },
          _meta: { "buda.im": { seq: 10 } },
        },
      });
      await agent.notify("_buda.im/session_event", {
        sessionId: `acp-${id}`,
        event: {
          version: 1,
          type: "job_update",
          turnId: "earlier-turn",
          at: "2026-10-30T00:00:00Z",
          job: { id: "background-job", title: "Background job", status: "completed" },
        },
        _meta: { "buda.im": { seq: 11 } },
      });
      const live = (
        globalThis as typeof globalThis & {
          __busabaseAgentSessions: Map<
            string,
            {
              seq: number;
              persistedSeq: number;
              buffer: AgentSessionEventVO[];
            }
          >;
        }
      ).__busabaseAgentSessions.get(id);
      if (!live) throw new Error("Expected the live Buda session");
      await vi.waitFor(() =>
        expect(live.buffer.filter((event) => event.seq > afterSeq)).toHaveLength(2),
      );
      expect(onAccepted).not.toHaveBeenCalled();
      expect(agent.prompts).toEqual(["hi"]);
      writeGate.resolve();
      await prompt;
      const events = await inScope(() => loadSessionEvents(id, afterSeq));
      expect(pendingInserts).toEqual([]);
      expect(events.slice(0, 3)).toMatchObject([
        { acpUpdate: { sessionUpdate: "user_message", text: "PDF prompt" } },
        {
          acpUpdate: {
            sessionUpdate: "user_message_chunk",
            content: { text: "Earlier Buda echo" },
          },
        },
        { acpExtension: { method: "_buda.im/session_event" } },
      ]);
      expect(
        events.filter((event) => event.kind === "acpUpdate" || event.kind === "acpExtension"),
      ).toHaveLength(3);
      const seqs = events.map((event) => event.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(live.seq).toBe(events.at(-1)?.seq);
      expect(live.persistedSeq).toBe(live.seq);
      expect(onAccepted).toHaveBeenCalledOnce();
      expect(agent.prompts).toEqual(["hi", "PDF prompt"]);
      expect(await row(id)).toMatchObject({ status: "idle", leaseOwnerId: null });
    } finally {
      writeGate.resolve();
      await prompt.catch(() => {});
    }
  });

  const promptContext = () =>
    createPromptResourceContext(
      createAgentPromptEnvelope({
        scenario: { id: "find", title: "Find records" },
        target: { nodeId: "node-that-is-not-fetched", nodeName: "完整目标", nodeType: "base" },
        source: { origin: "https://busa.test", edition: "desktop" },
        segments: [
          { kind: "target", text: "Target: 完整目标" },
          { kind: "task", text: "Immutable task\n保留所有文本  " },
        ],
      }),
      "db-context-1",
    );

  it.each([true, false])(
    "persists exact prompt context for reattached ACP dispatch and replay, embedded=%s",
    async (embeddedContext) => {
      const id = `ags_prompt_context_${embeddedContext}`;
      await insertSession(id);
      const agent = fakeAgent({ embeddedContext });
      const context = promptContext();
      // insertSession persisted an inactive session; this prompt must load the
      // durable identity and reattach before the actual ACP SDK dispatch.
      await inScope(() =>
        promptAgentSession(id, "Only the latest", undefined, { resourceContext: [context] }),
      );
      const sent = agent.promptContents[0];
      expect(sent).toHaveLength(2);
      expect(sent?.[0]).toEqual({ type: "text", text: "Only the latest" });
      expect(sent?.[1]).toMatchObject(
        embeddedContext
          ? {
              type: "resource",
              resource: { uri: context.uri, mimeType: "text/plain", text: context.text },
            }
          : { type: "text", text: context.text },
      );
      const events = await inScope(() => loadSessionEvents(id, -1));
      const event = events.find(
        (entry) =>
          (entry.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
      );
      expect(event?.acpUpdate).toEqual({
        sessionUpdate: "user_message",
        text: "Only the latest",
        resourceContext: [context],
      });
      if (!event) throw new Error("Missing durable prompt context");
      const replay = reduceAcpEvents(
        [],
        translateAgentSessionEvent(JSON.parse(JSON.stringify(event))),
      );
      expect(replay).toHaveLength(1);
      expect(replay[0]).toMatchObject({
        role: "user",
        text: "Only the latest",
        attachments: [
          {
            resource: {
              resource: { uri: context.uri, text: context.text },
              _meta: { "acp-ui.resourceContext": { id: context.id, name: context.name } },
            },
          },
        ],
      });
      expect(
        events.some(
          (entry) =>
            (entry.acpUpdate as { sessionUpdate?: string; text?: string })?.sessionUpdate ===
              "note" &&
            (entry.acpUpdate as { text?: string }).text?.includes("complete prompt context"),
        ),
      ).toBe(!embeddedContext);
      expect(await row(id)).toMatchObject({ status: "idle", leaseOwnerId: null });
    },
  );

  it("rejects another actor's context-only send without recording, disclosing or dispatching its session", async () => {
    const id = "ags_context_unauthorized";
    await insertSession(id);
    const agent = fakeAgent({ embeddedContext: true });
    await expect(
      runWithBusabaseContext(
        {
          db,
          spaceId: LOCAL_SPACE_ID,
          actorId: "other-actor",
          isSpaceManager: true,
          embedOrigin: "https://busa.test",
        },
        () => promptAgentSession(id, "", undefined, { resourceContext: [promptContext()] }),
      ),
    ).rejects.toThrow();
    expect(agent.promptContents).toEqual([]);
    expect(await inScope(() => loadSessionEvents(id, -1))).toEqual([]);
    expect(await row(id)).toMatchObject({ status: "idle", leaseOwnerId: null });
  });

  it("rejects mismatched source before event acceptance and leaves a persisted session available for valid retry", async () => {
    const id = "ags_context_source_mismatch";
    await insertSession(id);
    const agent = fakeAgent({ embeddedContext: true });
    const context = promptContext();
    const mismatched = createPromptResourceContext(
      createAgentPromptEnvelope({
        ...context.metadata["busabase.agentPrompt"],
        source: { origin: "https://other.test", edition: "desktop" },
      }),
      context.id,
    );
    await expect(
      inScope(() => promptAgentSession(id, "", undefined, { resourceContext: [mismatched] })),
    ).rejects.toThrow(/different Busabase/);
    expect(agent.promptContents).toEqual([]);
    expect(
      (await inScope(() => loadSessionEvents(id, -1))).some(
        (entry) =>
          (entry.acpUpdate as { sessionUpdate?: string })?.sessionUpdate === "user_message",
      ),
    ).toBe(false);
    await inScope(() => promptAgentSession(id, "", undefined, { resourceContext: [context] }));
    expect(agent.promptContents[0]?.[1]).toMatchObject({
      type: "resource",
      resource: { text: context.text },
    });
  });

  it("persists user presentation in PGLite while the ACP agent receives the complete prompt", async () => {
    const id = "ags_lease_prompt_presentation";
    await insertSession(id);
    const agent = fakeAgent();
    const text = 'Target: the Busabase Base "CEO 指令" (nodeId: nod_ceo).\n\n这个不做。';
    const presentation = {
      version: 1 as const,
      source: "node-context" as const,
      text: "这个不做。",
    };

    await inScope(() => promptAgentSession(id, text, undefined, { presentation }));

    expect(agent.prompts).toEqual([text]);
    // Read from the actual event table, not the live session's buffer.
    const events = await inScope(() => loadSessionEvents(id, -1));
    const event = events.find(
      (entry) =>
        (entry.acpUpdate as { sessionUpdate?: string } | undefined)?.sessionUpdate ===
        "user_message",
    );
    expect(event?.acpUpdate).toEqual({ sessionUpdate: "user_message", text, presentation });
    if (!event) throw new Error("The persisted user message is missing");
    expect(reduceAcpEvents([], translateAgentSessionEvent(event))).toMatchObject([
      { kind: "message", role: "user", text: "这个不做。" },
    ]);
    expect(await row(id)).toMatchObject({ status: "idle", leaseOwnerId: null });
  });

  it("renews throughout slow session/load and releases only after the completed prompt is persisted", async () => {
    const id = "ags_lease_slow_load";
    await insertSession(id);
    const renewal = vi.spyOn(
      await import("../src/domains/agents/logic/agent-session-store"),
      "renewSessionLease",
    );
    const load = gate();
    const agent = fakeAgent({ loadGate: load.promise });
    const operation = inScope(() => promptAgentSession(id, "after startup"));
    await agent.loaded;
    const claimed = await row(id);
    try {
      await new Promise((done) => setTimeout(done, 3_400));
      const renewed = await row(id);
      expect(renewed.leaseOwnerId).toBe(claimed.leaseOwnerId);
      expect(renewed.leaseFencingToken).toBe(claimed.leaseFencingToken);
      expect(renewed.leaseExpiresAt?.getTime()).toBeGreaterThan(
        claimed.leaseExpiresAt?.getTime() ?? 0,
      );
      expect(await inScope(() => acquireSessionLease(id, "other-worker"))).toBeNull();
      expect(agent.prompts).toEqual([]);
    } finally {
      load.resolve();
    }
    await operation;
    expect(agent.prompts).toEqual(["after startup"]);
    expect(await row(id)).toMatchObject({
      status: "idle",
      leaseOwnerId: null,
      leaseExpiresAt: null,
    });
    const events = await inScope(() => loadSessionEvents(id, -1));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "acpUpdate",
          acpUpdate: expect.objectContaining({ sessionUpdate: "user_message" }),
        }),
        expect.objectContaining({ kind: "status", status: "idle" }),
      ]),
    );
    const renewalCount = renewal.mock.calls.length;
    expect(renewalCount).toBeGreaterThan(1);
    await new Promise((done) => setTimeout(done, 1_200));
    expect(renewal).toHaveBeenCalledTimes(renewalCount);
  });

  it("blocks prompt after lease takeover during startup and preserves the new owner's fence", async () => {
    const id = "ags_lease_startup_takeover";
    await insertSession(id);
    const load = gate();
    const agent = fakeAgent({ loadGate: load.promise });
    const operation = inScope(() => promptAgentSession(id, "must not send"));
    const outcome = operation.then(
      () => null,
      (error: unknown) => error,
    );
    await agent.loaded;
    await db
      .update(busabaseAgentSessions)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(busabaseAgentSessions.id, id));
    const replacement = await inScope(() => acquireSessionLease(id, "replacement-worker", 30));
    expect(replacement).not.toBeNull();
    await new Promise((done) => setTimeout(done, 1_200));
    load.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    expect(agent.prompts).toEqual([]);
    expect(await row(id)).toMatchObject({
      leaseOwnerId: "replacement-worker",
      leaseFencingToken: replacement?.fencingToken,
      status: "busy",
    });
  });

  it("keeps renewing while permission is pending and blocks another worker until final completion", async () => {
    const id = "ags_lease_permission";
    await insertSession(id);
    fakeAgent({ permission: true });
    const operation = inScope(() => promptAgentSession(id, "ask permission"));
    await vi.waitFor(async () =>
      expect((await inScope(() => loadSessionRuntime(id)))?.session.status).toBe(
        "waiting_permission",
      ),
    );
    const claimed = await row(id);
    await new Promise((done) => setTimeout(done, 6_400));
    expect(await row(id)).toMatchObject({
      status: "waiting_permission",
      leaseOwnerId: claimed.leaseOwnerId,
    });
    expect((await row(id)).leaseExpiresAt?.getTime()).toBeGreaterThan(
      claimed.leaseExpiresAt?.getTime() ?? 0,
    );
    expect(await inScope(() => acquireSessionLease(id, "other-worker"))).toBeNull();
    const live = (
      globalThis as typeof globalThis & {
        __busabaseAgentSessions?: Map<string, { buffer: AgentSessionEventVO[] }>;
      }
    ).__busabaseAgentSessions?.get(id);
    const request = live?.buffer.findLast((event) => event.kind === "permissionRequest");
    const requestId = request?.permissionRequest?.requestId;
    if (!requestId) throw new Error("Missing permission request");
    await inScope(async () => respondToAgentPermission(id, requestId, "allow"));
    await operation;
    expect(await row(id)).toMatchObject({
      status: "idle",
      leaseOwnerId: null,
      leaseExpiresAt: null,
    });
    expect(await inScope(() => acquireSessionLease(id, "next-worker"))).not.toBeNull();
  });

  it("answers concurrent permission requests in any order under the real lease fence", async () => {
    const id = "ags_lease_parallel_permissions";
    await insertSession(id);
    const agent = fakeAgent({ parallelPermissions: ["Read the base", "List the records"] });
    const operation = inScope(() => promptAgentSession(id, "two tools at once"));
    const requestIds = () =>
      (
        (
          globalThis as typeof globalThis & {
            __busabaseAgentSessions?: Map<string, { buffer: AgentSessionEventVO[] }>;
          }
        ).__busabaseAgentSessions?.get(id)?.buffer ?? []
      )
        .filter((event) => event.kind === "permissionRequest")
        .map((event) => event.permissionRequest?.requestId ?? "missing");
    await vi.waitFor(() => expect(requestIds()).toHaveLength(2));
    await vi.waitFor(async () => expect((await row(id)).status).toBe("waiting_permission"));
    const [first, second] = requestIds();

    await inScope(async () => respondToAgentPermission(id, second ?? "missing", "deny"));
    await vi.waitFor(() => expect(agent.permissionOutcomes).toHaveLength(1));
    // Durable state too: still waiting on the first card, same lease owner.
    expect(await row(id)).toMatchObject({ status: "waiting_permission" });
    expect((await row(id)).leaseOwnerId).not.toBeNull();

    await inScope(async () => respondToAgentPermission(id, first ?? "missing", "allow"));
    await operation;
    expect(agent.permissionOutcomes).toEqual([
      { title: "List the records", outcome: { outcome: "selected", optionId: "deny" } },
      { title: "Read the base", outcome: { outcome: "selected", optionId: "allow" } },
    ]);
    expect(await row(id)).toMatchObject({
      status: "idle",
      leaseOwnerId: null,
      leaseExpiresAt: null,
    });
  });

  it.each(["prompt", "config"] as const)(
    "shares retained-socket guards across module instances and rechecks ownership before %s dispatch",
    async (kind) => {
      const id = `ags_lease_modules_${kind}`;
      await insertSession(id);
      const agent = fakeAgent({ model: true });
      await inScope(() => promptAgentSession(id, "instance A"));

      // Re-evaluate the manager while forwarding the same real request context
      // and database. Its module-local state is fresh; the retained socket is not.
      vi.doMock("../src/context", () => originalContext);
      vi.doMock("../src/db", () => originalDb);
      vi.resetModules();
      const managerB = await import("../src/domains/agents/logic/agent-session-manager");
      const storeB = await import("../src/domains/agents/logic/agent-session-store");
      const renewal = vi.spyOn(storeB, "renewSessionLease");
      expect(managerB.promptAgentSession).not.toBe(promptAgentSession);
      if (kind === "prompt") {
        await inScope(() => managerB.promptAgentSession(id, "instance B"));
        expect(agent.prompts).toEqual(["instance A", "instance B"]);
      } else {
        await inScope(() => managerB.setAgentSessionConfigOption(id, "model", "fast"));
        expect(agent.configChanges).toEqual(["fast"]);
      }
      expect(mocks.createWebSocketStream).toHaveBeenCalledTimes(1);
      expect(await row(id)).toMatchObject({ leaseOwnerId: null, leaseExpiresAt: null });

      const live = (
        globalThis as typeof globalThis & {
          __busabaseAgentSessions?: Map<string, { ready: Promise<void>; lease: unknown }>;
        }
      ).__busabaseAgentSessions?.get(id);
      if (!live) throw new Error("Missing retained session");
      const ready = gate();
      live.ready = ready.promise;
      const previousToken = (await row(id)).leaseFencingToken;
      const previousRenewals = renewal.mock.results.length;
      const accepted = gate();
      const operation = inScope(async () => {
        if (kind === "prompt")
          await managerB.promptAgentSession(id, "must not dispatch", undefined, {
            onAccepted: accepted.resolve,
          });
        else await managerB.setAgentSessionConfigOption(id, "model", "auto");
      });
      const outcome = operation.then(
        () => null,
        (error: unknown) => error,
      );
      try {
        await vi.waitFor(async () => {
          const claimed = await row(id);
          expect(claimed.leaseFencingToken).toBeGreaterThan(previousToken);
          expect(claimed.leaseOwnerId).toBeTruthy();
          expect(renewal.mock.results.length).toBeGreaterThan(previousRenewals);
        });
        // Observe the real SQL renewal completing before taking ownership;
        // no mocked persistence result controls the dispatch-time check.
        expect(await renewal.mock.results[previousRenewals]?.value).toBe(true);
        if (kind === "prompt") await accepted.promise;
        await db
          .update(busabaseAgentSessions)
          .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
          .where(eq(busabaseAgentSessions.id, id));
        const replacement = await inScope(() => acquireSessionLease(id, "module-replacement", 30));
        expect(replacement).not.toBeNull();
        ready.resolve();
        expect(await outcome).toBeInstanceOf(Error);
        expect(agent.prompts).toEqual(
          kind === "prompt" ? ["instance A", "instance B"] : ["instance A"],
        );
        expect(agent.configChanges).toEqual(kind === "config" ? ["fast"] : []);
        expect(await row(id)).toMatchObject({
          leaseOwnerId: "module-replacement",
          leaseFencingToken: replacement?.fencingToken,
          status: "busy",
        });
        expect(live.lease).toBeNull();
        const renewalsAfterFailure = renewal.mock.calls.length;
        await new Promise((done) => setTimeout(done, 1_200));
        expect(renewal).toHaveBeenCalledTimes(renewalsAfterFailure);
      } finally {
        ready.resolve();
        await outcome;
      }
    },
  );
});
