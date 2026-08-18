import type {
  AgentSessionEventVO,
  AgentSessionStatus,
  AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseAgentSessionEvents } from "../schema/agent-session-events";
import { busabaseAgentSessions } from "../schema/agent-sessions";

/**
 * Persistence for agent sessions — the only place in this domain that touches
 * the database.
 *
 * Every function here is best-effort by design: a failed write must never take
 * down a live agent turn. Losing a transcript row is a cosmetic loss; killing
 * the conversation the user is having because the disk hiccuped is not. So the
 * writers swallow and log rather than throw, and the in-memory session stays
 * the source of truth for anything currently running.
 */

/**
 * `getDb()` — not `getContextDb()`. The latter returns only a host-injected
 * database (how Cloud passes its pooled connection in) and is `undefined` on
 * OSS, where the database is a process-local singleton; using it here would
 * have made every write on the open-source build a silent no-op.
 */
const db = () => getDb();

/** Rows a restart left behind claiming to be alive. */
const LIVE_STATUSES: AgentSessionStatus[] = ["connecting", "idle", "busy", "waiting_permission"];

function warn(what: string, error: unknown) {
  console.warn(`[agents] ${what} failed: ${error instanceof Error ? error.message : error}`);
}

export async function persistSessionCreated(session: AgentSessionVO): Promise<void> {
  const database = await db();
  try {
    await database.insert(busabaseAgentSessions).values({
      id: session.id,
      actorId: getContextActorId() ?? null,
      slug: session.slug,
      agentName: session.agentName,
      transport: session.transport,
      status: session.status,
      error: session.error,
      createdAt: new Date(session.createdAt),
      lastActivityAt: new Date(session.lastActivityAt),
    });
  } catch (error) {
    warn("persisting a new agent session", error);
  }
}

export async function persistSessionState(
  session: Pick<AgentSessionVO, "id" | "status" | "error" | "lastActivityAt">,
  acpSessionId?: string | null,
): Promise<void> {
  const database = await db();
  const ended = session.status === "ended" || session.status === "failed";
  try {
    await database
      .update(busabaseAgentSessions)
      .set({
        status: session.status,
        error: session.error,
        lastActivityAt: new Date(session.lastActivityAt),
        ...(acpSessionId === undefined ? {} : { acpSessionId }),
        ...(ended ? { endedAt: new Date() } : {}),
      })
      .where(eq(busabaseAgentSessions.id, session.id));
  } catch (error) {
    warn("persisting agent session state", error);
  }
}

/**
 * Append transcript rows. Callers pass an already-coalesced batch (see the
 * schema's note on why a row is not one emitted event), so this is one
 * multi-row insert per turn rather than one per token.
 */
export async function persistSessionEvents(events: AgentSessionEventVO[]): Promise<void> {
  if (events.length === 0) return;
  const database = await db();
  try {
    await database.insert(busabaseAgentSessionEvents).values(
      events.map((event) => ({
        id: `agev_${event.sessionId}_${event.seq}`,
        sessionId: event.sessionId,
        seq: event.seq,
        kind: event.kind,
        payload: {
          acpUpdate: event.acpUpdate,
          status: event.status,
          message: event.message,
          permissionRequest: event.permissionRequest,
          permissionRequestId: event.permissionRequestId,
          permissionOptionId: event.permissionOptionId,
        } as Record<string, unknown>,
        at: new Date(event.at),
      })),
    );
  } catch (error) {
    warn("persisting agent session events", error);
  }
}

const toVO = (row: typeof busabaseAgentSessions.$inferSelect): AgentSessionVO => ({
  id: row.id,
  slug: row.slug,
  agentName: row.agentName,
  transport: row.transport,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  lastActivityAt: row.lastActivityAt.toISOString(),
  error: row.error,
});

/**
 * Sessions for the current space, newest first.
 *
 * Scoped by `spaceId` — and on Cloud additionally by `actorId` — because the
 * in-memory listing this replaces had no filter at all. That was harmless only
 * while Cloud could not create a session; it would have become a cross-space
 * leak the moment a remote transport was wired (spec §7.4). Rows written by
 * OSS carry a null `actorId`, so the actor filter must let those through or a
 * tunnel-forwarded read would see nothing.
 */
export async function loadSessions(): Promise<AgentSessionVO[]> {
  const database = await db();
  const actorId = getContextActorId();
  try {
    const rows = await database
      .select()
      .from(busabaseAgentSessions)
      .where(
        and(
          eq(busabaseAgentSessions.spaceId, getContextSpaceId()),
          actorId
            ? or(eq(busabaseAgentSessions.actorId, actorId), isNull(busabaseAgentSessions.actorId))
            : undefined,
        ),
      )
      .orderBy(desc(busabaseAgentSessions.lastActivityAt));
    return rows.map(toVO);
  } catch (error) {
    warn("loading agent sessions", error);
    return [];
  }
}

/** Replay a persisted transcript — what a client sees for a session that outlived its process. */
export async function loadSessionEvents(
  sessionId: string,
  afterSeq: number,
): Promise<AgentSessionEventVO[]> {
  const database = await db();
  try {
    const rows = await database
      .select()
      .from(busabaseAgentSessionEvents)
      .where(
        and(
          eq(busabaseAgentSessionEvents.sessionId, sessionId),
          gt(busabaseAgentSessionEvents.seq, afterSeq),
        ),
      )
      .orderBy(asc(busabaseAgentSessionEvents.seq));
    return rows.map((row) => {
      const payload = row.payload as Partial<AgentSessionEventVO>;
      return {
        sessionId: row.sessionId,
        seq: row.seq,
        kind: row.kind,
        acpUpdate: payload.acpUpdate,
        status: payload.status,
        message: payload.message,
        permissionRequest: payload.permissionRequest,
        permissionRequestId: payload.permissionRequestId,
        permissionOptionId: payload.permissionOptionId,
        at: row.at.toISOString(),
      };
    });
  } catch (error) {
    warn("loading agent session events", error);
    return [];
  }
}

/**
 * How long a finished session's transcript is kept. Override with
 * `BUSABASE_AGENT_SESSION_RETENTION_DAYS`; `0` disables the sweep entirely.
 */
const DEFAULT_RETENTION_DAYS = 30;

function retentionDays(): number {
  const raw = process.env.BUSABASE_AGENT_SESSION_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * Delete finished sessions past the retention window. Events go with them via
 * `ON DELETE CASCADE`, and the index on `at` is what keeps this a range scan.
 *
 * **Whole sessions, not old events — this is deliberate.** The spec originally
 * proposed two tiers (prune events at 30 days, delete sessions at 90). That
 * produces a month-long window where a session is listed but its transcript is
 * gone, which reads as data loss rather than retention. A transcript is worth
 * having whole or not at all.
 *
 * **And no audit exemption for permission events**, which the spec left open.
 * They record approval of *tool execution* — a shell command, a file write —
 * which is only interpretable next to the conversation that asked for it;
 * keeping them while deleting their context leaves a record nobody can read.
 * Governance of the user's actual data does not live here: an agent's writes
 * become ChangeRequests with their own permanent history, and `auditEvents` /
 * `activity` remain the system of record.
 *
 * Only `ended`/`failed` rows are eligible, so a session that is somehow still
 * running after a month is never swept out from under its own process.
 */
export async function pruneExpiredSessions(): Promise<number> {
  const days = retentionDays();
  if (days === 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const database = await db();
  try {
    const deleted = await database
      .delete(busabaseAgentSessions)
      .where(
        and(
          inArray(busabaseAgentSessions.status, ["ended", "failed"]),
          lt(busabaseAgentSessions.lastActivityAt, cutoff),
        ),
      )
      .returning();
    return deleted.length;
  } catch (error) {
    warn("pruning expired agent sessions", error);
    return 0;
  }
}

/**
 * Close out sessions a previous process left behind.
 *
 * For `local-subprocess` there is provably nothing left running to reconcile
 * against: measured on both shipped agents, the whole process chain exits when
 * the server does, because in a stdio protocol the pipe is the lifetime (spec
 * §7.3). So this is bookkeeping, not cleanup — no PID tracking, no liveness
 * probe, no killing. Without it the UI would show sessions that look alive but
 * can never answer again.
 *
 * Remote sessions are deliberately left alone: their agent outlives us and
 * `session/load` can reattach, which is a separate, not-yet-built path.
 */
export async function endOrphanedLocalSessions(): Promise<number> {
  const database = await db();
  try {
    const ended = await database
      .update(busabaseAgentSessions)
      .set({
        status: "ended",
        error: "Ended because Busabase restarted.",
        endedAt: new Date(),
      })
      .where(
        and(
          eq(busabaseAgentSessions.transport, "local-subprocess"),
          inArray(busabaseAgentSessions.status, LIVE_STATUSES),
        ),
      )
      .returning();
    return ended.length;
  } catch (error) {
    warn("reconciling agent sessions on boot", error);
    return 0;
  }
}
