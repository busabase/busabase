import { randomUUID } from "node:crypto";
import {
  AgentSessionCommandIdSchema,
  type AgentSessionCommandKind,
  type AgentSessionCommandReceiptVO,
  type AgentSessionCommandState,
  type AgentSessionEventVO,
  AgentSessionEventVOSchema,
  type AgentSessionRecoverySnapshotVO,
  AgentSessionRecoverySnapshotVOSchema,
  type AgentSessionReliabilityVO,
  type AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { type DbInstance, getDb } from "../../../db";
import {
  type AgentSessionCommandPO,
  busabaseAgentSessionCommands,
} from "../schema/agent-session-commands";
import { busabaseAgentSessionEvents } from "../schema/agent-session-events";
import { busabaseAgentSessions } from "../schema/agent-sessions";
import { upstreamSeqOf } from "../utils/acp-fidelity";
import {
  describeAgentSessionStorageError,
  logAgentSessionDiagnostic,
} from "./agent-session-diagnostics";
import {
  agentSessionCommandDigest,
  agentSessionEventDigest,
  agentSessionJournalEnabled,
  agentSessionPendingCommandLimit,
  MAX_AGENT_SESSION_JOURNAL_BATCH,
  MAX_AGENT_SESSION_PENDING_COMMANDS,
} from "./agent-session-journal-policy";
import { type AgentSessionScope, parseStoredConfigOptions } from "./agent-session-store";

export type { AgentSessionCommandKind } from "busabase-contract/domains/agents/types";
export interface AgentSessionWriterFence {
  readonly ownerId: string;
  readonly epoch: number;
}
export interface AgentSessionWriterLease extends AgentSessionWriterFence {
  readonly sessionId: string;
  readonly bindingGeneration: number;
  readonly expiresAt: string;
}
export interface AgentSessionJournalInput {
  readonly identity: string;
  readonly event: Omit<AgentSessionEventVO, "sessionId" | "seq">;
  readonly sourceSeq?: number;
}
export interface AgentSessionCommandRecord extends AgentSessionCommandReceiptVO {
  readonly bindingGeneration: number;
  readonly claimingEpoch: number | null;
  readonly receipt: Record<string, unknown> | null;
}
export interface AgentSessionJournalRuntime {
  readonly session: AgentSessionVO;
  readonly status: AgentSessionVO["status"];
  readonly acpSessionId: string | null;
  readonly bindingGeneration: number;
  readonly journalMode: "legacy" | "supervised";
  readonly sourceCheckpoint: number | null;
  readonly sourceGeneration: string | null;
  readonly writerEpoch: number;
  readonly writerOwnerId: string | null;
  readonly writerExpiresAt: string | null;
  readonly activeCommandId: string | null;
  readonly creationState: "pending" | "dispatching" | "confirmed" | "unknown";
  readonly capabilities: Record<string, unknown> | null;
  readonly demandUntil: string | null;
  readonly recoverySnapshot: AgentSessionRecoverySnapshotVO | null;
}
type QueryDatabase = Pick<DbInstance, "select" | "update" | "insert">;
type SessionRow = typeof busabaseAgentSessions.$inferSelect;
const scopeWhere = (scope: AgentSessionScope) =>
  and(
    eq(busabaseAgentSessions.spaceId, scope.spaceId),
    scope.actorId === null
      ? isNull(busabaseAgentSessions.actorId)
      : eq(busabaseAgentSessions.actorId, scope.actorId),
  );
const commandScopeWhere = (scope: AgentSessionScope) =>
  and(
    eq(busabaseAgentSessionCommands.spaceId, scope.spaceId),
    scope.actorId === null
      ? isNull(busabaseAgentSessionCommands.actorId)
      : eq(busabaseAgentSessionCommands.actorId, scope.actorId),
  );
const writerWhere = (sessionId: string, fence: AgentSessionWriterFence, scope: AgentSessionScope) =>
  and(
    eq(busabaseAgentSessions.id, sessionId),
    scopeWhere(scope),
    eq(busabaseAgentSessions.journalMode, "supervised"),
    eq(busabaseAgentSessions.writerOwnerId, fence.ownerId),
    eq(busabaseAgentSessions.writerEpoch, fence.epoch),
    gt(busabaseAgentSessions.writerExpiresAt, sql`clock_timestamp()`),
  );
const terminalCommands: AgentSessionCommandState[] = ["completed", "rejected"];
const dataKinds: AgentSessionCommandKind[] = ["prompt", "config"];

async function lockSession(
  database: Pick<DbInstance, "select">,
  sessionId: string,
  scope: AgentSessionScope,
) {
  const [row] = await database
    .select()
    .from(busabaseAgentSessions)
    .where(and(eq(busabaseAgentSessions.id, sessionId), scopeWhere(scope)))
    .for("update");
  return row;
}

async function verifyWriter(
  database: QueryDatabase,
  sessionId: string,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
) {
  const rows = await database
    .update(busabaseAgentSessions)
    .set({ lastActivityAt: new Date() })
    .where(writerWhere(sessionId, fence, scope))
    .returning();
  return rows.length === 1;
}

function commandRecord(row: AgentSessionCommandPO): AgentSessionCommandRecord {
  return {
    commandId: row.commandId,
    kind: row.kind,
    state: row.state,
    payload: row.payload,
    ...(row.presentation ? { presentation: row.presentation } : {}),
    ...(row.targetCommandId ? { targetCommandId: row.targetCommandId } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    bindingGeneration: row.bindingGeneration,
    claimingEpoch: row.claimingEpoch,
    receipt: row.receipt,
  };
}

function sessionVO(row: SessionRow): AgentSessionVO {
  return {
    id: row.id,
    slug: row.slug,
    agentName: row.agentName,
    transport: row.transport,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    error: row.error,
    ...parseStoredConfigOptions(row),
    ...(AgentSessionRecoverySnapshotVOSchema.safeParse(row.recoverySnapshot).success
      ? {
          recoverySnapshot: AgentSessionRecoverySnapshotVOSchema.parse(row.recoverySnapshot),
        }
      : {}),
    ...(row.journalMode === "supervised"
      ? {
          reliability: {
            connection: row.connectionState ?? "connecting",
            execution: row.executionState ?? "idle",
            synchronization: row.syncState ?? "recovering",
            ...(row.diagnosticRef ? { diagnosticRef: row.diagnosticRef } : {}),
          },
        }
      : {}),
  };
}

export async function createJournalSession(
  session: AgentSessionVO,
  scope: AgentSessionScope,
  options: { bindingFingerprint?: string } = {},
): Promise<void> {
  if (!agentSessionJournalEnabled())
    throw new Error("Supervised ACP sessions require an explicit legacy-writer drain.");
  if (
    options.bindingFingerprint !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.bindingFingerprint)
  )
    throw new Error("The ACP endpoint binding fingerprint is invalid.");
  const database = await getDb();
  await database.insert(busabaseAgentSessions).values({
    id: session.id,
    spaceId: scope.spaceId,
    actorId: scope.actorId,
    slug: session.slug,
    agentName: session.agentName,
    transport: session.transport,
    status: session.status,
    createdAt: new Date(session.createdAt),
    lastActivityAt: new Date(session.lastActivityAt),
    journalMode: "supervised",
    demandUntil: sql`clock_timestamp() + interval '60 seconds'`,
    connectionState: "connecting",
    executionState: "idle",
    syncState: "recovering",
    ...(options.bindingFingerprint
      ? { capabilities: { bindingFingerprint: options.bindingFingerprint } }
      : {}),
  });
}

export async function enableSessionJournal(
  sessionId: string,
  scope: AgentSessionScope,
): Promise<boolean> {
  if (!agentSessionJournalEnabled()) return false;
  const database = await getDb();
  return database.transaction(async (tx) => {
    const row = await lockSession(tx, sessionId, scope);
    if (!row || row.transport !== "remote-websocket") return false;
    if (row.journalMode === "supervised") return true;
    const history = await tx
      .select()
      .from(busabaseAgentSessionEvents)
      .where(eq(busabaseAgentSessionEvents.sessionId, sessionId))
      .orderBy(asc(busabaseAgentSessionEvents.seq))
      .limit(10_001);
    if (history.length > 10_000) return false;
    const mappings = new Map<
      number,
      { id: string; identity: string; digest: string; assigned: boolean }
    >();
    const localUpdates = new Set([
      "user_message",
      "available_commands_update",
      "config_option_update",
      "current_mode_update",
      "session_info_update",
    ]);
    for (const entry of history) {
      const parsed = AgentSessionEventVOSchema.safeParse({
        ...entry.payload,
        sessionId,
        seq: entry.seq,
        kind: entry.kind,
        at: entry.at.toISOString(),
      });
      if (!parsed.success) return false;
      const event = parsed.data;
      const sourceSeq = upstreamSeqOf(event);
      if (sourceSeq === undefined) {
        const update = event.acpUpdate as { sessionUpdate?: unknown } | undefined;
        if (event.kind === "acpUpdate" && !localUpdates.has(String(update?.sessionUpdate)))
          return false;
        if (event.kind === "acpExtension" && event.acpExtension?.method !== "_acp-ui/lifecycle")
          return false;
        continue;
      }
      if (!row.acpSessionId || sourceSeq > 2_147_483_647) return false;
      const identity = `${sessionId}_${row.bindingGeneration}:remote:${sourceSeq}`;
      const digest = agentSessionEventDigest(event);
      if (
        entry.stableIdentity &&
        (entry.stableIdentity !== identity || entry.contentDigest !== digest)
      )
        return false;
      const prior = mappings.get(sourceSeq);
      if (prior && prior.digest !== digest) return false;
      if (!prior || entry.stableIdentity)
        mappings.set(sourceSeq, {
          id: entry.id,
          identity,
          digest,
          assigned: entry.stableIdentity !== null,
        });
    }
    const changed = await tx
      .update(busabaseAgentSessions)
      .set({
        journalMode: "supervised",
        journalHead: history.at(-1)?.seq ?? 0,
        sourceGeneration: row.acpSessionId,
        sourceCheckpoint: null,
        syncState: "recovering",
        connectionState: "connecting",
        creationState: row.acpSessionId ? "confirmed" : "pending",
        demandUntil: sql`clock_timestamp() + interval '60 seconds'`,
      })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeWhere(scope),
          or(
            isNull(busabaseAgentSessions.leaseExpiresAt),
            lte(busabaseAgentSessions.leaseExpiresAt, sql`clock_timestamp()`),
          ),
        ),
      )
      .returning();
    if (changed.length !== 1) return false;
    for (const [sourceSeq, mapping] of mappings) {
      if (mapping.assigned) continue;
      await tx
        .update(busabaseAgentSessionEvents)
        .set({
          stableIdentity: mapping.identity,
          contentDigest: mapping.digest,
          sourceSeq,
        })
        .where(eq(busabaseAgentSessionEvents.id, mapping.id));
    }
    // A metadata map is not evidence of a complete delivered prefix. Replay
    // still starts without a checkpoint and commits its ordered barrier.
    return true;
  });
}

export async function claimWriterLease(
  sessionId: string,
  ownerId: string,
  ttlSeconds: number,
  scope: AgentSessionScope,
): Promise<AgentSessionWriterLease | null> {
  const database = await getDb();
  const ttl = Math.max(1, Math.min(300, Math.floor(ttlSeconds)));
  return database.transaction(async (tx) => {
    if (!(await lockSession(tx, sessionId, scope))) return null;
    const [row] = await tx
      .update(busabaseAgentSessions)
      .set({
        writerOwnerId: ownerId,
        writerEpoch: sql`${busabaseAgentSessions.writerEpoch} + 1`,
        writerExpiresAt: sql`clock_timestamp() + (${ttl} * interval '1 second')`,
      })
      .where(
        and(
          eq(busabaseAgentSessions.id, sessionId),
          scopeWhere(scope),
          eq(busabaseAgentSessions.journalMode, "supervised"),
          notInArray(busabaseAgentSessions.status, ["ended"]),
          or(
            isNull(busabaseAgentSessions.writerOwnerId),
            isNull(busabaseAgentSessions.writerExpiresAt),
            lte(busabaseAgentSessions.writerExpiresAt, sql`clock_timestamp()`),
          ),
        ),
      )
      .returning();
    if (!row?.writerExpiresAt) return null;
    return {
      sessionId,
      ownerId,
      epoch: row.writerEpoch,
      bindingGeneration: row.bindingGeneration,
      expiresAt: row.writerExpiresAt.toISOString(),
    };
  });
}

export async function renewWriterLease(
  sessionId: string,
  fence: AgentSessionWriterFence,
  ttlSeconds: number,
  scope: AgentSessionScope,
): Promise<boolean> {
  const database = await getDb();
  const ttl = Math.max(1, Math.min(300, Math.floor(ttlSeconds)));
  return database.transaction(async (tx) => {
    if (!(await lockSession(tx, sessionId, scope))) return false;
    const rows = await tx
      .update(busabaseAgentSessions)
      .set({ writerExpiresAt: sql`clock_timestamp() + (${ttl} * interval '1 second')` })
      .where(writerWhere(sessionId, fence, scope))
      .returning();
    return rows.length === 1;
  });
}

export async function releaseWriterLease(
  sessionId: string,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
): Promise<boolean> {
  const database = await getDb();
  return database.transaction(async (tx) => {
    if (!(await lockSession(tx, sessionId, scope))) return false;
    const rows = await tx
      .update(busabaseAgentSessions)
      .set({ writerOwnerId: null, writerExpiresAt: null, connectionState: "disconnected" })
      .where(writerWhere(sessionId, fence, scope))
      .returning();
    return rows.length === 1;
  });
}

export type AgentSessionJournalAppendResult =
  | { outcome: "committed" | "already_committed"; events: AgentSessionEventVO[] }
  | {
      outcome: "ownership_lost" | "transient_failure" | "integrity_failure" | "unavailable";
      diagnosticRef: string;
    };

export async function appendJournalEvents(
  sessionId: string,
  inputs: readonly AgentSessionJournalInput[],
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
  checkpoint?: { sourceSeq: number; sourceGeneration?: string },
): Promise<AgentSessionJournalAppendResult> {
  const diagnosticRef = `agd_${randomUUID()}`;
  if (
    inputs.length > MAX_AGENT_SESSION_JOURNAL_BATCH ||
    (checkpoint && (!Number.isSafeInteger(checkpoint.sourceSeq) || checkpoint.sourceSeq < 0))
  ) {
    logAgentSessionDiagnostic(
      "journal_batch_rejected",
      {
        sessionId,
        diagnosticRef,
        stage: "journal_append",
        outcome: "integrity_failure",
        eventCount: inputs.length,
      },
      { level: "warn" },
    );
    return { outcome: "integrity_failure", diagnosticRef };
  }
  let validationComplete = false;
  try {
    const prepared = inputs.map((input) => ({
      ...input,
      digest: agentSessionEventDigest(input.event),
    }));
    validationComplete = true;
    const database = await getDb();
    const result = await database.transaction(
      async (tx): Promise<AgentSessionJournalAppendResult> => {
        const session = await lockSession(tx, sessionId, scope);
        if (!session || !(await verifyWriter(tx, sessionId, fence, scope))) {
          logAgentSessionDiagnostic(
            "journal_writer_rejected",
            {
              sessionId,
              diagnosticRef,
              stage: "journal_append",
              outcome: "ownership_lost",
              reason: "predicate_not_matched",
              ownerId: fence.ownerId,
              fencingToken: fence.epoch,
            },
            { level: "warn" },
          );
          return { outcome: "ownership_lost", diagnosticRef };
        }
        if (
          checkpoint?.sourceGeneration &&
          session.sourceGeneration &&
          checkpoint.sourceGeneration !== session.sourceGeneration
        )
          return { outcome: "integrity_failure", diagnosticRef };
        const events: AgentSessionEventVO[] = [];
        let head = session.journalHead;
        let inserted = false;
        for (const input of prepared) {
          if (
            !input.identity ||
            input.identity.length > 512 ||
            (input.sourceSeq !== undefined &&
              (!Number.isSafeInteger(input.sourceSeq) || input.sourceSeq < 0))
          )
            throw new JournalIntegrityFailure("Invalid journal event identity.");
          const [existing] = await tx
            .select()
            .from(busabaseAgentSessionEvents)
            .where(
              and(
                eq(busabaseAgentSessionEvents.sessionId, sessionId),
                eq(busabaseAgentSessionEvents.stableIdentity, input.identity),
              ),
            )
            .limit(1);
          if (existing) {
            if (existing.contentDigest !== input.digest)
              throw new JournalIntegrityFailure("Journal event identity content conflict.");
            events.push({
              ...(existing.payload as Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">),
              sessionId,
              seq: existing.seq,
              at: existing.at.toISOString(),
              kind: existing.kind,
            });
            continue;
          }
          head += 1;
          if (head > 2_147_483_647)
            throw new JournalIntegrityFailure("Journal sequence capacity exceeded.");
          const full = { ...input.event, sessionId, seq: head };
          const { at, ...payload } = input.event;
          await tx.insert(busabaseAgentSessionEvents).values({
            id: `agev_${sessionId}_${head}`,
            sessionId,
            seq: head,
            kind: input.event.kind,
            payload,
            at: new Date(at),
            stableIdentity: input.identity,
            contentDigest: input.digest,
            sourceSeq: input.sourceSeq,
          });
          events.push(full);
          inserted = true;
        }
        const changed = await tx
          .update(busabaseAgentSessions)
          .set({
            journalHead: head,
            ...(checkpoint
              ? {
                  sourceCheckpoint: Math.max(session.sourceCheckpoint ?? 0, checkpoint.sourceSeq),
                  ...(checkpoint.sourceGeneration
                    ? { sourceGeneration: checkpoint.sourceGeneration }
                    : {}),
                }
              : {}),
            lastActivityAt: new Date(),
          })
          .where(writerWhere(sessionId, fence, scope))
          .returning();
        if (changed.length !== 1) throw new JournalOwnershipLost();
        return { outcome: inserted ? "committed" : "already_committed", events };
      },
    );
    if (result.outcome === "committed" || result.outcome === "already_committed")
      logAgentSessionDiagnostic("journal_append_completed", {
        sessionId,
        stage: "journal_append",
        outcome: result.outcome,
        ownerId: fence.ownerId,
        fencingToken: fence.epoch,
        eventCount: result.events.length,
        seqFrom: result.events[0]?.seq,
        seqThrough: result.events.at(-1)?.seq,
        upstreamSeq: checkpoint?.sourceSeq,
      });
    else
      logAgentSessionDiagnostic(
        "journal_append_rejected",
        {
          sessionId,
          diagnosticRef,
          stage: "journal_append",
          outcome: result.outcome,
          ownerId: fence.ownerId,
          fencingToken: fence.epoch,
        },
        { level: "warn" },
      );
    return result;
  } catch (error) {
    const classification = describeAgentSessionStorageError(error);
    const transient =
      classification.driverCode !== undefined ||
      classification.sqlState?.startsWith("08") ||
      ["40001", "40P01", "55P03", "57014"].includes(classification.sqlState ?? "");
    const outcome =
      error instanceof JournalOwnershipLost
        ? "ownership_lost"
        : !validationComplete ||
            error instanceof JournalIntegrityFailure ||
            classification.sqlState?.startsWith("23")
          ? "integrity_failure"
          : transient
            ? "transient_failure"
            : "unavailable";
    logAgentSessionDiagnostic(
      "journal_append_failed",
      {
        stage: "journal_append",
        outcome,
        diagnosticRef,
        sessionId,
        ownerId: fence.ownerId,
        fencingToken: fence.epoch,
      },
      { level: "warn", error },
    );
    return { outcome, diagnosticRef };
  }
}
class JournalOwnershipLost extends Error {}
class JournalIntegrityFailure extends Error {}

export interface AgentSessionCommandAdmission {
  commandId: string;
  kind: AgentSessionCommandKind;
  payload: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  targetCommandId?: string;
  expiresAt?: string;
}
export type AgentSessionCommandAdmissionResult =
  | { outcome: "accepted" | "already_accepted"; receipt: AgentSessionCommandRecord }
  | { outcome: "busy" | "conflict" | "unavailable" };

export async function admitSessionCommand(
  sessionId: string,
  command: AgentSessionCommandAdmission,
  scope: AgentSessionScope,
): Promise<AgentSessionCommandAdmissionResult> {
  AgentSessionCommandIdSchema.parse(command.commandId);
  const digest = agentSessionCommandDigest({
    kind: command.kind,
    payload: command.payload,
    presentation: command.presentation,
    targetCommandId: command.targetCommandId,
  });
  const database = await getDb();
  return database.transaction(async (tx): Promise<AgentSessionCommandAdmissionResult> => {
    const session = await lockSession(tx, sessionId, scope);
    if (!session || session.journalMode !== "supervised") return { outcome: "unavailable" };
    const [existing] = await tx
      .select()
      .from(busabaseAgentSessionCommands)
      .where(
        and(
          eq(busabaseAgentSessionCommands.sessionId, sessionId),
          eq(busabaseAgentSessionCommands.commandId, command.commandId),
          commandScopeWhere(scope),
        ),
      )
      .limit(1);
    if (existing)
      return existing.contentDigest === digest
        ? { outcome: "already_accepted", receipt: commandRecord(existing) }
        : { outcome: "conflict" };
    if (
      dataKinds.includes(command.kind) &&
      (session.executionState === "unknown" || session.syncState === "gap")
    )
      return { outcome: "unavailable" };
    if (
      session.status === "ended" ||
      session.status === "failed" ||
      (session.creationState === "unknown" && session.capabilities?.commandReceipts !== true)
    )
      return { outcome: "unavailable" };
    if (dataKinds.includes(command.kind) && session.activeCommandId) return { outcome: "busy" };
    const pendingLimit = agentSessionPendingCommandLimit();
    const pending = await tx
      .select({ id: busabaseAgentSessionCommands.id })
      .from(busabaseAgentSessionCommands)
      .where(
        and(
          eq(busabaseAgentSessionCommands.sessionId, sessionId),
          commandScopeWhere(scope),
          notInArray(busabaseAgentSessionCommands.state, terminalCommands),
        ),
      )
      .limit(pendingLimit);
    if (pending.length >= pendingLimit) return { outcome: "busy" };
    const expiresAt = command.expiresAt
      ? new Date(command.expiresAt)
      : new Date(Date.now() + (dataKinds.includes(command.kind) ? 24 * 60 * 60_000 : 5 * 60_000));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
      return { outcome: "unavailable" };
    const [row] = await tx
      .insert(busabaseAgentSessionCommands)
      .values({
        id: `agcmd_${sessionId}_${command.commandId}`,
        sessionId,
        spaceId: scope.spaceId,
        actorId: scope.actorId,
        commandId: command.commandId,
        kind: command.kind,
        contentDigest: digest,
        payload: command.payload,
        presentation: command.presentation,
        targetCommandId:
          command.targetCommandId ??
          (dataKinds.includes(command.kind) ? null : session.activeCommandId),
        bindingGeneration: session.bindingGeneration,
        expiresAt,
      })
      .returning();
    await tx
      .update(busabaseAgentSessions)
      .set({
        ...(dataKinds.includes(command.kind)
          ? { activeCommandId: command.commandId, executionState: "reserved" as const }
          : {}),
        demandUntil: sql`clock_timestamp() + interval '60 seconds'`,
      })
      .where(and(eq(busabaseAgentSessions.id, sessionId), scopeWhere(scope)));
    if (!row) throw new Error("Command admission returned no row.");
    return { outcome: "accepted", receipt: commandRecord(row) };
  });
}

export async function loadSessionCommands(
  sessionId: string,
  scope: AgentSessionScope,
): Promise<AgentSessionCommandRecord[]> {
  const database = await getDb();
  const query = () =>
    database
      .select({ command: busabaseAgentSessionCommands })
      .from(busabaseAgentSessionCommands)
      .innerJoin(
        busabaseAgentSessions,
        eq(busabaseAgentSessions.id, busabaseAgentSessionCommands.sessionId),
      );
  const scoped = and(
    eq(busabaseAgentSessions.id, sessionId),
    scopeWhere(scope),
    commandScopeWhere(scope),
  );
  // Completed controls cannot bury an old active prompt. Pending admission
  // has a hard cap, so every nonterminal receipt fits this bounded view even
  // when an operator lowers the configured limit after accepting commands.
  const [pending, recentTerminal] = await Promise.all([
    query()
      .where(and(scoped, notInArray(busabaseAgentSessionCommands.state, terminalCommands)))
      .orderBy(
        sql`case when ${busabaseAgentSessionCommands.commandId} = ${busabaseAgentSessions.activeCommandId} then 0 else 1 end`,
        asc(busabaseAgentSessionCommands.createdAt),
      )
      .limit(MAX_AGENT_SESSION_PENDING_COMMANDS),
    query()
      .where(and(scoped, inArray(busabaseAgentSessionCommands.state, terminalCommands)))
      .orderBy(desc(busabaseAgentSessionCommands.createdAt), desc(busabaseAgentSessionCommands.id))
      .limit(32),
  ]);
  // This is a view, not deletion: terminal idempotency proof remains available
  // to targeted lookup until the owning session's configured whole-session
  // retention/cascade removes it (30 days after terminal activity by default).
  // A command can finish between the two read-committed queries. Prefer the
  // later terminal observation and return one receipt per durable identity.
  const byIdentity = new Map(
    [...pending, ...recentTerminal].map(({ command }) => [command.commandId, command]),
  );
  const records = [...byIdentity.values()];
  return [
    ...records.filter((command) => !terminalCommands.includes(command.state)),
    ...records.filter((command) => terminalCommands.includes(command.state)),
  ].map(commandRecord);
}

/** Exact proof lookup is independent of the bounded pending/recent UI view. */
export async function loadSessionCommand(
  sessionId: string,
  commandId: string,
  scope: AgentSessionScope,
): Promise<AgentSessionCommandRecord | null> {
  const database = await getDb();
  const [row] = await database
    .select({ command: busabaseAgentSessionCommands })
    .from(busabaseAgentSessionCommands)
    .innerJoin(
      busabaseAgentSessions,
      eq(busabaseAgentSessions.id, busabaseAgentSessionCommands.sessionId),
    )
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeWhere(scope),
        commandScopeWhere(scope),
        eq(busabaseAgentSessionCommands.commandId, commandId),
      ),
    )
    .limit(1);
  return row ? commandRecord(row.command) : null;
}

/** Caller already owns the scoped parent row lock and checked the current fence. */
async function expireLockedSessionCommands(
  tx: QueryDatabase,
  session: SessionRow,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
): Promise<void> {
  const sessionId = session.id;
  const expired = await tx
    .update(busabaseAgentSessionCommands)
    .set({
      state: "rejected",
      errorCode: "COMMAND_EXPIRED_BEFORE_DISPATCH",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(busabaseAgentSessionCommands.sessionId, sessionId),
        commandScopeWhere(scope),
        lte(busabaseAgentSessionCommands.expiresAt, sql`clock_timestamp()`),
        inArray(busabaseAgentSessionCommands.state, ["queued", "claimed"]),
      ),
    )
    .returning();
  if (expired.some((command) => command.commandId === session.activeCommandId)) {
    const cleared = await tx
      .update(busabaseAgentSessions)
      .set({ activeCommandId: null, executionState: "idle" })
      .where(writerWhere(sessionId, fence, scope))
      .returning();
    if (cleared.length !== 1) throw new JournalOwnershipLost();
    session.activeCommandId = null;
    session.executionState = "idle";
  }
  const ambiguous = await tx
    .update(busabaseAgentSessionCommands)
    .set({
      state: "unknown",
      errorCode: "DISPATCH_OUTCOME_UNKNOWN",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(busabaseAgentSessionCommands.sessionId, sessionId),
        commandScopeWhere(scope),
        lte(busabaseAgentSessionCommands.expiresAt, sql`clock_timestamp()`),
        inArray(busabaseAgentSessionCommands.state, ["dispatching", "observed"]),
        // Admission/recovery expiry is not a live turn or human-decision
        // deadline. Only detached/taken-over work requires expiry reconciliation.
        session.connectionState === "connected"
          ? or(
              isNull(busabaseAgentSessionCommands.claimingEpoch),
              ne(busabaseAgentSessionCommands.claimingEpoch, fence.epoch),
            )
          : undefined,
      ),
    )
    .returning();
  if (ambiguous.some((command) => command.commandId === session.activeCommandId)) {
    const kept = await tx
      .update(busabaseAgentSessions)
      .set({ executionState: "unknown" })
      .where(writerWhere(sessionId, fence, scope))
      .returning();
    if (kept.length !== 1) throw new JournalOwnershipLost();
    session.executionState = "unknown";
  }
  if ((expired.length || ambiguous.length) && !(await verifyWriter(tx, sessionId, fence, scope)))
    throw new JournalOwnershipLost();
}

/** Maintenance is independent of endpoint readiness or command claiming. */
export async function expireSessionCommands(
  sessionId: string,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
): Promise<boolean> {
  const database = await getDb();
  try {
    return await database.transaction(async (tx) => {
      const session = await lockSession(tx, sessionId, scope);
      if (!session || !(await verifyWriter(tx, sessionId, fence, scope))) return false;
      await expireLockedSessionCommands(tx, session, fence, scope);
      return true;
    });
  } catch (error) {
    if (error instanceof JournalOwnershipLost) return false;
    throw error;
  }
}

/** A read-only polling hint. Admission can race this result; the next bounded
 * scan sees new work, while claiming/expiry still use the locked writer fence. */
export async function hasPendingSessionCommands(
  sessionId: string,
  scope: AgentSessionScope,
): Promise<boolean> {
  const database = await getDb();
  const rows = await database
    .select({ id: busabaseAgentSessionCommands.id })
    .from(busabaseAgentSessionCommands)
    .where(
      and(
        eq(busabaseAgentSessionCommands.sessionId, sessionId),
        commandScopeWhere(scope),
        notInArray(busabaseAgentSessionCommands.state, ["completed", "rejected"]),
      ),
    )
    .limit(1);
  return rows.length !== 0;
}

export async function claimSessionCommands(
  sessionId: string,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
  lane: "data" | "control" = "data",
): Promise<AgentSessionCommandRecord[]> {
  const database = await getDb();
  return database.transaction(async (tx) => {
    const session = await lockSession(tx, sessionId, scope);
    if (!session || !(await verifyWriter(tx, sessionId, fence, scope))) return [];
    await expireLockedSessionCommands(tx, session, fence, scope);
    const rows = await tx
      .select()
      .from(busabaseAgentSessionCommands)
      .where(
        and(
          eq(busabaseAgentSessionCommands.sessionId, sessionId),
          commandScopeWhere(scope),
          eq(busabaseAgentSessionCommands.bindingGeneration, session.bindingGeneration),
          or(
            eq(busabaseAgentSessionCommands.state, "queued"),
            and(
              eq(busabaseAgentSessionCommands.state, "claimed"),
              or(
                isNull(busabaseAgentSessionCommands.claimingEpoch),
                ne(busabaseAgentSessionCommands.claimingEpoch, fence.epoch),
              ),
            ),
          ),
          lane === "data"
            ? inArray(busabaseAgentSessionCommands.kind, dataKinds)
            : notInArray(busabaseAgentSessionCommands.kind, dataKinds),
          gt(busabaseAgentSessionCommands.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(busabaseAgentSessionCommands.createdAt))
      .limit(lane === "data" ? 1 : 4);
    const claimed: AgentSessionCommandRecord[] = [];
    for (const row of rows) {
      if (lane === "data" && session.activeCommandId !== row.commandId) continue;
      const changed = await tx
        .update(busabaseAgentSessionCommands)
        .set({ state: "claimed", claimingEpoch: fence.epoch, updatedAt: new Date() })
        .where(
          and(
            eq(busabaseAgentSessionCommands.id, row.id),
            inArray(busabaseAgentSessionCommands.state, ["queued", "claimed"]),
          ),
        )
        .returning();
      if (changed[0]) claimed.push(commandRecord(changed[0]));
    }
    return claimed;
  });
}

export async function transitionSessionCommand(
  sessionId: string,
  commandId: string,
  fromStates: readonly AgentSessionCommandState[],
  toState: AgentSessionCommandState,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
  details: { receipt?: Record<string, unknown>; errorCode?: string } = {},
): Promise<boolean> {
  const database = await getDb();
  return database.transaction(async (tx) => {
    const session = await lockSession(tx, sessionId, scope);
    if (!session || !(await verifyWriter(tx, sessionId, fence, scope))) return false;
    const changed = await tx
      .update(busabaseAgentSessionCommands)
      .set({ state: toState, claimingEpoch: fence.epoch, updatedAt: new Date(), ...details })
      .where(
        and(
          eq(busabaseAgentSessionCommands.sessionId, sessionId),
          eq(busabaseAgentSessionCommands.commandId, commandId),
          commandScopeWhere(scope),
          inArray(busabaseAgentSessionCommands.state, [...fromStates]),
        ),
      )
      .returning();
    if (!changed[0]) return false;
    if (terminalCommands.includes(toState) && session.activeCommandId === commandId)
      await tx
        .update(busabaseAgentSessions)
        .set({ activeCommandId: null, executionState: "idle" })
        .where(writerWhere(sessionId, fence, scope));
    return true;
  });
}

export interface AgentSessionJournalRuntimePatch {
  recoverySnapshot?: AgentSessionRecoverySnapshotVO;
  status?: AgentSessionVO["status"];
  error?: string | null;
  acpSessionId?: string | null;
  modelOption?: unknown;
  syncState?: AgentSessionReliabilityVO["synchronization"];
  connectionState?: AgentSessionReliabilityVO["connection"];
  executionState?: AgentSessionReliabilityVO["execution"];
  capabilities?: Record<string, unknown>;
  sourceGeneration?: string;
  creationState?: AgentSessionJournalRuntime["creationState"];
  diagnosticRef?: string | null;
}
export async function updateJournalRuntime(
  sessionId: string,
  patch: AgentSessionJournalRuntimePatch,
  fence: AgentSessionWriterFence,
  scope: AgentSessionScope,
): Promise<boolean> {
  const database = await getDb();
  return database.transaction(async (tx) => {
    if (!(await lockSession(tx, sessionId, scope))) return false;
    const changed = await tx
      .update(busabaseAgentSessions)
      .set({
        ...patch,
        lastActivityAt: new Date(),
        ...(patch.executionState === "idle"
          ? {
              executionState: sql`case when ${busabaseAgentSessions.activeCommandId} is null then 'idle' else coalesce(${busabaseAgentSessions.executionState}, 'reserved') end`,
            }
          : {}),
      })
      .where(writerWhere(sessionId, fence, scope))
      .returning();
    return changed.length === 1;
  });
}

export async function getJournalRuntime(
  sessionId: string,
  scope: AgentSessionScope,
): Promise<AgentSessionJournalRuntime | null> {
  const database = await getDb();
  const [row] = await database
    .select()
    .from(busabaseAgentSessions)
    .where(and(eq(busabaseAgentSessions.id, sessionId), scopeWhere(scope)))
    .limit(1);
  if (!row) return null;
  return {
    session: sessionVO(row),
    status: row.status,
    acpSessionId: row.acpSessionId,
    bindingGeneration: row.bindingGeneration,
    journalMode: row.journalMode,
    sourceCheckpoint: row.sourceCheckpoint,
    sourceGeneration: row.sourceGeneration,
    writerEpoch: row.writerEpoch,
    writerOwnerId: row.writerOwnerId,
    writerExpiresAt: row.writerExpiresAt?.toISOString() ?? null,
    activeCommandId: row.activeCommandId,
    capabilities: row.capabilities,
    creationState: row.creationState,
    demandUntil: row.demandUntil?.toISOString() ?? null,
    recoverySnapshot: AgentSessionRecoverySnapshotVOSchema.safeParse(row.recoverySnapshot).success
      ? AgentSessionRecoverySnapshotVOSchema.parse(row.recoverySnapshot)
      : null,
  };
}

export async function touchJournalDemand(
  sessionId: string,
  scope: AgentSessionScope,
  ttlSeconds = 60,
): Promise<boolean> {
  const database = await getDb();
  const ttl = Math.max(1, Math.min(300, Math.floor(ttlSeconds)));
  const changed = await database
    .update(busabaseAgentSessions)
    .set({ demandUntil: sql`clock_timestamp() + (${ttl} * interval '1 second')` })
    .where(
      and(
        eq(busabaseAgentSessions.id, sessionId),
        scopeWhere(scope),
        eq(busabaseAgentSessions.journalMode, "supervised"),
      ),
    )
    .returning();
  return changed.length === 1;
}

/** Host-only discovery uses its explicit DB, never a request/OSS fallback. */
export async function listSessionCommandDemand(
  database: DbInstance,
  limit = 50,
  claimableOnly = false,
): Promise<Array<{ sessionId: string; spaceId: string; actorId: string | null }>> {
  return database
    .select({
      sessionId: busabaseAgentSessions.id,
      spaceId: busabaseAgentSessions.spaceId,
      actorId: busabaseAgentSessions.actorId,
    })
    .from(busabaseAgentSessions)
    .where(
      and(
        eq(busabaseAgentSessions.journalMode, "supervised"),
        notInArray(busabaseAgentSessions.status, ["ended"]),
        ...(claimableOnly
          ? [
              or(
                isNull(busabaseAgentSessions.writerOwnerId),
                isNull(busabaseAgentSessions.writerExpiresAt),
                lte(busabaseAgentSessions.writerExpiresAt, sql`clock_timestamp()`),
              ),
            ]
          : []),
        or(isNull(busabaseAgentSessions.syncState), ne(busabaseAgentSessions.syncState, "gap")),
        or(
          ne(busabaseAgentSessions.creationState, "unknown"),
          sql`${busabaseAgentSessions.capabilities}->'commandReceipts' = 'true'::jsonb`,
        ),
        or(
          gt(busabaseAgentSessions.demandUntil, sql`clock_timestamp()`),
          and(
            sql`${busabaseAgentSessions.activeCommandId} is not null`,
            or(
              isNull(busabaseAgentSessions.executionState),
              ne(busabaseAgentSessions.executionState, "unknown"),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(busabaseAgentSessions.lastActivityAt))
    .limit(Math.max(1, Math.min(500, Math.floor(limit))));
}
