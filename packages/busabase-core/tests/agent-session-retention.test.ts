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
  endOrphanedLocalSessions,
  loadSessionEvents,
  loadSessions,
  persistSessionEvents,
  pruneExpiredSessions,
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
});
