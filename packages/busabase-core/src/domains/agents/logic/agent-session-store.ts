import {
  type AgentSessionEventVO,
  type AgentSessionModelOptionVO,
  AgentSessionModelOptionVOSchema,
  type AgentSessionStatus,
  type AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseAgentSessionEvents } from "../schema/agent-session-events";
import { busabaseAgentSessions } from "../schema/agent-sessions";
import type { AgentSessionCursor } from "../utils/agent-session-pagination";

/**
 * Persistence for agent sessions — the only place in this domain that touches
 * the database.
 *
 * Session identity is strict: a process/socket must never exist without its
 * durable, tenant-scoped row. Transcript and later state writes remain
 * best-effort so a temporary storage failure cannot interrupt an active turn.
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

export interface AgentSessionScope {
  spaceId: string;
  actorId: string | null;
}

const currentScope = (): AgentSessionScope => ({
  spaceId: getContextSpaceId(),
  actorId: getContextActorId() ?? null,
});

const scopeCondition = (scope: AgentSessionScope) =>
  and(
    eq(busabaseAgentSessions.spaceId, scope.spaceId),
    scope.actorId
      ? eq(busabaseAgentSessions.actorId, scope.actorId)
      : isNull(busabaseAgentSessions.actorId),
  );

export async function persistSessionCreated(
  session: AgentSessionVO,
  scope: AgentSessionScope = currentScope(),
): Promise<void> {
  const database = await db();
  await database.insert(busabaseAgentSessions).values({
    id: session.id,
    spaceId: scope.spaceId,
    actorId: scope.actorId,
    slug: session.slug,
    agentName: session.agentName,
    transport: session.transport,
    status: session.status,
    error: session.error,
    createdAt: new Date(session.createdAt),
    lastActivityAt: new Date(session.lastActivityAt),
  });
}

/** Persist the inner id without overwriting an in-flight prompt reservation. */
export async function persistSessionAcpIdentity(
  sessionId: string,
  acpSessionId: string,
  scope: AgentSessionScope = currentScope(),
): Promise<void> {
  const database = await db();
  await database
    .update(busabaseAgentSessions)
    .set({ acpSessionId, lastActivityAt: new Date() })
    .where(and(eq(busabaseAgentSessions.id, sessionId), scopeCondition(scope)));
}

/**
 * Cross-worker turn ownership. An acquire is one atomic UPDATE that both
 * claims the lease (owner UUID + a strictly-increasing fencing token) and
 * flips status to busy, conditioned on either no one holding the lease or the
 * previous holder's lease having expired by the DATABASE's clock (`now()`,
 * never app-side `Date.now()` — workers can have skewed clocks, the row
 * cannot).
 *
 * A crashed worker's lease simply expires; the next prompt attempt from any
 * worker (including a fresh one) can then acquire it and gets a higher token
 * than the crashed worker held. That crashed worker's writes, if it somehow
 * resumes, carry its old token and are rejected by every fenced write below
 * — this is what makes takeover safe without ever needing to know *why* the
 * previous owner stopped responding.
 */
export interface AgentSessionLease {
  sessionId: string;
  ownerId: string;
  fencingToken: number;
  expiresAt: string;
}

export const DEFAULT_SESSION_LEASE_TTL_SECONDS = 45;

export function sessionLeaseTtlSeconds(): number {
  const raw = process.env.BUSABASE_AGENT_SESSION_LEASE_TTL_SECONDS?.trim();
  if (!raw) return DEFAULT_SESSION_LEASE_TTL_SECONDS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_LEASE_TTL_SECONDS;
}

/** Acquire the turn lease and flip status → busy. Only one worker can succeed per turn. */
export async function acquireSessionLease(
  sessionId: string,
  ownerId: string,
  ttlSeconds: number = sessionLeaseTtlSeconds(),
  scope: AgentSessionScope = currentScope(),
): Promise<AgentSessionLease | null> {
  const database = await db();
  const [claimed] = await database
    .update(busabaseAgentSessions)
    .set({
      status: "busy",
      lastActivityAt: new Date(),
      leaseOwnerId: ownerId,
      leaseFencingToken: sql`coalesce(${busabaseAgentSessions.leaseFencingToken}, 0) + 1`,
      leaseExpiresAt: sql`now() + (${ttlSeconds} * interval '1 second')`,
    })
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeCondition(scope),
        eq(busabaseAgentSessions.transport, "remote-websocket"),
        inArray(busabaseAgentSessions.status, LIVE_STATUSES),
        or(
          isNull(busabaseAgentSessions.leaseOwnerId),
          isNull(busabaseAgentSessions.leaseExpiresAt),
          lte(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
        ),
      ),
    )
    .returning();
  if (!claimed || claimed.leaseOwnerId !== ownerId || claimed.leaseExpiresAt === null) return null;
  return {
    sessionId,
    ownerId,
    fencingToken: claimed.leaseFencingToken,
    expiresAt: claimed.leaseExpiresAt.toISOString(),
  };
}

/**
 * Best-effort expiry extension for the current occupant. `false` means this
 * caller's fence is already stale — its turn keeps running locally, but it
 * must treat any subsequent write rejection as ownership loss, not a
 * transient error.
 */
export async function renewSessionLease(
  sessionId: string,
  ownerId: string,
  fencingToken: number,
  ttlSeconds: number = sessionLeaseTtlSeconds(),
  scope: AgentSessionScope = currentScope(),
): Promise<boolean> {
  const database = await db();
  try {
    const renewed = await database
      .update(busabaseAgentSessions)
      .set({ leaseExpiresAt: sql`now() + (${ttlSeconds} * interval '1 second')` })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeCondition(scope),
          eq(busabaseAgentSessions.leaseOwnerId, ownerId),
          eq(busabaseAgentSessions.leaseFencingToken, fencingToken),
          gt(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
        ),
      )
      .returning();
    return renewed.length === 1;
  } catch (error) {
    warn("renewing agent session lease", error);
    return false;
  }
}

/** Release a held turn only for the exact owner+token that acquired it; terminal states always win. */
export async function releaseSessionLease(
  sessionId: string,
  ownerId: string,
  fencingToken: number,
  scope: AgentSessionScope = currentScope(),
): Promise<boolean> {
  const database = await db();
  const released = await database
    .update(busabaseAgentSessions)
    .set({
      status: "idle",
      lastActivityAt: new Date(),
      leaseOwnerId: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeCondition(scope),
        eq(busabaseAgentSessions.status, "busy"),
        eq(busabaseAgentSessions.leaseOwnerId, ownerId),
        eq(busabaseAgentSessions.leaseFencingToken, fencingToken),
        gt(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
      ),
    )
    .returning();
  return released.length === 1;
}

/** End an unowned or expired remote session without requiring its original socket. */
export async function endRemoteSession(
  sessionId: string,
  scope: AgentSessionScope = currentScope(),
): Promise<boolean> {
  const database = await db();
  const ended = await database
    .update(busabaseAgentSessions)
    .set({
      status: "ended",
      endedAt: new Date(),
      lastActivityAt: new Date(),
      leaseOwnerId: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeCondition(scope),
        eq(busabaseAgentSessions.transport, "remote-websocket"),
        notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
        or(
          isNull(busabaseAgentSessions.leaseOwnerId),
          isNull(busabaseAgentSessions.leaseExpiresAt),
          lte(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
        ),
      ),
    )
    .returning();
  return ended.length === 1;
}

/** Fences a durable write to the exact lease occupant that produced it. */
export interface LeaseFence {
  ownerId: string;
  fencingToken: number;
}

const fenceCondition = (fence: LeaseFence | undefined) =>
  fence
    ? and(
        eq(busabaseAgentSessions.leaseOwnerId, fence.ownerId),
        eq(busabaseAgentSessions.leaseFencingToken, fence.fencingToken),
        gt(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
      )
    : undefined;

export async function persistSessionState(
  session: Pick<AgentSessionVO, "id" | "status" | "error" | "lastActivityAt">,
  acpSessionId?: string | null,
  options?: { expectedStatuses?: AgentSessionStatus[] },
  scope: AgentSessionScope = currentScope(),
  fence?: LeaseFence,
): Promise<boolean> {
  const database = await db();
  const ended = session.status === "ended" || session.status === "failed";
  try {
    const updated = await database
      .update(busabaseAgentSessions)
      .set({
        status: session.status,
        error: session.error,
        lastActivityAt: new Date(session.lastActivityAt),
        ...(acpSessionId === undefined ? {} : { acpSessionId }),
        ...(ended ? { endedAt: new Date() } : {}),
        ...(fence && session.status !== "busy" ? { leaseOwnerId: null, leaseExpiresAt: null } : {}),
      })
      .where(
        and(
          eq(busabaseAgentSessions.id, session.id),
          scopeCondition(scope),
          notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
          options?.expectedStatuses
            ? inArray(busabaseAgentSessions.status, options.expectedStatuses)
            : undefined,
          fenceCondition(fence),
        ),
      )
      .returning();
    return updated.length === 1;
  } catch (error) {
    warn("persisting agent session state", error);
    return false;
  }
}

/**
 * Durable mirror of `LiveSession.modelOption` (PUL-246) — the one write path
 * every discovery/update site funnels through, so the shape landing in
 * `jsonb` always matches what `parseStoredModelOption` will read back.
 *
 * Called for `remote-websocket` sessions only, from the three moments the
 * live value itself changes: initial discovery on `session/new`/
 * `session/load`, an agent-pushed `config_option_update`, and the response to
 * a user-triggered `session/set_config_option`. Best-effort like the rest of
 * this domain's non-turn-critical writes (`warn`, swallow, return `false`) —
 * a transient failure here must not interrupt an otherwise-healthy turn; the
 * next discovery/update call gets another chance to land the same value.
 *
 * Initial discovery and idle agent notifications can write only while no
 * worker owns a live lease. During a prompt or user-triggered config change,
 * the caller supplies that operation's fence so a retained socket on another
 * worker cannot overwrite the in-flight owner's snapshot.
 */
export async function persistSessionModelOption(
  sessionId: string,
  modelOption: AgentSessionModelOptionVO | null,
  scope: AgentSessionScope = currentScope(),
  fence?: LeaseFence,
): Promise<boolean> {
  const database = await db();
  try {
    const updated = await database
      .update(busabaseAgentSessions)
      .set({ modelOption })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeCondition(scope),
          eq(busabaseAgentSessions.transport, "remote-websocket"),
          notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
          fence
            ? fenceCondition(fence)
            : or(
                isNull(busabaseAgentSessions.leaseOwnerId),
                isNull(busabaseAgentSessions.leaseExpiresAt),
                lte(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
              ),
        ),
      )
      .returning();
    return updated.length === 1;
  } catch (error) {
    warn("persisting agent session model option", error);
    return false;
  }
}

/**
 * Append transcript rows. Local callers may pass coalesced turn batches;
 * remote callers retain original event sequences for cross-worker streaming.
 *
 * When `fence` is given, the whole batch is written inside one transaction
 * gated on a fenced no-op update of the owning session row: if the caller's
 * owner+token is no longer the row's current lease occupant, the update
 * matches zero rows, the transaction rolls back, and NONE of the batch is
 * written — a superseded worker can never land a partial transcript.
 */
export async function persistSessionEvents(
  events: AgentSessionEventVO[],
  fence?: LeaseFence,
): Promise<boolean> {
  if (events.length === 0) return true;
  const sessionId = events[0]?.sessionId;
  if (!sessionId || events.some((event) => event.sessionId !== sessionId)) return false;
  const database = await db();
  const rows = events.map((event) => ({
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
  }));
  try {
    if (!fence) {
      await database.insert(busabaseAgentSessionEvents).values(rows);
      return true;
    }
    let fenced = true;
    await database.transaction(async (tx) => {
      const stillOwned = await tx
        .update(busabaseAgentSessions)
        .set({ lastActivityAt: new Date() })
        .where(
          and(
            eq(busabaseAgentSessions.id, sessionId),
            scopeCondition(currentScope()),
            fenceCondition(fence),
          ),
        )
        .returning();
      if (stillOwned.length !== 1) {
        fenced = false;
        return;
      }
      await tx.insert(busabaseAgentSessionEvents).values(rows);
    });
    return fenced;
  } catch (error) {
    warn("persisting agent session events", error);
    return false;
  }
}

/**
 * Boundary validation for the durable mirror of `LiveSession.modelOption`
 * (PUL-246): a raw `jsonb` column is never trusted verbatim, so a value that
 * fails the contract's own VO shape — an old shape, a partial write, a `{}`
 * left by some future migration — degrades to `null` instead of surfacing a
 * malformed picker or throwing during a list read.
 *
 * Only `remote-websocket` rows may carry a durable value at all:
 * `local-subprocess` has no process left once the row is loaded from history,
 * so persisting anything for it would just be a value nothing can ever act
 * on. And a terminal session (`ended`/`failed`) never advertises a picker —
 * there is no running turn to send `session/set_config_option` to — even if
 * an older write left a value behind.
 */
function parseStoredModelOption(
  row: Pick<typeof busabaseAgentSessions.$inferSelect, "modelOption" | "status" | "transport">,
): AgentSessionModelOptionVO | null {
  if (row.transport !== "remote-websocket") return null;
  if (row.status === "ended" || row.status === "failed") return null;
  const parsed = AgentSessionModelOptionVOSchema.nullable().safeParse(row.modelOption ?? null);
  return parsed.success ? parsed.data : null;
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
  modelOption: parseStoredModelOption(row),
});

export interface AgentSessionRuntimeRecord {
  session: AgentSessionVO;
  /** Agent-owned ACP id. Kept server-side; never crosses the VO boundary. */
  acpSessionId: string | null;
  /** Lets a reattached worker continue the outer session's event sequence. */
  lastEventSeq: number;
}

/** Load one session's durable runtime identity within the current space and actor. */
export async function loadSessionRuntime(
  sessionId: string,
  scope: AgentSessionScope = currentScope(),
): Promise<AgentSessionRuntimeRecord | null> {
  const database = await db();
  try {
    const [row] = await database
      .select()
      .from(busabaseAgentSessions)
      .where(and(eq(busabaseAgentSessions.id, sessionId), scopeCondition(scope)))
      .limit(1);
    if (!row) return null;

    const [latestEvent] = await database
      .select({ seq: busabaseAgentSessionEvents.seq })
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, sessionId))
      .orderBy(desc(busabaseAgentSessionEvents.seq))
      .limit(1);

    return {
      session: toVO(row),
      acpSessionId: row.acpSessionId,
      lastEventSeq: latestEvent?.seq ?? 0,
    };
  } catch (error) {
    warn("loading agent session runtime", error);
    return null;
  }
}

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
  const scope = currentScope();
  try {
    const rows = await database
      .select()
      .from(busabaseAgentSessions)
      .where(scopeCondition(scope))
      .orderBy(desc(busabaseAgentSessions.lastActivityAt));
    return rows.map(toVO);
  } catch (error) {
    warn("loading agent sessions", error);
    return [];
  }
}

/** One session only when it belongs to the current request's space and actor. */
export async function loadScopedSession(sessionId: string): Promise<AgentSessionVO | null> {
  const database = await db();
  const rows = await database
    .select()
    .from(busabaseAgentSessions)
    .where(and(eq(busabaseAgentSessions.id, sessionId), scopeCondition(currentScope())))
    .limit(1);
  return rows[0] ? toVO(rows[0]) : null;
}

export async function loadSessionPageCandidates(input: {
  slug: string;
  limit: number;
  cursor: AgentSessionCursor | null;
}): Promise<AgentSessionVO[]> {
  const database = await db();
  const actorId = getContextActorId();
  const cursorTime = input.cursor ? new Date(input.cursor.lastActivityAt) : null;
  try {
    const rows = await database
      .select()
      .from(busabaseAgentSessions)
      .where(
        and(
          eq(busabaseAgentSessions.spaceId, getContextSpaceId()),
          eq(busabaseAgentSessions.slug, input.slug),
          actorId
            ? eq(busabaseAgentSessions.actorId, actorId)
            : isNull(busabaseAgentSessions.actorId),
          input.cursor && cursorTime
            ? or(
                lt(busabaseAgentSessions.lastActivityAt, cursorTime),
                and(
                  eq(busabaseAgentSessions.lastActivityAt, cursorTime),
                  lt(busabaseAgentSessions.id, input.cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(busabaseAgentSessions.lastActivityAt), desc(busabaseAgentSessions.id))
      .limit(input.limit);
    return rows.map(toVO);
  } catch (error) {
    warn("loading an agent session page", error);
    return [];
  }
}

/** Delete every persisted session (and cascaded transcript event) for one connected agent. */
export async function deleteSessionsBySlug(slug: string): Promise<number> {
  const database = await db();
  const deleted = await database
    .delete(busabaseAgentSessions)
    .where(and(scopeCondition(currentScope()), eq(busabaseAgentSessions.slug, slug)))
    .returning();
  return deleted.length;
}

/**
 * Distributed disconnect tombstone. Other server instances must honor this
 * terminal row even if they still own a stale in-memory ACP connection.
 */
export async function endSessionsBySlug(slug: string): Promise<string[]> {
  const database = await db();
  const ended = await database
    .update(busabaseAgentSessions)
    .set({ status: "ended", endedAt: new Date(), lastActivityAt: new Date() })
    .where(
      and(
        scopeCondition(currentScope()),
        eq(busabaseAgentSessions.slug, slug),
        notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
      ),
    )
    .returning();
  return ended.map((row) => row.id);
}

/** Tombstone one user-ended session before its local process is closed. */
export async function endSessionById(sessionId: string): Promise<boolean> {
  const database = await db();
  const ended = await database
    .update(busabaseAgentSessions)
    .set({ status: "ended", endedAt: new Date(), lastActivityAt: new Date() })
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeCondition(currentScope()),
        notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
      ),
    )
    .returning();
  return ended.length > 0;
}

/** Assign the old single-Buda slug to the credential's durable agent identity. */
export async function normalizeLegacyBudaSessions(canonicalSlug: string): Promise<number> {
  if (!canonicalSlug.startsWith("buda:")) return 0;
  const database = await db();
  const updated = await database
    .update(busabaseAgentSessions)
    .set({ slug: canonicalSlug })
    .where(and(scopeCondition(currentScope()), eq(busabaseAgentSessions.slug, "buda")))
    .returning();
  return updated.length;
}

/** Replay a persisted transcript — what a client sees for a session that outlived its process. */
export async function loadSessionEvents(
  sessionId: string,
  afterSeq: number,
): Promise<AgentSessionEventVO[]> {
  const database = await db();
  try {
    const rows = await database
      .select({ event: busabaseAgentSessionEvents })
      .from(busabaseAgentSessionEvents)
      .innerJoin(
        busabaseAgentSessions,
        eq(busabaseAgentSessionEvents.sessionId, busabaseAgentSessions.id),
      )
      .where(
        and(
          eq(busabaseAgentSessionEvents.sessionId, sessionId),
          gt(busabaseAgentSessionEvents.seq, afterSeq),
          scopeCondition(currentScope()),
        ),
      )
      .orderBy(asc(busabaseAgentSessionEvents.seq));
    return rows.map(({ event: row }) => {
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
 * `session/load` can reattach, which is what `loadSessionRuntime` powers.
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
