import { eq, inArray } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import {
  busabaseAgentSessionCommands,
  busabaseAgentSessionEvents,
  busabaseAgentSessions,
} from "../src/db/schema";
import {
  appendJournalEvents,
  claimSessionCommands,
  claimWriterLease,
  expireSessionCommands,
  listSessionCommandDemand,
  releaseWriterLease,
  renewWriterLease,
  touchJournalDemand,
  transitionSessionCommand,
  updateJournalRuntime,
} from "../src/domains/agents/logic/agent-session-journal-store";
import {
  endOrphanedLocalSessions,
  pruneExpiredSessions,
} from "../src/domains/agents/logic/agent-session-store";
import {
  registerAgentSessionSupervisorDriver,
  startAgentSessionSupervisorHost,
  stopAgentSessionSupervisorHost,
  wakeAgentSessionSupervisor,
} from "../src/domains/agents/logic/agent-session-supervisor";
import { endRestoreActivity, restoreActivityKey } from "../src/domains/dump/logic/restore-activity";
import { seedScenario } from "./helpers/seed-scenario";

describe("agent housekeeping and execution stay paused for durable restores", () => {
  let database: Awaited<ReturnType<typeof seedScenario>>["db"];
  let ordinal = 0;
  let spaces: string[] = [];
  let held: string;
  let normal: string;
  const actorId = "restore-guard-actor";
  const scope = (spaceId: string) => ({ spaceId, actorId });
  const run = <T>(spaceId: string, operation: () => Promise<T>) =>
    runWithBusabaseContext({ db: database, spaceId, actorId, isSpaceManager: true }, operation);

  beforeAll(async () => {
    ({ db: database } = await seedScenario("agent-restore-hold"));
  });
  beforeEach(() => {
    held = `restore_agents_held_${++ordinal}`;
    normal = `restore_agents_normal_${ordinal}`;
    spaces = [held, normal];
    vi.stubEnv("BUSABASE_AGENT_SUPERVISOR_ENABLED", "true");
    vi.stubEnv("BUSABASE_AGENT_LEGACY_WRITERS_DRAINED", "true");
    vi.stubEnv("BUSABASE_AGENT_SESSION_RETENTION_DAYS", "30");
  });
  afterEach(async () => {
    await stopAgentSessionSupervisorHost();
    await database
      .delete(busabaseAgentSessions)
      .where(inArray(busabaseAgentSessions.spaceId, spaces));
    for (const spaceId of spaces) await storage.deleteObject(restoreActivityKey(spaceId));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const hold = async (spaceId: string, corrupt = false) =>
    storage.uploadFileToKey(
      Buffer.from(
        corrupt
          ? "invalid marker"
          : JSON.stringify({
              version: 1,
              spaceId,
              sessionId: "dumpsess_test",
              sourceSpaceId: "source-fixture",
              startedAt: "2020-01-01T00:00:00.000Z",
            }),
      ),
      restoreActivityKey(spaceId),
      "application/json",
    );
  const releaseHold = (spaceId: string) =>
    endRestoreActivity(database, { spaceId, sessionId: "dumpsess_test" });
  const session = async (
    spaceId: string,
    id: string,
    patch: Partial<typeof busabaseAgentSessions.$inferInsert> = {},
  ) => {
    await database.insert(busabaseAgentSessions).values({
      id,
      spaceId,
      actorId,
      slug: "fixture-agent",
      agentName: "Fixture",
      transport: "local-subprocess",
      status: "idle",
      journalMode: "supervised",
      creationState: "confirmed",
      syncState: "synced",
      connectionState: "connected",
      executionState: "idle",
      demandUntil: new Date(Date.now() + 60_000),
      lastActivityAt: new Date(),
      ...patch,
    });
  };
  const command = async (spaceId: string, sessionId: string, id: string) => {
    await database.insert(busabaseAgentSessionCommands).values({
      id,
      spaceId,
      actorId,
      sessionId,
      commandId: id,
      kind: "prompt",
      state: "queued",
      bindingGeneration: 1,
      contentDigest: "fixture-digest",
      payload: { text: "Do not execute during restore" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await database
      .update(busabaseAgentSessions)
      .set({ activeCommandId: id, executionState: "reserved" })
      .where(eq(busabaseAgentSessions.id, sessionId));
  };
  const snapshot = async (spaceId: string) => {
    const sessions = await database
      .select()
      .from(busabaseAgentSessions)
      .where(eq(busabaseAgentSessions.spaceId, spaceId));
    const ids = sessions.map((row) => row.id);
    const events = ids.length
      ? await database
          .select()
          .from(busabaseAgentSessionEvents)
          .where(inArray(busabaseAgentSessionEvents.sessionId, ids))
      : [];
    const commands = await database
      .select()
      .from(busabaseAgentSessionCommands)
      .where(eq(busabaseAgentSessionCommands.spaceId, spaceId));
    return { sessions, events, commands };
  };

  it("preserves held transcripts and live metadata while unrelated spaces retain normal boot/prune policies", async () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    for (const spaceId of spaces) {
      await session(spaceId, `${spaceId}_live`, { status: "busy" });
      await session(spaceId, `${spaceId}_old`, { status: "ended", lastActivityAt: old });
      await database.insert(busabaseAgentSessionEvents).values({
        id: `${spaceId}_event`,
        sessionId: `${spaceId}_old`,
        seq: 1,
        kind: "status",
        payload: { status: "ended" },
        at: old,
      });
    }
    await hold(held);
    const before = await snapshot(held);
    expect(await run(normal, endOrphanedLocalSessions)).toBe(1);
    expect(await run(normal, pruneExpiredSessions)).toBe(1);
    expect(await snapshot(held)).toEqual(before);
    const outside = await snapshot(normal);
    expect(outside.sessions).toHaveLength(1);
    expect(outside.sessions[0].status).toBe("ended");
    expect(outside.events).toEqual([]);

    await releaseHold(held);
    expect(await run(held, endOrphanedLocalSessions)).toBe(1);
    expect(await run(held, pruneExpiredSessions)).toBe(1);
  });

  it("does not touch demand, leases, command state or events until the restore marker is released", async () => {
    const id = `${held}_leased`;
    const unowned = `${held}_unowned`;
    const fence = { ownerId: "original-writer", epoch: 7 };
    await session(held, id, {
      writerOwnerId: fence.ownerId,
      writerEpoch: fence.epoch,
      writerExpiresAt: new Date(Date.now() + 300_000),
    });
    await session(held, unowned, { lastActivityAt: new Date(0) });
    await command(held, id, `${id}_command`);
    await session(normal, `${normal}_ready`, { lastActivityAt: new Date() });
    await hold(held);
    const before = await snapshot(held);
    expect(await run(held, () => touchJournalDemand(id, scope(held)))).toBe(false);
    expect(
      await run(held, () => claimWriterLease(unowned, "new-writer", 45, scope(held))),
    ).toBeNull();
    expect(await run(held, () => renewWriterLease(id, fence, 45, scope(held)))).toBe(false);
    expect(await run(held, () => releaseWriterLease(id, fence, scope(held)))).toBe(false);
    expect(await run(held, () => claimSessionCommands(id, fence, scope(held)))).toEqual([]);
    expect(await run(held, () => expireSessionCommands(id, fence, scope(held)))).toBe(false);
    expect(
      await run(held, () =>
        transitionSessionCommand(
          id,
          `${id}_command`,
          ["queued"],
          "dispatching",
          fence,
          scope(held),
        ),
      ),
    ).toBe(false);
    expect(
      await run(held, () => updateJournalRuntime(id, { status: "busy" }, fence, scope(held))),
    ).toBe(false);
    expect(
      await run(held, () =>
        appendJournalEvents(
          id,
          [
            {
              identity: "unexpected",
              event: { kind: "status", status: "busy", at: new Date().toISOString() },
            },
          ],
          fence,
          scope(held),
        ),
      ),
    ).toMatchObject({ outcome: "unavailable" });
    const demand = await listSessionCommandDemand(database, 1, true);
    expect(demand.map((row) => row.spaceId)).toEqual([normal]);
    expect(await snapshot(held)).toEqual(before);
    await releaseHold(held);
    expect(await run(held, () => touchJournalDemand(id, scope(held)))).toBe(true);
    expect(
      await run(held, () => claimWriterLease(unowned, "new-writer", 45, scope(held))),
    ).toMatchObject({ ownerId: "new-writer" });
  });

  it("fails closed without mutating sessions when the durable marker is malformed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = `${held}_corrupt_hold`;
    await session(held, id, { status: "busy" });
    await hold(held, true);
    const before = await snapshot(held);
    expect(await run(held, endOrphanedLocalSessions)).toBe(0);
    expect(await run(held, () => touchJournalDemand(id, scope(held)))).toBe(false);
    expect(await listSessionCommandDemand(database, 1)).toEqual([]);
    expect(await snapshot(held)).toEqual(before);
  });

  it("does not connect or execute imported held sessions while a normal space continues", async () => {
    for (const spaceId of spaces) {
      const id = `${spaceId}_supervised`;
      await session(spaceId, id, { lastActivityAt: spaceId === held ? new Date(0) : new Date() });
      await command(spaceId, id, `${id}_command`);
    }
    await hold(held);
    const before = await snapshot(held);
    const connect = vi.fn(async () => {});
    const execute = vi.fn(async (_id, _command, beforeDispatch: () => Promise<void>) => {
      await beforeDispatch();
      return { done: true };
    });
    registerAgentSessionSupervisorDriver({
      connect,
      execute,
      reconcile: async () => ({ state: "completed" }),
      detach: () => {},
    });
    startAgentSessionSupervisorHost({
      database: async () => database,
      runAs: (ref, operation) =>
        runWithBusabaseContext({ db: database, ...ref, isSpaceManager: true }, operation),
    });
    for (let attempt = 0; attempt < 30 && execute.mock.calls.length === 0; attempt++) {
      await wakeAgentSessionSupervisor();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(connect.mock.calls.map((call) => call[0].session.id)).toEqual([`${normal}_supervised`]);
    expect(execute.mock.calls.map((call) => call[0])).toEqual([`${normal}_supervised`]);
    expect(await snapshot(held)).toEqual(before);
  });
});
