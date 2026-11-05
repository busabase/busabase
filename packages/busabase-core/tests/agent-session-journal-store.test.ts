import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseAgentSessionCommands, busabaseAgentSessions } from "../src/db/schema";
import {
  admitSessionCommand,
  appendJournalEvents,
  claimSessionCommands,
  claimWriterLease,
  createJournalSession,
  enableSessionJournal,
  expireSessionCommands,
  getJournalRuntime,
  hasPendingSessionCommands,
  listSessionCommandDemand,
  loadSessionCommand,
  loadSessionCommands,
  releaseWriterLease,
  touchJournalDemand,
  transitionSessionCommand,
  updateJournalRuntime,
} from "../src/domains/agents/logic/agent-session-journal-store";
import {
  loadSessionEvents,
  loadSessionRuntime,
  loadSessions,
  persistSessionAcpIdentity,
  persistSessionCreated,
  persistSessionEvents,
} from "../src/domains/agents/logic/agent-session-store";
import { seedScenario } from "./helpers/seed-scenario";

describe("session journal transactions against real PGLite", () => {
  let db: Awaited<ReturnType<typeof seedScenario>>["db"];
  let count = 0;
  const scope = { spaceId: LOCAL_SPACE_ID, actorId: "journal-actor" };
  const otherScope = { ...scope, actorId: "another-actor" };
  const run = <T>(fn: () => Promise<T>) =>
    runWithBusabaseContext({ db, ...scope, isSpaceManager: true }, fn);
  beforeAll(async () => {
    ({ db } = await seedScenario("agent-session-journal"));
  });
  beforeEach(() => {
    vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function session() {
    const id = `ags_journal_${++count}`;
    const now = new Date().toISOString();
    const vo: AgentSessionVO = {
      id,
      slug: "buda:test",
      agentName: "Test",
      transport: "remote-websocket",
      status: "idle",
      createdAt: now,
      lastActivityAt: now,
      error: null,
      modelOption: null,
    };
    await run(() => createJournalSession(vo, scope));
    return id;
  }
  const event = (identity: string, text = "same text", sourceSeq?: number) => ({
    identity,
    ...(sourceSeq === undefined ? {} : { sourceSeq }),
    event: {
      kind: "acpUpdate" as const,
      at: new Date().toISOString(),
      acpUpdate: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });

  it("requires the explicit rollout gate before atomic supervised creation", async () => {
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "false");
    await expect(session()).rejects.toThrow(/legacy-writer drain/);
  });

  it("claims one writer and rejects old unfenced legacy callers", async () => {
    const id = await session();
    const [a, b] = await Promise.all([
      run(() => claimWriterLease(id, "writer-A", 30, scope)),
      run(() => claimWriterLease(id, "writer-B", 30, scope)),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const writer = a ?? b;
    if (!writer) throw new Error("Missing writer");
    expect(
      await run(() =>
        persistSessionEvents([
          { sessionId: id, seq: 1, kind: "status", status: "idle", at: new Date().toISOString() },
        ]),
      ),
    ).toBe(false);
    const appended = await run(() => appendJournalEvents(id, [event("source-1")], writer, scope));
    expect(appended).toMatchObject({ outcome: "committed", events: [{ seq: 1 }] });
  });

  it("keeps unresolved work visible to idle polling without crossing actor scope", async () => {
    const id = await session();
    expect(await run(() => hasPendingSessionCommands(id, scope))).toBe(false);
    await run(() =>
      admitSessionCommand(
        id,
        {
          commandId: "cmd_polling_scope",
          kind: "prompt",
          payload: { text: "saved work" },
        },
        scope,
      ),
    );
    expect(await run(() => hasPendingSessionCommands(id, scope))).toBe(true);
    expect(await run(() => hasPendingSessionCommands(id, otherScope))).toBe(false);
    const writer = await run(() => claimWriterLease(id, "polling-writer", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() => claimSessionCommands(id, writer, scope));
    expect(
      await run(() =>
        transitionSessionCommand(
          id,
          "cmd_polling_scope",
          ["claimed"],
          "dispatching",
          writer,
          scope,
        ),
      ),
    ).toBe(true);
    expect(
      await run(() =>
        transitionSessionCommand(
          id,
          "cmd_polling_scope",
          ["dispatching"],
          "unknown",
          writer,
          scope,
        ),
      ),
    ).toBe(true);
    expect(await run(() => hasPendingSessionCommands(id, scope))).toBe(true);
    expect(
      await run(() =>
        transitionSessionCommand(id, "cmd_polling_scope", ["unknown"], "completed", writer, scope),
      ),
    ).toBe(true);
    expect(await run(() => hasPendingSessionCommands(id, scope))).toBe(false);
  });

  it("applies the discovery limit after excluding healthy owners so another worker can claim later demand", async () => {
    const owned = await session();
    const waiting = await session();
    await db
      .update(busabaseAgentSessions)
      .set({ lastActivityAt: new Date("2000-01-01") })
      .where(eq(busabaseAgentSessions.id, owned));
    await db
      .update(busabaseAgentSessions)
      .set({ lastActivityAt: new Date("2001-01-01") })
      .where(eq(busabaseAgentSessions.id, waiting));
    expect(await run(() => claimWriterLease(owned, "other-worker", 30, scope))).not.toBeNull();
    expect((await listSessionCommandDemand(db, 1)).map((row) => row.sessionId)).toEqual([owned]);
    expect((await listSessionCommandDemand(db, 1, true)).map((row) => row.sessionId)).toEqual([
      waiting,
    ]);
    const nextOwner = await run(() => claimWriterLease(waiting, "new-worker", 30, scope));
    expect(nextOwner).not.toBeNull();
    expect((await listSessionCommandDemand(db, 1, true)).map((row) => row.sessionId)).not.toContain(
      owned,
    );
  });

  it("deduplicates identical committed retries and keeps distinct repeated text", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    const first = await run(() => appendJournalEvents(id, [event("source-1")], writer, scope));
    expect(first).toMatchObject({ outcome: "committed", events: [{ seq: 1 }] });
    expect(
      await run(() => appendJournalEvents(id, [event("source-1")], writer, scope)),
    ).toMatchObject({ outcome: "already_committed", events: [{ seq: 1 }] });
    expect(
      await run(() => appendJournalEvents(id, [event("source-2")], writer, scope)),
    ).toMatchObject({ outcome: "committed", events: [{ seq: 2 }] });
    expect(await run(() => loadSessionEvents(id, -1))).toHaveLength(2);
  });

  it("rolls back a whole conflicting batch and its checkpoint", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      appendJournalEvents(id, [event("source-1", "original", 10)], writer, scope, {
        sourceSeq: 10,
        sourceGeneration: "generation-A",
      }),
    );
    const conflict = await run(() =>
      appendJournalEvents(
        id,
        [event("source-2", "new", 11), event("source-1", "altered", 10)],
        writer,
        scope,
        { sourceSeq: 11, sourceGeneration: "generation-A" },
      ),
    );
    expect(conflict.outcome).toBe("integrity_failure");
    expect(await run(() => loadSessionEvents(id, -1))).toHaveLength(1);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({ sourceCheckpoint: 10 });
    expect(
      await run(() => appendJournalEvents(id, [event("source-3")], writer, scope)),
    ).toMatchObject({ events: [{ seq: 2 }] });
  });

  it("fences stale epochs after takeover and isolates another scope", async () => {
    const id = await session();
    const a = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!a) throw new Error("Missing writer");
    await db
      .update(busabaseAgentSessions)
      .set({ writerExpiresAt: new Date(0) })
      .where(eq(busabaseAgentSessions.id, id));
    const b = await run(() => claimWriterLease(id, "writer-B", 30, scope));
    if (!b) throw new Error("Missing replacement writer");
    expect(b.epoch).toBeGreaterThan(a.epoch);
    expect((await run(() => appendJournalEvents(id, [event("stale")], a, scope))).outcome).toBe(
      "ownership_lost",
    );
    expect(
      (await run(() => appendJournalEvents(id, [event("foreign")], b, otherScope))).outcome,
    ).toBe("ownership_lost");
    expect(await run(() => getJournalRuntime(id, otherScope))).toBeNull();
    expect(await run(() => appendJournalEvents(id, [event("current")], b, scope))).toMatchObject({
      outcome: "committed",
      events: [{ seq: 1 }],
    });
    expect(await run(() => releaseWriterLease(id, a, scope))).toBe(false);
  });

  it("atomically accepts one prompt and returns its receipt after a lost acknowledgement", async () => {
    const id = await session();
    const command = {
      commandId: "command_first",
      kind: "prompt" as const,
      payload: { text: "hello" },
    };
    const [a, b] = await Promise.all([
      run(() => admitSessionCommand(id, command, scope)),
      run(() => admitSessionCommand(id, { ...command, commandId: "command_second" }, scope)),
    ]);
    expect([a, b].map((r) => r.outcome).sort()).toEqual(["accepted", "busy"]);
    const accepted =
      a.outcome === "accepted" ? command : { ...command, commandId: "command_second" };
    expect(await run(() => admitSessionCommand(id, accepted, scope))).toMatchObject({
      outcome: "already_accepted",
      receipt: { state: "queued" },
    });
    expect(
      await run(() =>
        admitSessionCommand(id, { ...accepted, payload: { text: "changed" } }, scope),
      ),
    ).toEqual({ outcome: "conflict" });
    const listed = await run(() => loadSessions());
    expect(listed.find((s) => s.id === id)?.pendingCommands).toHaveLength(1);
    expect(await run(() => loadSessionEvents(id, -1))).toEqual([]);
  });

  it("does not re-claim active controls and keeps unknown execution reserved", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_prompt", kind: "prompt", payload: { text: "hi" } },
        scope,
      ),
    );
    expect(await run(() => claimSessionCommands(id, writer, scope))).toHaveLength(1);
    await run(() =>
      transitionSessionCommand(id, "command_prompt", ["claimed"], "dispatching", writer, scope),
    );
    await run(() =>
      admitSessionCommand(
        id,
        {
          commandId: "command_cancel",
          kind: "cancel",
          targetCommandId: "command_prompt",
          payload: {},
        },
        scope,
      ),
    );
    expect(await run(() => claimSessionCommands(id, writer, scope, "control"))).toHaveLength(1);
    expect(await run(() => claimSessionCommands(id, writer, scope, "control"))).toHaveLength(0);
    await run(() =>
      transitionSessionCommand(id, "command_prompt", ["dispatching"], "unknown", writer, scope),
    );
    await run(() => updateJournalRuntime(id, { executionState: "unknown" }, writer, scope));
    await db
      .update(busabaseAgentSessions)
      .set({ demandUntil: new Date(0) })
      .where(eq(busabaseAgentSessions.id, id));
    expect(await listSessionCommandDemand(db)).not.toContainEqual({ sessionId: id, ...scope });
    await run(() => touchJournalDemand(id, scope));
    expect(await listSessionCommandDemand(db)).toContainEqual({ sessionId: id, ...scope });
    expect(
      await run(() =>
        admitSessionCommand(
          id,
          { commandId: "command_another", kind: "prompt", payload: { text: "again" } },
          scope,
        ),
      ),
    ).toEqual({ outcome: "unavailable" });
    await run(() =>
      transitionSessionCommand(id, "command_prompt", ["unknown"], "completed", writer, scope),
    );
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({ activeCommandId: null });
  });

  it("stores fenced creation state and discovers demand using the explicit host database", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    expect(
      await run(() =>
        updateJournalRuntime(
          id,
          { creationState: "dispatching", executionState: "unknown", syncState: "recovering" },
          writer,
          scope,
        ),
      ),
    ).toBe(true);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      creationState: "dispatching",
      session: { reliability: { execution: "unknown" } },
    });
    expect(await listSessionCommandDemand(db)).toContainEqual({ sessionId: id, ...scope });
    await db.execute(sql`select 1`);
  });

  it("does not overwrite a reserved command with a delayed startup idle transition", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_reserved", kind: "prompt", payload: { text: "hello" } },
        scope,
      ),
    );
    await run(() => updateJournalRuntime(id, { executionState: "idle" }, writer, scope));
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_reserved",
      session: { reliability: { execution: "reserved" } },
    });
  });

  it("expires undispatched reservations but keeps dispatched work unknown and reserved", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_expired", kind: "prompt", payload: { text: "hello" } },
        scope,
      ),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    expect(await run(() => claimSessionCommands(id, writer, scope))).toEqual([]);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({ activeCommandId: null });
    expect(
      await run(() =>
        admitSessionCommand(
          id,
          { commandId: "command_expired", kind: "prompt", payload: { text: "hello" } },
          scope,
        ),
      ),
    ).toMatchObject({ receipt: { state: "rejected" } });

    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_sent", kind: "prompt", payload: { text: "execute" } },
        scope,
      ),
    );
    await run(() => claimSessionCommands(id, writer, scope));
    await run(() =>
      transitionSessionCommand(id, "command_sent", ["claimed"], "dispatching", writer, scope),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    expect(await run(() => claimSessionCommands(id, writer, scope))).toEqual([]);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_sent",
      session: { reliability: { execution: "unknown" } },
    });
    expect(
      await run(() =>
        admitSessionCommand(
          id,
          { commandId: "command_after", kind: "prompt", payload: { text: "retry" } },
          scope,
        ),
      ),
    ).toEqual({ outcome: "unavailable" });
  });

  it("keeps generic recovery history isolated and rejects new work after a gap", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    const command = {
      commandId: "command_known",
      kind: "prompt" as const,
      payload: { text: "hi" },
    };
    await run(() => admitSessionCommand(id, command, scope));
    const recoverySnapshot = {
      capturedAt: new Date().toISOString(),
      complete: true,
      truncated: false,
      updates: [
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "isolated recovered history" },
        },
      ],
    };
    await run(() =>
      updateJournalRuntime(id, { syncState: "gap", recoverySnapshot }, writer, scope),
    );
    expect(await run(() => admitSessionCommand(id, command, scope))).toMatchObject({
      outcome: "already_accepted",
    });
    expect(
      await run(() => admitSessionCommand(id, { ...command, commandId: "command_new" }, scope)),
    ).toEqual({ outcome: "unavailable" });
    expect(await listSessionCommandDemand(db)).not.toContainEqual({ sessionId: id, ...scope });
    expect((await run(() => loadSessions())).find((s) => s.id === id)?.recoverySnapshot).toEqual(
      recoverySnapshot,
    );
    expect(await run(() => loadSessionEvents(id, -1))).toEqual([]);
  });

  it("does not repeatedly demand an unknown generic create without negotiated receipts", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      updateJournalRuntime(
        id,
        { creationState: "unknown", capabilities: { commandReceipts: false } },
        writer,
        scope,
      ),
    );
    expect(await listSessionCommandDemand(db)).not.toContainEqual({ sessionId: id, ...scope });
    expect(
      await run(() =>
        admitSessionCommand(
          id,
          { commandId: "command_new", kind: "prompt", payload: { text: "hi" } },
          scope,
        ),
      ),
    ).toEqual({ outcome: "unavailable" });
    await run(() =>
      updateJournalRuntime(id, { capabilities: { commandReceipts: true } }, writer, scope),
    );
    expect(await listSessionCommandDemand(db)).toContainEqual({ sessionId: id, ...scope });
  });

  it("maps only verified historical source identities without rewriting old events or advancing a cursor", async () => {
    const id = `ags_legacy_mapping_${++count}`;
    const now = new Date().toISOString();
    await run(() =>
      persistSessionCreated(
        {
          id,
          slug: "buda:test",
          agentName: "Legacy",
          transport: "remote-websocket",
          status: "idle",
          createdAt: now,
          lastActivityAt: now,
          error: null,
          modelOption: null,
        },
        scope,
      ),
    );
    await run(() => persistSessionAcpIdentity(id, "remote_original", scope));
    const historical = {
      sessionId: id,
      seq: 7,
      kind: "acpUpdate" as const,
      at: now,
      acpUpdate: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "historical" },
        _meta: { "buda.im": { seq: 10 } },
      },
    };
    expect(await run(() => persistSessionEvents([historical], undefined, scope))).toBe(true);
    expect(await run(() => enableSessionJournal(id, scope))).toBe(true);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({ sourceCheckpoint: null });
    const writer = await run(() => claimWriterLease(id, "writer-A", 30, scope));
    if (!writer) throw new Error("Missing writer");
    const replayed = {
      ...historical,
      at: new Date().toISOString(),
      acpUpdate: { ...historical.acpUpdate, _meta: { "buda.im": { seq: 10, replay: true } } },
    };
    expect(
      await run(() =>
        appendJournalEvents(
          id,
          [{ identity: `${id}_1:remote:10`, event: replayed, sourceSeq: 10 }],
          writer,
          scope,
        ),
      ),
    ).toMatchObject({ outcome: "already_committed", events: [{ seq: 7 }] });
    expect(await run(() => loadSessionEvents(id, -1))).toEqual([historical]);
  });

  it("refuses ambiguous source history and unidentified generic messages atomically", async () => {
    for (const identified of [true, false]) {
      const id = `ags_legacy_ambiguous_${++count}`;
      const now = new Date().toISOString();
      await run(() =>
        persistSessionCreated(
          {
            id,
            slug: "buda:test",
            agentName: "Legacy",
            transport: "remote-websocket",
            status: "idle",
            createdAt: now,
            lastActivityAt: now,
            error: null,
            modelOption: null,
          },
          scope,
        ),
      );
      await run(() => persistSessionAcpIdentity(id, "remote_original", scope));
      const events = [1, 2].map((seq) => ({
        sessionId: id,
        seq,
        kind: "acpUpdate" as const,
        at: now,
        acpUpdate: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `different-${seq}` },
          ...(identified ? { _meta: { "buda.im": { seq: 10 } } } : {}),
        },
      }));
      expect(await run(() => persistSessionEvents(events, undefined, scope))).toBe(true);
      expect(await run(() => enableSessionJournal(id, scope))).toBe(false);
      expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
        journalMode: "legacy",
      });
      expect(await run(() => loadSessionEvents(id, -1))).toEqual(events);
    }
  });

  it("caps pending controls while allowing the same accepted identity to retry at capacity", async () => {
    vi.stubEnv("BUSABASE_AGENT_MAX_PENDING_COMMANDS", "2");
    const id = await session();
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_capacity_prompt", kind: "prompt", payload: { text: "pending" } },
        scope,
      ),
    );
    const control = { commandId: "command_capacity_control", kind: "cancel" as const, payload: {} };
    expect(await run(() => admitSessionCommand(id, control, scope))).toMatchObject({
      outcome: "accepted",
    });
    expect(
      await run(() =>
        admitSessionCommand(id, { ...control, commandId: "command_capacity_other" }, scope),
      ),
    ).toEqual({ outcome: "busy" });
    expect(await run(() => admitSessionCommand(id, control, scope))).toMatchObject({
      outcome: "already_accepted",
    });
    expect(
      (await run(() => loadSessionCommands(id, scope))).filter(
        (command) => command.state === "queued",
      ),
    ).toHaveLength(2);
  });

  it("expires an undispatched reservation independently of endpoint readiness or claiming", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-unready", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      updateJournalRuntime(
        id,
        { status: "connecting", connectionState: "disconnected", syncState: "degraded" },
        writer,
        scope,
      ),
    );
    await run(() =>
      admitSessionCommand(
        id,
        {
          commandId: "command_never_connected",
          kind: "prompt",
          payload: { text: "expire without sending" },
        },
        scope,
      ),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    expect(
      await run(() =>
        expireSessionCommands(id, { ownerId: "stale-owner", epoch: writer.epoch }, scope),
      ),
    ).toBe(false);
    expect(await run(() => expireSessionCommands(id, writer, otherScope))).toBe(false);
    expect((await run(() => loadSessionCommand(id, "command_never_connected", scope)))?.state).toBe(
      "queued",
    );
    // Neither the ACP driver nor claimSessionCommands has ever run.
    expect(await run(() => expireSessionCommands(id, writer, scope))).toBe(true);
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: null,
      acpSessionId: null,
      creationState: "pending",
      session: { reliability: { execution: "idle", connection: "disconnected" } },
    });
    expect(await run(() => loadSessionCommand(id, "command_never_connected", scope))).toMatchObject(
      { state: "rejected", errorCode: "COMMAND_EXPIRED_BEFORE_DISPATCH" },
    );
  });

  it("maintenance rejects claimed preparation but retains expired dispatch ambiguity", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-maintenance", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_preparing", kind: "prompt", payload: { text: "still preparing" } },
        scope,
      ),
    );
    await run(() => claimSessionCommands(id, writer, scope));
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    await run(() => expireSessionCommands(id, writer, scope));
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({ activeCommandId: null });
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_possibly_sent", kind: "prompt", payload: { text: "do not replay" } },
        scope,
      ),
    );
    await run(() => claimSessionCommands(id, writer, scope));
    await run(() =>
      transitionSessionCommand(
        id,
        "command_possibly_sent",
        ["claimed"],
        "dispatching",
        writer,
        scope,
      ),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    await run(() => updateJournalRuntime(id, { connectionState: "disconnected" }, writer, scope));
    await run(() => expireSessionCommands(id, writer, scope));
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_possibly_sent",
      session: { reliability: { execution: "unknown" } },
    });
    expect(await run(() => loadSessionCommand(id, "command_possibly_sent", scope))).toMatchObject({
      state: "unknown",
      errorCode: "DISPATCH_OUTCOME_UNKNOWN",
    });
  });

  it("keeps an old active prompt visible ahead of many recently completed controls", async () => {
    const id = await session();
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_old_active", kind: "prompt", payload: { text: "still waiting" } },
        scope,
      ),
    );
    const now = Date.now();
    await db.insert(busabaseAgentSessionCommands).values(
      Array.from({ length: 200 }, (_, index) => ({
        id: `${id}_terminal_${index}`,
        sessionId: id,
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        commandId: `command_terminal_${String(index).padStart(5, "0")}`,
        kind: "cancel" as const,
        state: "completed" as const,
        bindingGeneration: 1,
        contentDigest: "f".repeat(64),
        payload: {},
        createdAt: new Date(now + index),
        expiresAt: new Date(now + 60_000),
      })),
    );
    const listed = await run(() => loadSessionCommands(id, scope));
    expect(listed[0]?.commandId).toBe("command_old_active");
    expect(listed).toHaveLength(33);
    expect(listed.filter((command) => command.state === "completed")).toHaveLength(32);
    expect(listed.some((command) => command.commandId === "command_terminal_00000")).toBe(false);
    expect(await run(() => loadSessionCommand(id, "command_terminal_00000", scope))).toMatchObject({
      state: "completed",
    });
    expect(
      await run(() => loadSessionCommand(id, "command_terminal_00000", otherScope)),
    ).toBeNull();
    // The bounded view does not delete durable terminal identity proof.
    expect(
      await db
        .select()
        .from(busabaseAgentSessionCommands)
        .where(eq(busabaseAgentSessionCommands.sessionId, id)),
    ).toHaveLength(201);
  });

  it("does not expire a healthy same-owner turn or paused decision at the admission horizon", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-live-turn", 30, scope));
    if (!writer) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_live_turn", kind: "prompt", payload: { text: "long-lived work" } },
        scope,
      ),
    );
    await run(() => claimSessionCommands(id, writer, scope));
    await run(() =>
      transitionSessionCommand(id, "command_live_turn", ["claimed"], "dispatching", writer, scope),
    );
    await run(() =>
      updateJournalRuntime(
        id,
        { connectionState: "connected", executionState: "running" },
        writer,
        scope,
      ),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    await run(() => expireSessionCommands(id, writer, scope));
    expect(await run(() => loadSessionCommand(id, "command_live_turn", scope))).toMatchObject({
      state: "dispatching",
    });
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_live_turn",
      session: { reliability: { execution: "running" } },
    });
    await run(() =>
      transitionSessionCommand(id, "command_live_turn", ["dispatching"], "observed", writer, scope),
    );
    await run(() => updateJournalRuntime(id, { executionState: "waiting" }, writer, scope));
    await run(() => expireSessionCommands(id, writer, scope));
    expect(await run(() => loadSessionCommand(id, "command_live_turn", scope))).toMatchObject({
      state: "observed",
    });
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_live_turn",
      session: { reliability: { execution: "waiting" } },
    });
    await run(() => updateJournalRuntime(id, { connectionState: "disconnected" }, writer, scope));
    await run(() => expireSessionCommands(id, writer, scope));
    expect(await run(() => loadSessionCommand(id, "command_live_turn", scope))).toMatchObject({
      state: "unknown",
    });
  });

  it("marks an expired sent turn unknown after takeover even if its previous connection was healthy", async () => {
    const id = await session();
    const original = await run(() => claimWriterLease(id, "writer-old-live", 30, scope));
    if (!original) throw new Error("Missing writer");
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_takeover_live", kind: "prompt", payload: { text: "already sent" } },
        scope,
      ),
    );
    await run(() => claimSessionCommands(id, original, scope));
    await run(() =>
      transitionSessionCommand(
        id,
        "command_takeover_live",
        ["claimed"],
        "dispatching",
        original,
        scope,
      ),
    );
    await run(() =>
      updateJournalRuntime(
        id,
        { connectionState: "connected", executionState: "running" },
        original,
        scope,
      ),
    );
    await db
      .update(busabaseAgentSessionCommands)
      .set({ expiresAt: new Date(0) })
      .where(eq(busabaseAgentSessionCommands.sessionId, id));
    await db
      .update(busabaseAgentSessions)
      .set({ writerExpiresAt: new Date(0) })
      .where(eq(busabaseAgentSessions.id, id));
    const replacement = await run(() => claimWriterLease(id, "writer-new-live", 30, scope));
    if (!replacement) throw new Error("Missing replacement writer");
    await run(() => expireSessionCommands(id, replacement, scope));
    expect(await run(() => loadSessionCommand(id, "command_takeover_live", scope))).toMatchObject({
      state: "unknown",
    });
    expect(await run(() => getJournalRuntime(id, scope))).toMatchObject({
      activeCommandId: "command_takeover_live",
      session: { reliability: { execution: "unknown" } },
    });
  });

  it("retains rejected unsent prompt snapshots without duplicating journaled prompts or control receipts", async () => {
    const id = await session();
    const writer = await run(() => claimWriterLease(id, "writer-unsent", 30, scope));
    if (!writer) throw new Error("Missing writer");
    const payload = {
      text: "Keep my exact draft",
      attachments: [
        { kind: "file", filename: "draft.pdf", mimeType: "application/pdf", data: "Zml4dHVyZQ==" },
      ],
    };
    await run(() =>
      admitSessionCommand(
        id,
        { commandId: "command_unsent_snapshot", kind: "prompt", payload },
        scope,
      ),
    );
    await run(() =>
      transitionSessionCommand(
        id,
        "command_unsent_snapshot",
        ["queued"],
        "rejected",
        writer,
        scope,
        { errorCode: "CONNECTION_BINDING_CHANGED" },
      ),
    );
    await run(() =>
      admitSessionCommand(
        id,
        {
          commandId: "command_already_journaled",
          kind: "prompt",
          payload: { text: "Already in the transcript" },
        },
        scope,
      ),
    );
    await run(() =>
      appendJournalEvents(
        id,
        [
          {
            identity: "command:command_already_journaled:user",
            event: {
              kind: "acpUpdate",
              commandId: "command_already_journaled",
              at: new Date().toISOString(),
              acpUpdate: {
                sessionUpdate: "user_message",
                text: "Already in the transcript",
                commandId: "command_already_journaled",
              },
            },
          },
        ],
        writer,
        scope,
      ),
    );
    await run(() =>
      transitionSessionCommand(
        id,
        "command_already_journaled",
        ["queued"],
        "rejected",
        writer,
        scope,
      ),
    );
    await run(() =>
      admitSessionCommand(
        id,
        {
          commandId: "command_rejected_config",
          kind: "config",
          payload: { configId: "model", value: "fast" },
        },
        scope,
      ),
    );
    await run(() =>
      transitionSessionCommand(
        id,
        "command_rejected_config",
        ["queued"],
        "rejected",
        writer,
        scope,
      ),
    );
    await db.insert(busabaseAgentSessionCommands).values(
      Array.from({ length: 64 }, (_, index) => ({
        id: `${id}_completed_control_${index}`,
        sessionId: id,
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        commandId: `completed_control_${index}`,
        kind: "cancel" as const,
        state: "completed" as const,
        bindingGeneration: 1,
        contentDigest: "f".repeat(64),
        payload: {},
        createdAt: new Date(Date.now() + index),
        expiresAt: new Date(Date.now() + 60_000),
      })),
    );
    const visible = (await run(() => loadSessions())).find((entry) => entry.id === id);
    expect(visible?.pendingCommands).toHaveLength(1);
    expect(visible?.pendingCommands?.[0]).toMatchObject({
      commandId: "command_unsent_snapshot",
      kind: "prompt",
      state: "rejected",
      payload,
    });
    expect(await run(() => loadSessionRuntime(id, otherScope))).toBeNull();
  });
});
