import {
  AgentSessionCommandReceiptVOSchema,
  type AgentSessionConfigSelectVO,
  type AgentSessionEventVO,
  type AgentSessionModelOptionVO,
  AgentSessionModelOptionVOSchema,
  type AgentSessionModeOptionVO,
  AgentSessionModeOptionVOSchema,
  AgentSessionRecoverySnapshotVOSchema,
  type AgentSessionStatus,
  type AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { getContextActorId, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseAgentSessionCommands } from "../schema/agent-session-commands";
import { busabaseAgentSessionEvents } from "../schema/agent-session-events";
import { busabaseAgentSessions } from "../schema/agent-sessions";
import type { AgentSessionCursor } from "../utils/agent-session-pagination";
import {
  agentSessionScopeReferences,
  logAgentSessionDiagnostic,
} from "./agent-session-diagnostics";

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
const db = async () => {
  try {
    return await getDb();
  } catch (error) {
    logAgentSessionDiagnostic(
      "database_resolution_failed",
      { stage: "database_resolution", outcome: "storage_failure" },
      { level: "error", error },
    );
    throw error;
  }
};

/** Rows a restart left behind claiming to be alive. */
const LIVE_STATUSES: AgentSessionStatus[] = ["connecting", "idle", "busy", "waiting_permission"];

function warn(what: string, error: unknown, fields: Record<string, unknown> = {}) {
  logAgentSessionDiagnostic(
    "store_operation_failed",
    { stage: what.replaceAll(/[^a-zA-Z0-9]+/g, "_"), outcome: "storage_failure", ...fields },
    { level: "warn", error },
  );
}

function storeOutcome(
  stage: string,
  outcome:
    | "committed"
    | "loaded"
    | "query_completed"
    | "predicate_not_matched"
    | "ownership_rejected",
  startedAt: number,
  fields: Record<string, unknown>,
): void {
  const rejected = outcome === "ownership_rejected" || outcome === "predicate_not_matched";
  logAgentSessionDiagnostic(
    rejected ? "store_predicate_rejected" : "store_operation_completed",
    {
      stage,
      outcome,
      ...(rejected ? { reason: "predicate_not_matched" } : {}),
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...fields,
    },
    { level: rejected ? "warn" : "info" },
  );
}

export interface AgentSessionScope {
  readonly spaceId: string;
  readonly actorId: string | null;
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
  const startedAt = Date.now();
  const fields = { sessionId: session.id, ...agentSessionScopeReferences(scope) };
  try {
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
    storeOutcome("session_created", "committed", startedAt, fields);
  } catch (error) {
    warn("session_created", error, fields);
    throw error;
  }
}

/** Persist the inner id without overwriting an in-flight prompt reservation. */
export async function persistSessionAcpIdentity(
  sessionId: string,
  acpSessionId: string,
  scope: AgentSessionScope = currentScope(),
): Promise<void> {
  const database = await db();
  const startedAt = Date.now();
  const fields = { sessionId, acpSessionId, ...agentSessionScopeReferences(scope) };
  try {
    await database
      .update(busabaseAgentSessions)
      .set({ acpSessionId, lastActivityAt: new Date() })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeCondition(scope),
          eq(busabaseAgentSessions.journalMode, "legacy"),
        ),
      );
    storeOutcome("session_identity", "query_completed", startedAt, fields);
  } catch (error) {
    warn("session_identity", error, fields);
    throw error;
  }
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
  readonly sessionId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
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
  const startedAt = Date.now();
  const fields = { sessionId, ownerId, ttlSeconds, ...agentSessionScopeReferences(scope) };
  let claimed: typeof busabaseAgentSessions.$inferSelect | undefined;
  try {
    [claimed] = await database
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
          eq(busabaseAgentSessions.journalMode, "legacy"),
          inArray(busabaseAgentSessions.status, LIVE_STATUSES),
          or(
            isNull(busabaseAgentSessions.leaseOwnerId),
            isNull(busabaseAgentSessions.leaseExpiresAt),
            lte(busabaseAgentSessions.leaseExpiresAt, sql`now()`),
          ),
        ),
      )
      .returning();
  } catch (error) {
    warn("lease_acquire", error, fields);
    throw error;
  }
  if (!claimed || claimed.leaseOwnerId !== ownerId || claimed.leaseExpiresAt === null) {
    storeOutcome("lease_acquire", "predicate_not_matched", startedAt, fields);
    return null;
  }
  storeOutcome("lease_acquire", "committed", startedAt, {
    ...fields,
    fencingToken: claimed.leaseFencingToken,
  });
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
  const startedAt = Date.now();
  const fields = {
    sessionId,
    ownerId,
    fencingToken,
    ttlSeconds,
    ...agentSessionScopeReferences(scope),
  };
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
    storeOutcome(
      "lease_renew",
      renewed.length === 1 ? "committed" : "ownership_rejected",
      startedAt,
      fields,
    );
    return renewed.length === 1;
  } catch (error) {
    warn("lease_renew", error, fields);
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
  const startedAt = Date.now();
  const fields = { sessionId, ownerId, fencingToken, ...agentSessionScopeReferences(scope) };
  try {
    const released = await database
      .update(busabaseAgentSessions)
      .set({
        status: sql`case when ${busabaseAgentSessions.status} in ('busy', 'waiting_permission') then 'idle' else ${busabaseAgentSessions.status} end`,
        lastActivityAt: new Date(),
        leaseOwnerId: null,
        leaseExpiresAt: null,
      })
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
    storeOutcome(
      "lease_release",
      released.length === 1 ? "committed" : "ownership_rejected",
      startedAt,
      fields,
    );
    return released.length === 1;
  } catch (error) {
    warn("lease_release", error, fields);
    throw error;
  }
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
  const startedAt = Date.now();
  const fields = {
    sessionId: session.id,
    ...(fence ?? {}),
    ...agentSessionScopeReferences(scope),
  };
  try {
    const updated = await database
      .update(busabaseAgentSessions)
      .set({
        status: session.status,
        error: session.error,
        lastActivityAt: new Date(session.lastActivityAt),
        ...(acpSessionId === undefined ? {} : { acpSessionId }),
        ...(ended ? { endedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(busabaseAgentSessions.id, session.id),
          scopeCondition(scope),
          notInArray(busabaseAgentSessions.status, ["ended", "failed"]),
          eq(busabaseAgentSessions.journalMode, "legacy"),
          options?.expectedStatuses
            ? inArray(busabaseAgentSessions.status, options.expectedStatuses)
            : undefined,
          fenceCondition(fence),
        ),
      )
      .returning();
    storeOutcome(
      "session_state",
      updated.length === 1 ? "committed" : fence ? "ownership_rejected" : "predicate_not_matched",
      startedAt,
      fields,
    );
    return updated.length === 1;
  } catch (error) {
    warn("session_state", error, fields);
    return false;
  }
}

/**
 * Durable mirror of `LiveSession.modelOption` — the one write path
 * every discovery/update site funnels through, so the shape landing in
 * `jsonb` always matches what `parseStoredConfigOptions` will read back.
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
  thinkingOption: AgentSessionConfigSelectVO | null = null,
  modeOption: AgentSessionModeOptionVO | null = null,
): Promise<boolean> {
  const database = await db();
  const startedAt = Date.now();
  const fields = { sessionId, ...(fence ?? {}), ...agentSessionScopeReferences(scope) };
  try {
    const updated = await database
      .update(busabaseAgentSessions)
      // Keep old model-only snapshots readable; both selectors share one fenced write.
      .set({
        modelOption:
          thinkingOption || modeOption ? { modelOption, thinkingOption, modeOption } : modelOption,
      })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeCondition(scope),
          eq(busabaseAgentSessions.transport, "remote-websocket"),
          eq(busabaseAgentSessions.journalMode, "legacy"),
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
    storeOutcome(
      "session_model_options",
      updated.length === 1 ? "committed" : fence ? "ownership_rejected" : "predicate_not_matched",
      startedAt,
      fields,
    );
    return updated.length === 1;
  } catch (error) {
    warn("session_model_options", error, fields);
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
  scope: AgentSessionScope = currentScope(),
): Promise<boolean> {
  if (events.length === 0) return true;
  const sessionId = events[0]?.sessionId;
  if (!sessionId || events.some((event) => event.sessionId !== sessionId)) {
    logAgentSessionDiagnostic(
      "event_batch_rejected",
      { stage: "event_commit", outcome: "invalid_batch", eventCount: events.length },
      { level: "warn" },
    );
    return false;
  }
  const database = await db();
  const startedAt = Date.now();
  const fields = {
    sessionId,
    ...(fence ?? {}),
    ...agentSessionScopeReferences(scope),
    eventCount: events.length,
    seqFrom: events[0]?.seq,
    seqThrough: events.at(-1)?.seq,
  };
  const rows = events.map((event) => ({
    id: `agev_${event.sessionId}_${event.seq}`,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: event.kind,
    payload: {
      commandId: event.commandId,
      acpUpdate: event.acpUpdate,
      acpExtension: event.acpExtension,
      status: event.status,
      message: event.message,
      permissionRequest: event.permissionRequest,
      permissionRequestId: event.permissionRequestId,
      permissionOptionId: event.permissionOptionId,
      inputRequest: event.inputRequest,
      inputRequestId: event.inputRequestId,
      inputResponse: event.inputResponse,
    } as Record<string, unknown>,
    at: new Date(event.at),
  }));
  try {
    let fenced = true;
    await database.transaction(async (tx) => {
      const [mode] = await tx
        .select({ journalMode: busabaseAgentSessions.journalMode })
        .from(busabaseAgentSessions)
        .where(and(eq(busabaseAgentSessions.id, sessionId), scopeCondition(scope)))
        .for("update");
      // New-build legacy call sites must never bypass the session supervisor.
      // The coordinated deployment drain is still required for old binaries.
      if (!mode || mode.journalMode !== "legacy") {
        fenced = false;
        return;
      }
      if (!fence) {
        await tx.insert(busabaseAgentSessionEvents).values(rows);
        return;
      }
      const stillOwned = await tx
        .update(busabaseAgentSessions)
        .set({ lastActivityAt: new Date() })
        .where(
          and(
            eq(busabaseAgentSessions.id, sessionId),
            scopeCondition(scope),
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
    storeOutcome("event_commit", fenced ? "committed" : "ownership_rejected", startedAt, fields);
    return fenced;
  } catch (error) {
    warn("event_commit", error, fields);
    return false;
  }
}

/**
 * Boundary validation for the durable mirror of `LiveSession.modelOption`:
 * a raw `jsonb` column is never trusted verbatim, so a value that
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
export function parseStoredConfigOptions(
  row: Pick<typeof busabaseAgentSessions.$inferSelect, "modelOption" | "status" | "transport">,
): Pick<AgentSessionVO, "modelOption" | "thinkingOption" | "modeOption"> {
  const empty = { modelOption: null, thinkingOption: null, modeOption: null };
  if (row.transport !== "remote-websocket") return empty;
  if (row.status === "ended" || row.status === "failed") return empty;
  const stored = row.modelOption;
  if (
    stored &&
    typeof stored === "object" &&
    ("thinkingOption" in stored || "modeOption" in stored)
  ) {
    const snapshot = stored as {
      modelOption?: unknown;
      thinkingOption?: unknown;
      modeOption?: unknown;
    };
    const model = AgentSessionModelOptionVOSchema.nullable().safeParse(
      snapshot.modelOption ?? null,
    );
    const thinking = AgentSessionModelOptionVOSchema.nullable().safeParse(
      snapshot.thinkingOption ?? null,
    );
    const mode = AgentSessionModeOptionVOSchema.nullable().safeParse(snapshot.modeOption ?? null);
    // A partial/malformed envelope cannot supply authoritative dependent options.
    return model.success && thinking.success && mode.success
      ? { modelOption: model.data, thinkingOption: thinking.data, modeOption: mode.data }
      : empty;
  }
  const parsed = AgentSessionModelOptionVOSchema.nullable().safeParse(stored ?? null);
  return {
    modelOption: parsed.success ? parsed.data : null,
    thinkingOption: null,
    modeOption: null,
  };
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
  ...parseStoredConfigOptions(row),
  ...(row.journalMode === "supervised"
    ? {
        reliability: {
          connection: row.connectionState ?? "connecting",
          execution: row.executionState ?? "idle",
          synchronization: row.syncState ?? "recovering",
          ...(row.diagnosticRef ? { diagnosticRef: row.diagnosticRef } : {}),
        },
        ...(AgentSessionRecoverySnapshotVOSchema.safeParse(row.recoverySnapshot).success
          ? {
              recoverySnapshot: AgentSessionRecoverySnapshotVOSchema.parse(row.recoverySnapshot),
            }
          : {}),
      }
    : {}),
});

async function toVOWithCommands(
  row: typeof busabaseAgentSessions.$inferSelect,
): Promise<AgentSessionVO> {
  const session = toVO(row);
  if (row.journalMode === "supervised") {
    const { loadSessionCommands } = await import("./agent-session-journal-store");
    const scope = { spaceId: row.spaceId, actorId: row.actorId };
    const database = await db();
    const [commands, unsent] = await Promise.all([
      loadSessionCommands(row.id, scope),
      database
        .select({ command: busabaseAgentSessionCommands })
        .from(busabaseAgentSessionCommands)
        .innerJoin(
          busabaseAgentSessions,
          eq(busabaseAgentSessions.id, busabaseAgentSessionCommands.sessionId),
        )
        .where(
          and(
            eq(busabaseAgentSessions.id, row.id),
            scopeCondition(scope),
            eq(busabaseAgentSessionCommands.spaceId, row.spaceId),
            row.actorId === null
              ? isNull(busabaseAgentSessionCommands.actorId)
              : eq(busabaseAgentSessionCommands.actorId, row.actorId),
            eq(busabaseAgentSessionCommands.kind, "prompt"),
            eq(busabaseAgentSessionCommands.state, "rejected"),
            notExists(
              database
                .select({ one: sql`1` })
                .from(busabaseAgentSessionEvents)
                .where(
                  and(
                    eq(
                      busabaseAgentSessionEvents.sessionId,
                      busabaseAgentSessionCommands.sessionId,
                    ),
                    eq(busabaseAgentSessionEvents.kind, "acpUpdate"),
                    sql`${busabaseAgentSessionEvents.payload}->'acpUpdate'->>'sessionUpdate' = 'user_message'`,
                    or(
                      sql`${busabaseAgentSessionEvents.payload}->>'commandId' = ${busabaseAgentSessionCommands.commandId}`,
                      sql`${busabaseAgentSessionEvents.payload}->'acpUpdate'->>'commandId' = ${busabaseAgentSessionCommands.commandId}`,
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(busabaseAgentSessionCommands.createdAt))
        .limit(32),
    ]);
    // Accepted input remains recoverable even if rejected before its first
    // journal commit. Control terminal receipts never become chat messages.
    session.pendingCommands = [
      ...commands
        .filter((command) => command.state !== "completed" && command.state !== "rejected")
        .map((command) => AgentSessionCommandReceiptVOSchema.parse(command)),
      ...unsent.map(({ command }) =>
        AgentSessionCommandReceiptVOSchema.parse({
          ...command,
          createdAt: command.createdAt.toISOString(),
          expiresAt: command.expiresAt.toISOString(),
          presentation: command.presentation ?? undefined,
          targetCommandId: command.targetCommandId ?? undefined,
          errorCode: command.errorCode ?? undefined,
        }),
      ),
    ];
  }
  return session;
}

export interface AgentSessionRuntimeRecord {
  session: AgentSessionVO;
  /** Agent-owned ACP id. Kept server-side; never crosses the VO boundary. */
  acpSessionId: string | null;
  /** Lets a reattached worker continue the outer session's event sequence. */
  lastEventSeq: number;
  /** Highest durable Buda source event, committed atomically as part of its payload. */
  upstreamSeq?: number;
}

/** Load one session's durable runtime identity within the current space and actor. */
export async function loadSessionRuntime(
  sessionId: string,
  scope: AgentSessionScope = currentScope(),
): Promise<AgentSessionRuntimeRecord | null> {
  const database = await db();
  const startedAt = Date.now();
  const fields = { sessionId, ...agentSessionScopeReferences(scope) };
  try {
    const [row] = await database
      .select()
      .from(busabaseAgentSessions)
      .where(and(eq(busabaseAgentSessions.id, sessionId), scopeCondition(scope)))
      .limit(1);
    if (!row) {
      storeOutcome("session_runtime_read", "predicate_not_matched", startedAt, fields);
      return null;
    }

    const [latestEvent] = await database
      .select({ seq: busabaseAgentSessionEvents.seq })
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, sessionId))
      .orderBy(desc(busabaseAgentSessionEvents.seq))
      .limit(1);

    const validCursor = (value: SQL) => sql`case when jsonb_typeof(${value}) = 'number' then
      case when (${value})::text::numeric between 0 and 9007199254740991
        and trunc((${value})::text::numeric) = (${value})::text::numeric
        then (${value})::text::numeric end end`;
    const updateCursor = validCursor(
      sql`${busabaseAgentSessionEvents.payload}->'acpUpdate'->'_meta'->'buda.im'->'seq'`,
    );
    const extensionCursor = validCursor(
      sql`${busabaseAgentSessionEvents.payload}->'acpExtension'->'params'->'_meta'->'buda.im'->'seq'`,
    );
    const [source] = await database
      .select({ seq: sql<string | null>`max(greatest(${updateCursor}, ${extensionCursor}))` })
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, sessionId));
    const upstreamSeq = source?.seq == null ? undefined : Number(source.seq);

    storeOutcome("session_runtime_read", "loaded", startedAt, {
      ...fields,
      acpSessionId: row.acpSessionId,
      persistedSeq: latestEvent?.seq ?? 0,
      upstreamSeq,
    });

    return {
      session: await toVOWithCommands(row),
      acpSessionId: row.acpSessionId,
      lastEventSeq: latestEvent?.seq ?? 0,
      ...(upstreamSeq === undefined ? {} : { upstreamSeq }),
    };
  } catch (error) {
    warn("session_runtime_read", error, fields);
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
      // Same total order as `compareSessionsByRecency`: ending sessions ties
      // their activity, and the row order must not decide which comes first.
      .orderBy(
        desc(busabaseAgentSessions.lastActivityAt),
        desc(busabaseAgentSessions.createdAt),
        desc(busabaseAgentSessions.id),
      );
    return Promise.all(rows.map(toVOWithCommands));
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
  return rows[0] ? toVOWithCommands(rows[0]) : null;
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
    return Promise.all(rows.map(toVOWithCommands));
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
        commandId: payload.commandId,
        acpUpdate: payload.acpUpdate,
        acpExtension: payload.acpExtension,
        status: payload.status,
        message: payload.message,
        permissionRequest: payload.permissionRequest,
        permissionRequestId: payload.permissionRequestId,
        permissionOptionId: payload.permissionOptionId,
        inputRequest: payload.inputRequest,
        inputRequestId: payload.inputRequestId,
        inputResponse: payload.inputResponse,
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
