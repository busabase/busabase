/**
 * Agent session persistence against a real database: what the retention sweep
 * deletes, what boot reconciliation closes out, and that a transcript survives
 * and replays.
 *
 * Written against real PGLite rather than a mock because every interesting
 * behaviour here is a SQL predicate (status filters, an age cutoff, an
 * `ON DELETE CASCADE`) — the exact things a mocked db would assert nothing
 * about.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseAgentSessionEvents, busabaseAgentSessions } from "../src/db/schema";
import {
  acquireSessionLease,
  deleteSessionsBySlug,
  endOrphanedLocalSessions,
  endRemoteSession,
  endSessionsBySlug,
  loadScopedSession,
  loadSessionEvents,
  loadSessionRuntime,
  loadSessions,
  normalizeLegacyBudaSessions,
  persistSessionEvents,
  persistSessionState,
  pruneExpiredSessions,
  releaseSessionLease,
  renewSessionLease,
} from "../src/domains/agents/logic/agent-session-store";
import { seedScenario } from "./helpers/seed-scenario";

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

type Db = Awaited<ReturnType<typeof seedScenario>>["db"];

const inSpace = <T>(fn: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, isSpaceManager: true }, fn);

async function insertSession(
  db: Db,
  id: string,
  overrides: Partial<typeof busabaseAgentSessions.$inferInsert> = {},
) {
  await db.insert(busabaseAgentSessions).values({
    id,
    spaceId: LOCAL_SPACE_ID,
    slug: "claude-acp",
    agentName: "Claude Code",
    transport: "local-subprocess",
    status: "ended",
    createdAt: daysAgo(1),
    lastActivityAt: daysAgo(1),
    ...overrides,
  });
}

describe("agent session retention and reconciliation", () => {
  let db: Db;
  const originalRetention = process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS;

  beforeEach(async () => {
    ({ db } = await seedScenario("agent-retention"));
  });

  afterEach(() => {
    if (originalRetention === undefined) {
      process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = undefined;
      delete process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS;
    } else {
      process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = originalRetention;
    }
  });

  it("deletes a finished session past the window, and its transcript with it", async () => {
    process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = "30";
    await insertSession(db, "ags_old", { lastActivityAt: daysAgo(45) });
    await inSpace(() =>
      persistSessionEvents([
        {
          sessionId: "ags_old",
          seq: 1,
          kind: "acpUpdate",
          acpUpdate: { sessionUpdate: "agent_message_chunk", content: { text: "hi" } },
          at: daysAgo(45).toISOString(),
        },
      ]),
    );

    const pruned = await inSpace(() => pruneExpiredSessions());

    expect(pruned).toBe(1);
    // The events must go too — that is the ON DELETE CASCADE, and it is the
    // only thing keeping this table from outliving the sessions it describes.
    const orphanEvents = await db
      .select()
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, "ags_old"));
    expect(orphanEvents).toHaveLength(0);
  });

  it("keeps a finished session inside the window", async () => {
    process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = "30";
    await insertSession(db, "ags_recent", { lastActivityAt: daysAgo(3) });

    expect(await inSpace(() => pruneExpiredSessions())).toBe(0);
    expect(await inSpace(() => loadSessions())).toHaveLength(1);
  });

  it("never deletes a session that is still running, however old", async () => {
    // A month-old `idle` row should not exist, but if one does, sweeping it out
    // from under a live process would be the worse failure.
    process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = "30";
    await insertSession(db, "ags_stuck", { status: "idle", lastActivityAt: daysAgo(120) });

    expect(await inSpace(() => pruneExpiredSessions())).toBe(0);
  });

  it("does nothing when retention is disabled with 0", async () => {
    process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS = "0";
    await insertSession(db, "ags_ancient", { lastActivityAt: daysAgo(3650) });

    expect(await inSpace(() => pruneExpiredSessions())).toBe(0);
  });

  it("closes out local sessions a previous process left claiming to be live", async () => {
    await insertSession(db, "ags_live", { status: "busy" });
    await insertSession(db, "ags_waiting", { status: "waiting_permission" });
    await insertSession(db, "ags_done", { status: "ended" });
    // A remote agent outlives our process, so its row is deliberately untouched.
    await insertSession(db, "ags_remote", { status: "idle", transport: "remote-websocket" });

    const closed = await inSpace(() => endOrphanedLocalSessions());

    expect(closed).toBe(2);
    const rows = await inSpace(() => loadSessions());
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("ags_live")?.status).toBe("ended");
    expect(byId.get("ags_live")?.error).toMatch(/restarted/i);
    expect(byId.get("ags_remote")?.status).toBe("idle");
  });

  it("replays a stored transcript from a given seq", async () => {
    await insertSession(db, "ags_replay");
    await inSpace(() =>
      persistSessionEvents([
        {
          sessionId: "ags_replay",
          seq: 1,
          kind: "acpUpdate",
          acpUpdate: { sessionUpdate: "user_message", text: "ping" },
          at: new Date().toISOString(),
        },
        {
          sessionId: "ags_replay",
          seq: 2,
          kind: "permissionRequest",
          permissionRequest: {
            requestId: "perm_1",
            options: [{ optionId: "allow", name: "Allow" }],
          },
          at: new Date().toISOString(),
        },
      ]),
    );

    const all = await inSpace(() => loadSessionEvents("ags_replay", 0));
    expect(all.map((e) => e.kind)).toEqual(["acpUpdate", "permissionRequest"]);
    // The permission payload has to round-trip through jsonb intact — it is the
    // record of what a human approved.
    expect(all[1]?.permissionRequest?.requestId).toBe("perm_1");

    // A client that already saw seq 1 gets only what it missed.
    expect(await inSpace(() => loadSessionEvents("ags_replay", 1))).toHaveLength(1);
  });

  it("scopes session identity and transcript replay by both space and actor", async () => {
    await insertSession(db, "ags_alice", { actorId: "alice" });
    await runWithBusabaseContext(
      { db, spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
      () =>
        persistSessionEvents([
          {
            sessionId: "ags_alice",
            seq: 1,
            kind: "acpUpdate",
            acpUpdate: { sessionUpdate: "user_message", text: "private" },
            at: new Date().toISOString(),
          },
        ]),
    );

    const asAlice = await runWithBusabaseContext(
      { db, spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
      async () => ({
        session: await loadScopedSession("ags_alice"),
        events: await loadSessionEvents("ags_alice", -1),
      }),
    );
    expect(asAlice.session?.id).toBe("ags_alice");
    expect(asAlice.events).toHaveLength(1);

    const asBob = await runWithBusabaseContext(
      { db, spaceId: LOCAL_SPACE_ID, actorId: "bob", isSpaceManager: true },
      async () => ({
        session: await loadScopedSession("ags_alice"),
        events: await loadSessionEvents("ags_alice", -1),
      }),
    );
    expect(asBob).toEqual({ session: null, events: [] });

    const inOtherSpace = await runWithBusabaseContext(
      { db, spaceId: "other-space", actorId: "alice", isSpaceManager: true },
      async () => ({
        session: await loadScopedSession("ags_alice"),
        events: await loadSessionEvents("ags_alice", -1),
      }),
    );
    expect(inOtherSpace).toEqual({ session: null, events: [] });
  });

  it("disconnect tombstones sessions without deleting history and stale state cannot revive them", async () => {
    await insertSession(db, "ags_disconnect", {
      actorId: "alice",
      slug: "buda:agent-a",
      transport: "remote-websocket",
      status: "idle",
    });
    const run = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext(
        { db, spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
        fn,
      );
    await run(() =>
      persistSessionEvents([
        {
          sessionId: "ags_disconnect",
          seq: 1,
          kind: "acpUpdate",
          acpUpdate: { sessionUpdate: "user_message", text: "keep me" },
          at: new Date().toISOString(),
        },
      ]),
    );

    await expect(run(() => endSessionsBySlug("buda:agent-a"))).resolves.toEqual(["ags_disconnect"]);
    await run(() =>
      persistSessionState({
        id: "ags_disconnect",
        status: "idle",
        error: null,
        lastActivityAt: new Date().toISOString(),
      }),
    );

    expect((await run(() => loadScopedSession("ags_disconnect")))?.status).toBe("ended");
    expect(await run(() => loadSessionEvents("ags_disconnect", -1))).toHaveLength(1);

    await expect(run(() => deleteSessionsBySlug("buda:agent-a"))).resolves.toBe(1);
    expect(await run(() => loadScopedSession("ags_disconnect"))).toBeNull();
    expect(await run(() => loadSessionEvents("ags_disconnect", -1))).toEqual([]);
  });

  it("keeps canonical multi-agent operations exact and normalizes legacy history explicitly", async () => {
    await insertSession(db, "ags_legacy_a", {
      actorId: "alice",
      slug: "buda",
      transport: "remote-websocket",
      status: "idle",
    });
    await insertSession(db, "ags_canonical_b", {
      actorId: "alice",
      slug: "buda:agent-b",
      transport: "remote-websocket",
      status: "idle",
    });
    const run = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext(
        { db, spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
        fn,
      );

    await expect(run(() => endSessionsBySlug("buda:agent-b"))).resolves.toEqual([
      "ags_canonical_b",
    ]);
    expect((await run(() => loadScopedSession("ags_legacy_a")))?.status).toBe("idle");

    await expect(run(() => normalizeLegacyBudaSessions("buda:agent-a"))).resolves.toBe(1);
    const sessions = await run(() => loadSessions());
    expect(sessions.find((session) => session.id === "ags_legacy_a")?.slug).toBe("buda:agent-a");
    expect(sessions.find((session) => session.id === "ags_canonical_b")?.slug).toBe("buda:agent-b");
  });

  it("loads scoped remote identity and grants the prompt lease to one worker", async () => {
    await insertSession(db, "ags_handoff", {
      actorId: "alice",
      transport: "remote-websocket",
      status: "idle",
      acpSessionId: "acp_inner_handoff",
    });
    await db.insert(busabaseAgentSessionEvents).values({
      id: "agev_ags_handoff_7",
      sessionId: "ags_handoff",
      seq: 7,
      kind: "status",
      payload: { status: "idle" },
      at: new Date(),
    });
    const asActor = <T>(actorId: string, fn: () => Promise<T>) =>
      runWithBusabaseContext({ spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: true }, fn);

    await expect(asActor("alice", () => loadSessionRuntime("ags_handoff"))).resolves.toMatchObject({
      session: { id: "ags_handoff", status: "idle" },
      acpSessionId: "acp_inner_handoff",
      lastEventSeq: 7,
    });
    const competingClaims = await Promise.all([
      asActor("alice", () => acquireSessionLease("ags_handoff", "worker-a")),
      asActor("alice", () => acquireSessionLease("ags_handoff", "worker-b")),
    ]);
    const [granted] = competingClaims.filter((lease) => lease !== null);
    expect(competingClaims.filter((lease) => lease !== null)).toHaveLength(1);
    expect(granted?.fencingToken).toBe(1);

    const staleIdleWrite = await asActor("alice", () =>
      persistSessionState(
        {
          id: "ags_handoff",
          status: "idle",
          error: null,
          lastActivityAt: new Date().toISOString(),
        },
        "acp_inner_handoff",
        { expectedStatuses: ["connecting"] },
      ),
    );
    expect(staleIdleWrite).toBe(false);
    await expect(asActor("alice", () => loadSessionRuntime("ags_handoff"))).resolves.toMatchObject({
      session: { status: "busy" },
    });

    // A write carrying the *other* worker's owner id (the one that lost the
    // race above) must be rejected even though the session is genuinely busy
    // — it is not this caller's turn to have any effect on it.
    const loserOwnerId = granted?.ownerId === "worker-a" ? "worker-b" : "worker-a";
    await expect(
      asActor("alice", () =>
        releaseSessionLease("ags_handoff", loserOwnerId, granted?.fencingToken ?? 0),
      ),
    ).resolves.toBe(false);
    await expect(asActor("alice", () => loadSessionRuntime("ags_handoff"))).resolves.toMatchObject({
      session: { status: "busy" },
    });

    await expect(
      asActor("alice", () =>
        releaseSessionLease("ags_handoff", granted?.ownerId ?? "", granted?.fencingToken ?? 0),
      ),
    ).resolves.toBe(true);
    await expect(asActor("alice", () => endRemoteSession("ags_handoff"))).resolves.toBe(true);
    await expect(asActor("alice", () => loadSessionRuntime("ags_handoff"))).resolves.toMatchObject({
      session: { status: "ended" },
    });
    await expect(asActor("alice", () => endRemoteSession("ags_handoff"))).resolves.toBe(false);

    await expect(asActor("bob", () => loadSessionRuntime("ags_handoff"))).resolves.toBeNull();
    await expect(
      asActor("bob", () => acquireSessionLease("ags_handoff", "bob-worker")),
    ).resolves.toBe(null);
  });

  it("lets a different worker take over once the lease has expired", async () => {
    await insertSession(db, "ags_crash", {
      actorId: "alice",
      transport: "remote-websocket",
      status: "idle",
      acpSessionId: "acp_inner_crash",
    });
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext(
        { spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
        fn,
      );

    const first = await asAlice(() => acquireSessionLease("ags_crash", "worker-a", 30));
    expect(first).not.toBeNull();
    expect(first?.fencingToken).toBe(1);

    // Simulate the acquiring worker crashing mid-turn: nothing ever calls
    // releaseSessionLease, so without expiry this row would be permanently
    // busy. Force the lease into the past rather than sleeping in the test.
    await db
      .update(busabaseAgentSessions)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(busabaseAgentSessions.id, "ags_crash"));
    await expect(
      asAlice(() => renewSessionLease("ags_crash", "worker-a", first?.fencingToken ?? 0, 30)),
    ).resolves.toBe(false);

    const second = await asAlice(() => acquireSessionLease("ags_crash", "worker-b", 30));
    expect(second).not.toBeNull();
    expect(second?.ownerId).toBe("worker-b");
    // Monotonically increasing: the new owner's token is strictly greater
    // than the crashed worker's, never a reused or reset value.
    expect(second?.fencingToken).toBeGreaterThan(first?.fencingToken ?? 0);
    await expect(
      asAlice(() => releaseSessionLease("ags_crash", "worker-a", first?.fencingToken ?? 0)),
    ).resolves.toBe(false);

    // The crashed worker's stale owner+token can no longer write anything,
    // even though its process might still believe it holds the turn.
    await expect(
      asAlice(() =>
        persistSessionState(
          {
            id: "ags_crash",
            status: "idle",
            error: null,
            lastActivityAt: new Date().toISOString(),
          },
          undefined,
          undefined,
          undefined,
          { ownerId: "worker-a", fencingToken: first?.fencingToken ?? 0 },
        ),
      ),
    ).resolves.toBe(false);
    // The new owner's own fence is honored.
    await expect(
      asAlice(() =>
        persistSessionState(
          {
            id: "ags_crash",
            status: "idle",
            error: null,
            lastActivityAt: new Date().toISOString(),
          },
          undefined,
          undefined,
          undefined,
          { ownerId: "worker-b", fencingToken: second?.fencingToken ?? 0 },
        ),
      ),
    ).resolves.toBe(true);
  });

  it("rejects a stale-owner event batch as all-or-nothing, not a partial write", async () => {
    await insertSession(db, "ags_fenced_events", {
      actorId: "alice",
      transport: "remote-websocket",
      status: "idle",
    });
    const asAlice = <T>(fn: () => Promise<T>) =>
      runWithBusabaseContext(
        { spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
        fn,
      );

    const first = await asAlice(() => acquireSessionLease("ags_fenced_events", "worker-a", 30));
    await db
      .update(busabaseAgentSessions)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(busabaseAgentSessions.id, "ags_fenced_events"));
    const second = await asAlice(() => acquireSessionLease("ags_fenced_events", "worker-b", 30));
    expect(second?.fencingToken).toBeGreaterThan(first?.fencingToken ?? 0);

    const staleBatch = await asAlice(() =>
      persistSessionEvents(
        [
          {
            sessionId: "ags_fenced_events",
            seq: 1,
            kind: "acpUpdate",
            acpUpdate: { sessionUpdate: "user_message", text: "from the crashed worker" },
            at: new Date().toISOString(),
          },
          {
            sessionId: "ags_fenced_events",
            seq: 2,
            kind: "status",
            status: "idle",
            at: new Date().toISOString(),
          },
        ],
        { ownerId: "worker-a", fencingToken: first?.fencingToken ?? 0 },
      ),
    );
    expect(staleBatch).toBe(false);

    const rows = await db
      .select()
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, "ags_fenced_events"));
    // Zero rows, not one of two — a fence rejection must never let half a
    // batch land.
    expect(rows).toHaveLength(0);

    const currentBatch = await asAlice(() =>
      persistSessionEvents(
        [
          {
            sessionId: "ags_fenced_events",
            seq: 1,
            kind: "acpUpdate",
            acpUpdate: { sessionUpdate: "user_message", text: "from the current worker" },
            at: new Date().toISOString(),
          },
        ],
        { ownerId: "worker-b", fencingToken: second?.fencingToken ?? 0 },
      ),
    );
    expect(currentBatch).toBe(true);
  });
});
