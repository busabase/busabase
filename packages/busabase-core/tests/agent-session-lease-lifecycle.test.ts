import type { Stream } from "@agentclientprotocol/sdk";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as originalContext from "../src/context";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import * as originalDb from "../src/db";
import { busabaseAgentSessions } from "../src/db/schema";
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
  options: { loadGate?: Promise<void>; permission?: boolean; model?: boolean } = {},
) {
  const aToB = new TransformStream();
  const bToA = new TransformStream();
  mocks.createWebSocketStream.mockReturnValue({
    writable: aToB.writable,
    readable: bToA.readable,
  });
  const loaded = gate();
  const prompts: string[] = [];
  const configChanges: string[] = [];
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
      agentCapabilities: { loadSession: true },
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
      return { stopReason: "end_turn" as const };
    })
    .onNotification(acp.methods.agent.session.cancel, () => {})
    .connectWith({ readable: aToB.readable, writable: bToA.writable }, () => new Promise(() => {}))
    .catch(() => {});
  return { loaded: loaded.promise, prompts, configChanges };
}

describe("operation lease lifecycle with real ACP and PGLite persistence", () => {
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  const sessionIds: string[] = [];
  const inScope = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext(
      { db, spaceId: LOCAL_SPACE_ID, actorId: "lease-actor", isSpaceManager: true },
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
