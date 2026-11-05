import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { buildPromptContent } from "@acp-ui/core/prompt";
import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import {
  type ApiKeyPermissionLevel,
  BUSABASE_RELAY_PERMISSION_LEVEL_HEADER,
} from "busabase-contract/access-control/api-key-level";
import type { PromptResourceContextInput } from "busabase-contract/domains/agents/prompt-context";
import type {
  AgentContextReferenceInput,
  AgentContextResourceVO,
  AgentInputResponse,
  AgentPromptPresentation,
  AgentResourceVO,
  AgentSessionCommandKind,
  AgentSessionConfigSelectVO,
  AgentSessionEventVO,
  AgentSessionModelOptionVO,
  AgentSessionModeOptionVO,
  AgentSessionStatus,
  AgentSessionsPageVO,
  AgentSessionVO,
  ListAgentSessionsPagedInput,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import {
  AgentInputResponseSchema,
  AgentResourceVOSchema,
  AgentSessionCommandIdSchema,
  AgentSessionConfigSelectVOSchema,
  AgentSessionSnapshotVOSchema,
} from "busabase-contract/domains/agents/types";
import WebSocket from "ws";
import { z } from "zod";
import { getContextActorId, getContextSpaceId } from "../../../context";
import {
  budaMetadata,
  pendingInputOf,
  pendingPermissionOf,
  translateAcpExtension,
  upstreamSeqOf,
} from "../utils/acp-fidelity";
import {
  contextResourceToContentBlock,
  promptResourceContextToContentBlock,
} from "../utils/agent-context-resources";
import { assertAgentInputResponse } from "../utils/agent-input-validation";
import { inspectInputReceipt, inspectPermissionReceipt } from "../utils/agent-interaction-receipts";
import {
  decodeAgentSessionCursor,
  isAgentSessionAfterCursor,
  paginateAgentSessions,
} from "../utils/agent-session-pagination";
import { compareSessionsByRecency } from "../utils/session-recency";
import { collapseForPersistence } from "../utils/session-updates";
import {
  ACP_CONNECTION_ID_HEADER,
  createAcpConnectionId,
  describeAcpEndpoint,
  describeAcpError,
} from "./acp-connection-diagnostics";
import { type ResolvedLaunch, resolveLaunch } from "./agent-catalog";
import { resolveAgentContextResources } from "./agent-context-resources";
import { validateAgentPromptResourceContext } from "./agent-prompt-context";
import { agentSessionBindingFingerprint } from "./agent-session-binding";
import {
  type AgentSessionDiagnosticContext,
  agentSessionScopeReferences,
  captureAgentSessionDiagnosticContext,
  logAgentSessionDiagnostic,
  withAgentSessionDiagnosticContext,
} from "./agent-session-diagnostics";
import {
  journalSynchronizationErrorBrand,
  supervisedDispatch,
} from "./agent-session-execution-context";
import { agentSessionCommandDigest } from "./agent-session-journal-policy";
import {
  type AgentSessionJournalInput,
  type AgentSessionJournalRuntime,
  type AgentSessionWriterLease,
  admitSessionCommand,
  appendJournalEvents,
  createJournalSession,
  getJournalRuntime,
  loadSessionCommand,
  loadSessionCommands,
  renewWriterLease,
  touchJournalDemand,
  transitionSessionCommand,
  updateJournalRuntime,
} from "./agent-session-journal-store";
import {
  type AgentSessionLease,
  type AgentSessionRuntimeRecord,
  acquireSessionLease,
  endRemoteSession,
  type LeaseFence,
  loadSessionEvents,
  loadSessionPageCandidates,
  loadSessionRuntime,
  loadSessions,
  persistSessionAcpIdentity,
  persistSessionCreated,
  persistSessionEvents,
  persistSessionModelOption,
  persistSessionState,
  releaseSessionLease,
  renewSessionLease,
  sessionLeaseTtlSeconds,
} from "./agent-session-store";
import {
  AgentSessionCommandAdmissionError,
  agentSessionSupervisorRequested,
  assertAgentSessionSupervisorAvailable,
  registerAgentSessionSupervisorDriver,
  retainAgentSessionDemand,
  type SupervisedAgentCommand,
  wakeAgentSessionSupervisor,
} from "./agent-session-supervisor";
import { prepareAgentWorkspace } from "./agent-workspace";
import { resolveBusabaseMcpUrl } from "./agent-workspace-guide";

/**
 * Live ACP sessions.
 *
 * State is in-memory and `globalThis`-scoped, for the same reason the Cloud
 * edition's tunnel relay does it: Next's dev-mode lazy per-route compilation
 * can re-evaluate this module independently per importer, which would
 * otherwise mint a second, empty session map — the subscribe route would
 * then never see the session the create route made.
 *
 * This map holds only what is *running*. Sessions and their transcripts are
 * persisted alongside it (`agent-session-store.ts`), so a session survives a
 * restart as history — but never as a live agent, because the child process
 * does not. Persistence decides membership and terminal state; the live copy
 * only supplies fresher state for the same active, scoped row.
 */

const MAX_BUFFERED_EVENTS = 500;
const MAX_CACHED_MODEL_OPTIONS = 500;

/** Resolve only supported select categories, preserving the agent's ids and values. */
function findConfigSelect(
  configOptions: acp.SessionConfigOption[] | null | undefined,
  category: "model" | "thought_level" | "mode",
  conventionalIds: readonly string[],
): AgentSessionConfigSelectVO | null {
  const selects = configOptions?.filter((candidate) => candidate.type === "select") ?? [];
  const option =
    selects.find((candidate) => candidate.category === category) ??
    selects.find((candidate) => !candidate.category && conventionalIds.includes(candidate.id));
  if (!option || option.type !== "select") return null;
  const options = option.options
    .flatMap((entry) => ("options" in entry ? entry.options : [entry]))
    .map((entry) => {
      const metadata =
        category === "model"
          ? AgentSessionConfigSelectVOSchema.safeParse(entry._meta?.["busabase/thought_level"])
          : null;
      const thinking = metadata?.success ? metadata.data : null;
      return {
        value: entry.value,
        name: entry.name,
        ...(category === "mode" && entry.description ? { description: entry.description } : {}),
        ...(thinking?.id && thinking.options.some((level) => level.value === thinking.currentValue)
          ? { thinking }
          : {}),
      };
    });
  return {
    id: option.id,
    name: option.name,
    currentValue: option.currentValue,
    options,
    ...(category === "mode" && option.description ? { description: option.description } : {}),
  };
}

function legacyModeOption(
  modes: acp.SessionModeState | null | undefined,
): AgentSessionModeOptionVO | null {
  if (!modes?.availableModes.length) return null;
  return {
    id: "mode",
    name: "Mode",
    source: "legacy",
    currentValue: modes.currentModeId,
    options: modes.availableModes.map((mode) => ({
      value: mode.id,
      name: mode.name,
      ...(mode.description ? { description: mode.description } : {}),
    })),
  };
}

function syncConfigOptions(
  session: LiveSession,
  configOptions: acp.SessionConfigOption[] | null | undefined,
): Promise<void> {
  const mode = findConfigSelect(configOptions, "mode", [
    "mode",
    "permission_mode",
    "approval_mode",
  ]);
  return syncModelOption(
    session,
    findConfigSelect(configOptions, "model", ["model"]),
    findConfigSelect(configOptions, "thought_level", [
      "thought_level",
      "thinking_level",
      "reasoning_effort",
    ]),
    mode ? { ...mode, source: "config" } : session.legacyModeOption,
  );
}

interface LiveSession {
  id: string;
  /** Diagnostic identity is captured independently of request lifetimes. */
  diagnosticContext?: AgentSessionDiagnosticContext;
  operationDiagnosticContext?: AgentSessionDiagnosticContext;
  journal?: {
    lease: AgentSessionWriterLease;
    runtime: AgentSessionJournalRuntime;
    pending: Array<AgentSessionJournalInput & { admission: number; bytes: number }>;
    admission: number;
    committedAdmission: number;
    bytes: number;
    tail: Promise<void>;
    flushing?: Promise<void>;
    failure?: unknown;
    faultHandling?: Promise<void>;
    stats: {
      maxPending: number;
      batchCount: number;
      maxBatchSize: number;
      backpressureCount: number;
    };
    commandReceipts: boolean;
    completeCoverage: boolean;
    targetedCancel: boolean;
    bindingId: string;
    bindingInvalidated?: boolean;
    activeCommandId?: string;
  };
  /** Immutable request ownership captured when the process/socket is launched. */
  readonly spaceId: string;
  readonly actorId: string | null;
  slug: string;
  agentName: string;
  transport: ResolvedLaunch["transport"];
  status: AgentSessionStatus;
  error: string | null;
  createdAt: string;
  lastActivityAt: string;
  /** The agent's own ACP session id — not ours. */
  acpSessionId: string | null;
  child: ChildProcess | null;
  /** Resolves once initialize + session/new or session/load has completed. */
  ready: Promise<void>;
  /** Reserves the single prompt slot while `ready` is still pending. */
  promptStarting: boolean;
  prompt: (
    text: string,
    attachments?: PromptAttachmentInput[],
    cancellationSignal?: AbortSignal,
    contextResources?: readonly AgentContextResourceVO[],
    resourceContext?: readonly PromptResourceContextInput[],
  ) => Promise<void>;
  cancel: () => Promise<void>;
  /** Release transport ownership without ending the durable remote session. */
  detach: () => void;
  close: () => void;
  closed: boolean;
  /**
   * Confirmed ACP metadata, seeded during startup from this session's
   * durable snapshot on resume or the same Buda connection's cached snapshot
   * on creation. Readiness still gates configuration and prompt dispatch.
   */
  modelOption: AgentSessionModelOptionVO | null;
  thinkingOption: AgentSessionConfigSelectVO | null;
  modeOption: AgentSessionModeOptionVO | null;
  legacyModeOption: AgentSessionModeOptionVO | null;
  modeRevision: number;
  legacyCurrentModeId: string | null;
  modelCacheKey?: string;
  /** Serializes model snapshots with remote lease acquisition and release. */
  modelOptionSync: Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<AgentSessionModelOptionVO | null>;
  setMode: (value: string) => Promise<void>;
  seq: number;
  /** Highest `seq` already written to the database; everything above is pending. */
  persistedSeq: number;
  /** Serializes writes so terminal state never overtakes an earlier event batch. */
  flushPending: Promise<void>;
  buffer: AgentSessionEventVO[];
  listeners: Set<(event: AgentSessionEventVO) => void>;
  /**
   * Every outstanding `session/request_permission`, keyed by our requestId.
   * One turn can ask several at once — Claude Code requests permission for
   * parallel tool calls concurrently — so each entry is answered on its own,
   * in any order; a single slot let the second request orphan the first and
   * deadlock the turn. A human answer via `respondToAgentPermission` is the
   * only thing that selects an option; there is no timeout and no
   * auto-approve (spec decision). `cancelPendingPermissions` answers the rest
   * `cancelled` on session/cancel and teardown. `optionIds` is kept here, not
   * re-read from `buffer`, because a long stream can evict the request event
   * from that capped buffer while its card is still waiting.
   */
  pendingPermissions: Map<
    string,
    {
      optionIds: ReadonlySet<string>;
      resolve: (outcome: acp.RequestPermissionOutcome) => void;
      answering?: boolean;
    }
  >;
  permissionCounter: number;
  pendingInputs: Map<
    string,
    {
      schema: Record<string, unknown>;
      resolve: (response: acp.CreateElicitationResponse) => void;
      answering?: boolean;
    }
  >;
  resolvedInputs: Map<string, AgentInputResponse>;
  resolvedPermissions: Map<string, acp.RequestPermissionOutcome>;
  inputCounter: number;
  upstreamSeq?: number;
  budaEventStream: boolean;
  budaInteractionRespond: boolean;
  currentUserMessageId?: string;
  requestExtension?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  /**
   * The fencing lease held for the turn currently in flight on
   * `remote-websocket` sessions; retained through final persistence and
   * cleared by the operation guard, or always null on `local-subprocess`
   * (which has no cross-worker race to fence — a single child process is
   * never contended). Read by `setStatus`/`flushPendingEvents` so the fence
   * does not need threading through every call site.
   */
  lease: AgentSessionLease | null;
  /** Shared with retained ACP callbacks across independently loaded modules. */
  operationGuard?: OperationLeaseGuard | null;
}

interface OperationLeaseGuard {
  readonly lease: AgentSessionLease;
  readonly scope: { readonly spaceId: string; readonly actorId: string | null };
  assertOwned(): void;
  ready(renewBeforeDispatch?: boolean): Promise<void>;
  release(waitForWrites?: boolean): Promise<void>;
}

/** The durable command reservation is the operation slot in supervised mode.
 * Its guard verifies the long-lived writer epoch without borrowing a legacy
 * lease or releasing that writer when one turn completes. */
class JournalOperationGuard implements OperationLeaseGuard {
  readonly lease: AgentSessionLease;
  readonly scope: { readonly spaceId: string; readonly actorId: string | null };
  private stopped = false;
  constructor(
    private readonly session: LiveSession,
    private readonly commandId: string,
  ) {
    const journal = session.journal;
    if (!journal || session.operationGuard) throw new Error("This agent is still replying.");
    this.scope = Object.freeze({ spaceId: session.spaceId, actorId: session.actorId });
    this.lease = Object.freeze({
      sessionId: session.id,
      ownerId: journal.lease.ownerId,
      fencingToken: journal.lease.epoch,
      expiresAt: journal.lease.expiresAt,
    });
    session.lease = this.lease;
    session.operationGuard = this;
    session.operationDiagnosticContext = captureAgentSessionDiagnosticContext();
  }
  assertOwned(): void {
    if (
      this.stopped ||
      this.session.closed ||
      this.session.operationGuard !== this ||
      this.session.journal?.lease.ownerId !== this.lease.ownerId ||
      this.session.journal.lease.epoch !== this.lease.fencingToken
    )
      throw new Error("This worker lost the agent session writer lease.");
  }
  async ready(): Promise<void> {
    this.assertOwned();
    const journal = this.session.journal;
    if (!journal) throw new Error("The session writer is detached.");
    const renewed = await renewWriterLease(this.session.id, journal.lease, 45, this.scope);
    const runtime = renewed ? await getJournalRuntime(this.session.id, this.scope) : null;
    if (!runtime || runtime.activeCommandId !== this.commandId) {
      detachRemoteSession(this.session);
      throw new Error("This session command no longer owns its execution reservation.");
    }
    this.assertOwned();
  }
  async release(): Promise<void> {
    try {
      await this.session.flushPending;
    } finally {
      this.stopped = true;
      if (this.session.operationGuard === this) {
        this.session.lease = null;
        this.session.operationGuard = null;
        this.session.operationDiagnosticContext = undefined;
      }
    }
  }
}

function requireOperationGuard(session: LiveSession): OperationLeaseGuard | undefined {
  if (session.transport !== "remote-websocket") return undefined;
  const guard = session.operationGuard;
  if (
    !guard ||
    session.lease !== guard.lease ||
    session.id !== guard.lease.sessionId ||
    session.spaceId !== guard.scope.spaceId ||
    session.actorId !== guard.scope.actorId
  ) {
    throw new Error("This worker lost the agent session lease.");
  }
  guard.assertOwned();
  return guard;
}

async function verifyOperationDispatch(
  session: LiveSession,
  guard?: OperationLeaseGuard,
): Promise<void> {
  await guard?.ready(true);
  if (requireOperationGuard(session) !== guard) {
    throw new Error("This worker lost the agent session lease.");
  }
  if (session.journal) await supervisedDispatch.getStore()?.beforeDispatch();
}

/** One immutable authority owns renewal and cleanup for the entire operation. */
class LeaseGuard implements OperationLeaseGuard {
  readonly lease: AgentSessionLease;
  readonly scope: { readonly spaceId: string; readonly actorId: string | null };
  private session?: LiveSession;
  private lost = false;
  private stopped = false;
  private releasing = false;
  private renewing: Promise<void> | null = null;
  private cleanup: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(lease: AgentSessionLease, scope: { spaceId: string; actorId: string | null }) {
    this.lease = Object.freeze({ ...lease });
    this.scope = Object.freeze({ ...scope });
    this.timer = setInterval(
      () => this.renew(),
      Math.max(100, (sessionLeaseTtlSeconds() * 1_000) / 3),
    );
    this.timer.unref?.();
    this.renew();
  }

  private renew(): void {
    if (this.stopped || this.releasing || this.lost || this.renewing) return;
    this.renewing = renewSessionLease(
      this.lease.sessionId,
      this.lease.ownerId,
      this.lease.fencingToken,
      sessionLeaseTtlSeconds(),
      this.scope,
    )
      .then(
        (renewed) => {
          if (!renewed && !this.stopped) this.markLost();
        },
        () => {
          if (!this.stopped) this.markLost();
        },
      )
      .finally(() => {
        this.renewing = null;
      });
  }

  private markLost(): void {
    if (this.lost) return;
    this.lost = true;
    logAgentSessionDiagnostic(
      "lease_lost",
      {
        ...this.session?.diagnosticContext,
        ...this.session?.operationDiagnosticContext,
        sessionId: this.lease.sessionId,
        ownerId: this.lease.ownerId,
        fencingToken: this.lease.fencingToken,
        stage: "lease",
        outcome: "ownership_rejected",
      },
      { level: "warn", force: true },
    );
    clearInterval(this.timer);
    if (this.session?.lease === this.lease && this.session.operationGuard === this) {
      this.session.status = "failed";
      this.session.error = "This worker lost the agent session lease.";
      startingPromptControllers.get(this.session)?.abort(new Error(this.session.error));
      detachRemoteSession(this.session);
    }
  }

  assertOwned(): void {
    if (
      this.lost ||
      this.stopped ||
      (this.session && (this.session.lease !== this.lease || this.session.operationGuard !== this))
    ) {
      throw new Error("This worker lost the agent session lease.");
    }
  }

  attach(session: LiveSession): void {
    this.assertOwned();
    const active = session.operationGuard;
    if (active && active !== this) {
      throw new Error("This agent is still replying. Wait for the current turn to finish.");
    }
    if (
      session.id !== this.lease.sessionId ||
      session.spaceId !== this.scope.spaceId ||
      session.actorId !== this.scope.actorId
    ) {
      throw new Error(`Unknown agent session: ${this.lease.sessionId}`);
    }
    this.session = session;
    session.operationDiagnosticContext = captureAgentSessionDiagnosticContext();
    session.lease = this.lease;
    session.operationGuard = this;
  }

  async ready(renewBeforeDispatch = false): Promise<void> {
    this.assertOwned();
    if (renewBeforeDispatch) this.renew();
    await this.renewing;
    this.assertOwned();
  }

  release(waitForWrites = true): Promise<void> {
    if (this.cleanup) return this.cleanup;
    const cleanup = async () => {
      try {
        await this.session?.flushPending;
        this.releasing = true;
        await this.renewing;
        const released = await releaseSessionLease(
          this.lease.sessionId,
          this.lease.ownerId,
          this.lease.fencingToken,
          this.scope,
        );
        if (!released) {
          this.markLost();
          this.assertOwned();
        }
      } finally {
        this.stopped = true;
        clearInterval(this.timer);
        if (this.session?.operationGuard === this) {
          if (this.session.lease === this.lease) this.session.lease = null;
          this.session.operationGuard = null;
          this.session.operationDiagnosticContext = undefined;
        }
      }
    };
    if (waitForWrites && this.session) {
      const release = this.session.modelOptionSync.then(cleanup);
      this.session.modelOptionSync = release.catch(() => undefined);
      this.cleanup = release;
    } else {
      this.cleanup = cleanup();
    }
    return this.cleanup;
  }
}

/**
 * Update both live selectors AND queue their atomic durable mirror from
 * one call site, so every place `session.modelOption` changes — initial
 * discovery, an agent-pushed `config_option_update`, a
 * `session/set_config_option` response — preserves protocol order even when
 * database writes complete asynchronously.
 *
 * `local-subprocess` never persists: that process dies with the request that
 * spawned it, so no other worker will ever load this row while it could
 * still act on a stored value, and writing one would just be dead state.
 * Callers await this queue before publishing readiness, an update event, or a
 * successful mutation. Remote listings trust the durable row, so a rejected
 * write must fail the operation instead of reporting a model choice that the
 * next worker cannot see.
 */
function syncModelOption(
  session: LiveSession,
  modelOption: AgentSessionModelOptionVO | null,
  thinkingOption: AgentSessionConfigSelectVO | null,
  modeOption: AgentSessionModeOptionVO | null,
): Promise<void> {
  if (session.transport !== "remote-websocket") {
    session.modelOption = modelOption;
    session.thinkingOption = thinkingOption;
    session.modeOption = modeOption;
    return Promise.resolve();
  }
  const write = session.modelOptionSync.then(async () => {
    const scope = { spaceId: session.spaceId, actorId: session.actorId };
    const fence = session.lease
      ? { ownerId: session.lease.ownerId, fencingToken: session.lease.fencingToken }
      : undefined;
    const persisted = session.journal
      ? await updateJournalRuntime(
          session.id,
          {
            modelOption:
              thinkingOption || modeOption
                ? { modelOption, thinkingOption, modeOption }
                : modelOption,
          },
          session.journal.lease,
          scope,
        )
      : await persistSessionModelOption(
          session.id,
          modelOption,
          scope,
          fence,
          thinkingOption,
          modeOption,
        );
    if (!persisted) throw new Error("Could not persist the agent's model options. Try again.");
    // Publish only after the durable snapshot succeeds. Keeping persistence
    // and in-memory publication in the same queue entry prevents a lease
    // claim's durable refresh from clobbering a newer queued notification.
    session.modelOption = modelOption;
    session.thinkingOption = thinkingOption;
    session.modeOption = modeOption;
    rememberModelOption(session, modelOption);
  });
  // Keep later updates retryable even when this caller observes a rejection.
  session.modelOptionSync = write.catch(() => undefined);
  return write;
}

type TerminalAgentSessionStatus = Extract<AgentSessionStatus, "ended" | "failed">;

export class AgentSessionTerminalError extends Error {
  override readonly name = "AgentSessionTerminalError";

  constructor(
    readonly status: TerminalAgentSessionStatus,
    readonly promptRecorded: boolean,
    message: string,
  ) {
    super(message);
  }
}

const TERMINAL_STATUSES = new Set<AgentSessionStatus>(["ended", "failed"]);

/**
 * Covers the part of a turn before `session.prompt` owns its request-level
 * AbortController. The map is process-local for the same reason LiveSession
 * is: cancellation is routed to the worker that owns the live transport.
 */
const startingPromptControllers = new WeakMap<LiveSession, AbortController>();

const waitForReadyOrCancellation = (
  ready: Promise<void>,
  signal: AbortSignal,
  timeoutMs?: number,
): Promise<"ready" | "cancelled" | "timed_out"> =>
  new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      if (timeout) clearTimeout(timeout);
    };
    const onAbort = () => {
      cleanup();
      resolve("cancelled");
    };
    if (signal.aborted) {
      resolve("cancelled");
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        cleanup();
        resolve("timed_out");
      }, timeoutMs);
      timeout.unref?.();
    }
    ready.then(
      () => {
        cleanup();
        resolve("ready");
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });

type GlobalWithAgentSessions = typeof globalThis & {
  __busabaseAgentSessions?: Map<string, LiveSession>;
  __busabaseAgentSessionReattachments?: Map<string, Promise<LiveSession>>;
  __busabaseAgentModelOptions?: Map<string, AgentSessionModelOptionVO | null>;
};

function modelOptions(): Map<string, AgentSessionModelOptionVO | null> {
  const g = globalThis as GlobalWithAgentSessions;
  if (!g.__busabaseAgentModelOptions) g.__busabaseAgentModelOptions = new Map();
  return g.__busabaseAgentModelOptions;
}

function rememberModelOption(session: LiveSession, option: AgentSessionModelOptionVO | null) {
  if (!session.modelCacheKey) return;
  const cache = modelOptions();
  cache.delete(session.modelCacheKey);
  cache.set(session.modelCacheKey, option ? structuredClone(option) : null);
  if (cache.size > MAX_CACHED_MODEL_OPTIONS) cache.delete(cache.keys().next().value as string);
}

function sessions(): Map<string, LiveSession> {
  const g = globalThis as GlobalWithAgentSessions;
  if (!g.__busabaseAgentSessions) g.__busabaseAgentSessions = new Map();
  return g.__busabaseAgentSessions;
}

function reattachments(): Map<string, Promise<LiveSession>> {
  const g = globalThis as GlobalWithAgentSessions;
  if (!g.__busabaseAgentSessionReattachments) {
    g.__busabaseAgentSessionReattachments = new Map();
  }
  return g.__busabaseAgentSessionReattachments;
}

const nowIso = () => new Date().toISOString();
const REMOTE_SESSION_READY_POLL_MS = 100;
const REMOTE_EVENT_POLL_MS = 500;
const DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

const configuredTimeoutMs = (name: string, fallback: number): number => {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
};

const agentHandshakeTimeoutMs = (): number =>
  configuredTimeoutMs("BUSABASE_AGENT_HANDSHAKE_TIMEOUT_MS", DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS);

// An accepted prompt may wait for the same remote handshake. Its readiness
// deadline must not expire before that handshake does, unless explicitly overridden.
const remoteSessionReadyTimeoutMs = (): number =>
  configuredTimeoutMs("BUSABASE_AGENT_SESSION_READY_TIMEOUT_MS", agentHandshakeTimeoutMs());

const promptInactivityTimeoutMs = (): number =>
  configuredTimeoutMs(
    "BUSABASE_AGENT_PROMPT_IDLE_TIMEOUT_MS",
    DEFAULT_PROMPT_INACTIVITY_TIMEOUT_MS,
  );

class AgentPromptInactivityError extends Error {
  override readonly name = "AgentPromptInactivityError";
}

type AcpConnectionLogLevel = "info" | "warn";

const logAcpConnection = (
  level: AcpConnectionLogLevel,
  event: string,
  fields: Record<string, unknown>,
) => {
  logAgentSessionDiagnostic(
    event,
    { ...fields, stage: "connection" },
    {
      level,
      force: level === "warn" || event.endsWith("failed") || event === "connection_closing",
    },
  );
};

function sessionDiagnosticContext(session: LiveSession): AgentSessionDiagnosticContext {
  return captureAgentSessionDiagnosticContext({
    ...session.diagnosticContext,
    ...session.operationDiagnosticContext,
    acpSessionId: session.acpSessionId ?? undefined,
  });
}

function traceSessionOperation<T>(sessionId: string, stage: string, operation: () => T): T {
  const live = sessions().get(sessionId);
  const context = captureAgentSessionDiagnosticContext({
    ...(live && isLiveSessionVisibleToCurrentRequest(live) ? sessionDiagnosticContext(live) : {}),
    sessionId,
    operationId: `op_${randomUUID()}`,
    attemptId: `attempt_${randomUUID()}`,
    ...agentSessionScopeReferences({
      spaceId: getContextSpaceId(),
      actorId: getContextActorId() ?? null,
    }),
  });
  return withAgentSessionDiagnosticContext(context, () => {
    const startedAt = Date.now();
    const completed = () =>
      logAgentSessionDiagnostic(
        "operation_completed",
        { stage, outcome: "completed", elapsedMs: Date.now() - startedAt },
        { force: true },
      );
    const failed = (error: unknown) =>
      logAgentSessionDiagnostic(
        "operation_failed",
        { stage, outcome: "failed", elapsedMs: Date.now() - startedAt },
        { level: "warn", error, force: true },
      );
    logAgentSessionDiagnostic("operation_started", { stage, outcome: "started" });
    try {
      const result = operation();
      // Some permission validations deliberately throw synchronously. Preserve
      // that contract instead of turning every call into an async function.
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            completed();
            return value;
          },
          (error: unknown) => {
            failed(error);
            throw error;
          },
        ) as T;
      }
      completed();
      return result;
    } catch (error) {
      failed(error);
      throw error;
    }
  });
}

async function admitSupervisedCommand(
  sessionId: string,
  kind: AgentSessionCommandKind,
  payload: Record<string, unknown>,
  commandId = `cmd_${randomUUID().replaceAll("-", "")}`,
) {
  assertAgentSessionSupervisorAvailable();
  const scope = { spaceId: getContextSpaceId(), actorId: getContextActorId() ?? null };
  const runtime = await getJournalRuntime(sessionId, scope);
  if (!runtime || runtime.journalMode !== "supervised")
    throw new Error("Unknown supervised agent session.");
  const prior = await loadSessionCommand(sessionId, commandId, scope);
  if (prior) {
    if (
      prior.kind !== kind ||
      agentSessionCommandDigest(prior.payload) !== agentSessionCommandDigest(payload)
    )
      throw new Error("This command identity was already used with different content.");
    void wakeAgentSessionSupervisor();
    return prior;
  }
  const admission = await admitSessionCommand(
    sessionId,
    {
      commandId,
      kind,
      payload,
      ...(kind === "prompt"
        ? {
            presentation: {
              text: payload.text,
              ...(payload.presentation ? { presentation: payload.presentation } : {}),
            },
          }
        : {}),
      ...(kind === "cancel" && runtime.activeCommandId
        ? { targetCommandId: runtime.activeCommandId }
        : {}),
      expiresAt: new Date(Date.now() + (kind === "prompt" ? 30 * 60_000 : 30_000)).toISOString(),
    },
    scope,
  );
  if (admission.outcome === "conflict") {
    const raced = await loadSessionCommand(sessionId, commandId, scope);
    if (
      raced?.kind === kind &&
      agentSessionCommandDigest(raced.payload) === agentSessionCommandDigest(payload)
    )
      return raced;
  }
  if (admission.outcome !== "accepted" && admission.outcome !== "already_accepted") {
    throw new Error(
      admission.outcome === "busy"
        ? "This agent is still replying. Wait for the current turn to finish."
        : admission.outcome === "conflict"
          ? "This command identity was already used with different content."
          : "This session is not accepting commands. Reconcile its current state first.",
    );
  }
  await touchJournalDemand(sessionId, scope);
  void wakeAgentSessionSupervisor();
  return admission.receipt;
}

/** Narrow control connection: no load, journal observer, writer claim or prompt. */
async function sendTargetedSupervisedCancellation(
  runtime: AgentSessionJournalRuntime,
  command: SupervisedAgentCommand,
): Promise<boolean> {
  if (
    !runtime.acpSessionId ||
    !command.targetCommandId ||
    runtime.capabilities?.commandReceipts !== true ||
    runtime.capabilities.targetedCancel !== true
  )
    return false;
  const launch = await resolveLaunch(runtime.session.slug);
  if (launch.transport !== "remote-websocket" || !launch.url) return false;
  const stream = createWebSocketStream(launch.url, {
    headers: {
      [ACP_CONNECTION_ID_HEADER]: createAcpConnectionId(),
      ...(launch.authHeader ? { Authorization: launch.authHeader } : {}),
    },
    WebSocket: WebSocket as unknown as never,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bindingId = `${runtime.session.id}_${runtime.bindingGeneration}`;
  try {
    return await Promise.race([
      acp.client({ name: "busabase-targeted-cancel" }).connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            _meta: {
              "buda.im": {
                commandReceipts: 1,
                writerEpoch: 1,
                targetedCancel: 1,
                journalCoverage: 1,
              },
            },
          },
        });
        const capabilities = budaMetadata(initialized.agentCapabilities);
        if (capabilities?.targetedCancel !== 1 || capabilities.commandReceipts !== 1) return false;
        const found = (await ctx.request("_buda.im/command/receipt", {
          bindingId,
          commandId: command.targetCommandId,
        })) as { receipt?: { turnId?: string } | null };
        if (!found.receipt?.turnId) return false;
        const result = (await ctx.request("_buda.im/session/cancel_turn", {
          bindingId,
          writerEpoch: runtime.writerEpoch,
          commandId: command.commandId,
          targetCommandId: command.targetCommandId,
          sessionId: runtime.acpSessionId,
          turnId: found.receipt.turnId,
        })) as { outcome?: string };
        return result.outcome === "requested" || result.outcome === "stale";
      }),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 3_000);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    logAgentSessionDiagnostic(
      "targeted_cancel_waiting_for_owner",
      {
        sessionId: runtime.session.id,
        stage: "cancel",
        outcome: "recovering",
      },
      { level: "warn", error },
    );
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    await stream.writable.close().catch(() => undefined);
  }
}

async function routeSupervisedControl(
  sessionId: string,
  kind: AgentSessionCommandKind,
  payload: Record<string, unknown>,
  commandId?: string,
): Promise<boolean> {
  if (!agentSessionSupervisorRequested()) return false;
  const scope = { spaceId: getContextSpaceId(), actorId: getContextActorId() ?? null };
  const runtime = await getJournalRuntime(sessionId, scope);
  if (runtime?.journalMode !== "supervised") return false;
  const receipt = await admitSupervisedCommand(sessionId, kind, payload, commandId);
  if (kind === "cancel" && (await sendTargetedSupervisedCancellation(runtime, receipt)))
    return true;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await loadSessionCommand(sessionId, receipt.commandId, scope);
    if (current?.state === "completed") return true;
    if (current?.state === "rejected" || current?.state === "unknown")
      throw new Error(
        "The agent could not confirm this command. Reconcile the session before retrying.",
      );
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    "The command is saved and is waiting for session recovery. Check its status before retrying.",
  );
}

function journalDrainStats(journal: NonNullable<LiveSession["journal"]>) {
  journal.stats ??= {
    maxPending: 0,
    batchCount: 0,
    maxBatchSize: 0,
    backpressureCount: 0,
  };
  return journal.stats;
}

function enqueueJournalEvent(
  session: LiveSession,
  event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">,
): string {
  const journal = session.journal;
  if (!journal || session.closed) throw new Error("The session writer is detached.");
  if (journal.failure) throw journal.failure;
  const sourceSeq = session.budaEventStream
    ? upstreamSeqOf(event as AgentSessionEventVO)
    : undefined;
  const command = supervisedDispatch.getStore()?.command;
  const isUser =
    (event.acpUpdate as { sessionUpdate?: unknown } | undefined)?.sessionUpdate === "user_message";
  const identity =
    sourceSeq !== undefined
      ? `${journal.bindingId}:remote:${sourceSeq}`
      : isUser && command
        ? `command:${command.commandId}:user`
        : `event:${randomUUID()}`;
  const full = {
    ...event,
    at: nowIso(),
    ...(isUser && command
      ? {
          commandId: command.commandId,
          acpUpdate: {
            ...(event.acpUpdate as Record<string, unknown>),
            commandId: command.commandId,
          },
        }
      : {}),
  };
  const serialized = JSON.stringify(full);
  const bytes = Buffer.byteLength(serialized);
  if (journal.pending.length >= 500 || journal.bytes + bytes > 16 * 1024 * 1024) {
    journal.failure = new JournalSynchronizationError(
      "integrity_failure",
      `diag_${randomUUID().replaceAll("-", "")}`,
    );
    throw journal.failure;
  }
  journal.admission += 1;
  journal.bytes += bytes;
  // Freeze the admitted JSON semantics so every retry writes the same batch.
  const snapshot = JSON.parse(serialized) as typeof full;
  journal.pending.push({
    identity,
    event: snapshot,
    sourceSeq,
    admission: journal.admission,
    bytes,
  });
  const stats = journalDrainStats(journal);
  stats.maxPending = Math.max(stats.maxPending, journal.pending.length);
  session.lastActivityAt = full.at;
  return identity;
}

const bindingChangedBrand = Symbol.for("busabase.agent-session.binding-changed");
const journalSynchronizationBrand = journalSynchronizationErrorBrand;

class SessionBindingChangedError extends AgentSessionCommandAdmissionError {
  readonly [bindingChangedBrand] = true;
  constructor() {
    super("CONNECTION_BINDING_CHANGED");
    this.message =
      "This conversation belongs to an earlier connection. Its saved commands were not sent to the replacement connection.";
  }
}

function isSessionBindingChangedError(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, bindingChangedBrand) === true
    );
  } catch {
    return false;
  }
}

async function invalidateSessionBinding(
  sessionId: string,
  lease: AgentSessionWriterLease,
  scope: { spaceId: string; actorId: string | null },
  live?: LiveSession,
): Promise<never> {
  const diagnosticRef = `diag_${randomUUID().replaceAll("-", "")}`;
  let uncertain = false;
  try {
    if (live?.journal) live.journal.bindingInvalidated = true;
    // Freeze new data admission before releasing an existing reservation.
    await updateJournalRuntime(
      sessionId,
      { connectionState: "disconnected", syncState: "gap", diagnosticRef },
      lease,
      scope,
    );
    if (
      live?.journal?.lease.ownerId === lease.ownerId &&
      live.journal.lease.epoch === lease.epoch &&
      !live.closed
    )
      detachRemoteSession(live);
    for (const command of await loadSessionCommands(sessionId, scope)) {
      if (["queued", "claimed"].includes(command.state))
        await transitionSessionCommand(
          sessionId,
          command.commandId,
          ["queued", "claimed"],
          "rejected",
          lease,
          scope,
          { errorCode: "CONNECTION_BINDING_CHANGED" },
        );
      else if (["dispatching", "observed", "unknown"].includes(command.state)) {
        uncertain = true;
        await transitionSessionCommand(
          sessionId,
          command.commandId,
          ["dispatching", "observed"],
          "unknown",
          lease,
          scope,
          { errorCode: "CONNECTION_BINDING_CHANGED" },
        );
      }
    }
    const remaining = await loadSessionCommands(sessionId, scope);
    uncertain = remaining.some((command) =>
      ["dispatching", "observed", "unknown"].includes(command.state),
    );
    for (const command of remaining) {
      if (["dispatching", "observed"].includes(command.state))
        await transitionSessionCommand(
          sessionId,
          command.commandId,
          ["dispatching", "observed"],
          "unknown",
          lease,
          scope,
          { errorCode: "CONNECTION_BINDING_CHANGED" },
        );
    }
    await updateJournalRuntime(
      sessionId,
      {
        ...(uncertain ? {} : { status: "idle" }),
        error: null,
        connectionState: "disconnected",
        syncState: "gap",
        executionState: uncertain ? "unknown" : "idle",
        diagnosticRef,
      },
      lease,
      scope,
    );
  } catch (error) {
    logAgentSessionDiagnostic(
      "session_binding_state_unavailable",
      {
        sessionId,
        diagnosticRef,
        stage: "binding",
        outcome: "binding_changed",
        ownerId: lease.ownerId,
        fencingToken: lease.epoch,
      },
      { level: "warn", error, force: true },
    );
  } finally {
    logAgentSessionDiagnostic(
      "session_binding_rejected",
      {
        ...(live ? sessionDiagnosticContext(live) : {}),
        sessionId,
        diagnosticRef,
        stage: "binding",
        outcome: "binding_changed",
        reason: "CONNECTION_BINDING_CHANGED",
        ownerId: lease.ownerId,
        fencingToken: lease.epoch,
      },
      { level: "warn", force: true },
    );
    // Never detach a newer session object or mutate a newer writer's state.
    if (
      live?.journal?.lease.ownerId === lease.ownerId &&
      live.journal.lease.epoch === lease.epoch &&
      !live.closed
    )
      detachRemoteSession(live);
  }
  throw new SessionBindingChangedError();
}

/** Re-resolve current authorization/config immediately before every remote operation. */
async function assertCurrentSessionBinding(session: LiveSession): Promise<void> {
  const journal = session.journal;
  if (!journal) return;
  if (journal.bindingInvalidated) throw new SessionBindingChangedError();
  if (session.closed) throw new Error("The session writer is detached.");
  const scope = { spaceId: session.spaceId, actorId: session.actorId };
  const launch = await resolveLaunch(session.slug);
  const runtime = await getJournalRuntime(session.id, scope);
  if (
    !runtime ||
    runtime.writerOwnerId !== journal.lease.ownerId ||
    runtime.writerEpoch !== journal.lease.epoch
  )
    throw new Error("The session writer changed before dispatch.");
  const pinned = runtime.capabilities?.bindingFingerprint;
  if (typeof pinned !== "string" || pinned !== agentSessionBindingFingerprint(launch))
    await invalidateSessionBinding(session.id, journal.lease, scope, session);
}

/** Read/control side sockets cannot forward an old remote ID into a new binding. */
async function assertScopedExtensionBinding(
  record: AgentSessionRuntimeRecord,
  launch: ResolvedLaunch,
): Promise<void> {
  if (!record.session.reliability) return;
  const scope = { spaceId: getContextSpaceId(), actorId: getContextActorId() ?? null };
  const runtime = await getJournalRuntime(record.session.id, scope);
  const pinned = runtime?.capabilities?.bindingFingerprint;
  if (
    runtime?.journalMode === "supervised" &&
    typeof pinned === "string" &&
    pinned === agentSessionBindingFingerprint(launch)
  )
    return;
  const live = sessions().get(record.session.id);
  if (live?.journal && isLiveSessionVisibleToCurrentRequest(live))
    await invalidateSessionBinding(record.session.id, live.journal.lease, scope, live);
  logAgentSessionDiagnostic(
    "scoped_extension_binding_rejected",
    {
      sessionId: record.session.id,
      stage: "binding",
      outcome: "binding_changed",
      reason: "CONNECTION_BINDING_CHANGED",
    },
    { level: "warn", force: true },
  );
  throw new SessionBindingChangedError();
}

class JournalSynchronizationError extends Error {
  readonly [journalSynchronizationBrand] = true;
  constructor(
    readonly outcome: string,
    readonly diagnosticRef: string,
  ) {
    super(`History synchronization stopped: ${outcome}.`);
  }
}

function isJournalSynchronizationError(error: unknown): error is JournalSynchronizationError {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, journalSynchronizationBrand) === true &&
      typeof Reflect.get(error, "outcome") === "string" &&
      typeof Reflect.get(error, "diagnosticRef") === "string"
    );
  } catch {
    return false;
  }
}

function handleJournalFault(session: LiveSession, error: unknown): Promise<void> {
  const journal = session.journal;
  if (!journal) return Promise.resolve();
  if (journal.faultHandling) return journal.faultHandling;
  journal.failure ??= error ?? new Error("History synchronization failed.");
  // Many callers can await one drain. One failure owns cleanup and its DB writes.
  journal.faultHandling = Promise.resolve()
    .then(() => performHandleJournalFault(session, journal.failure))
    .catch(() => {
      detachRemoteSession(session);
    });
  return journal.faultHandling;
}

async function performHandleJournalFault(session: LiveSession, error: unknown): Promise<void> {
  if (!session.journal) return;
  const knownCursorGap =
    error instanceof Error &&
    /ACP replay cursor is newer|replay cursor.*expired|journal generation|history.*retention/i.test(
      error.message,
    );
  const definiteGap =
    knownCursorGap ||
    (isJournalSynchronizationError(error) && error.outcome === "integrity_failure");
  const scope = { spaceId: session.spaceId, actorId: session.actorId };
  const current = await getJournalRuntime(session.id, scope).catch(() => null);
  const gap =
    definiteGap ||
    session.journal.bindingInvalidated === true ||
    current?.creationState === "unknown" ||
    current?.session.reliability?.synchronization === "gap";
  const diagnosticRef = isJournalSynchronizationError(error)
    ? error.diagnosticRef
    : `diag_${randomUUID().replaceAll("-", "")}`;
  logAgentSessionDiagnostic(
    "journal_connection_degraded",
    {
      ...sessionDiagnosticContext(session),
      diagnosticRef,
      stage: "journal",
      outcome: gap ? "gap" : "recovering",
    },
    { level: "warn", error, force: true },
  );
  await updateJournalRuntime(
    session.id,
    {
      connectionState: "disconnected",
      syncState: gap ? "gap" : "degraded",
      diagnosticRef,
      ...(definiteGap ? { executionState: "unknown" } : {}),
    },
    session.journal.lease,
    scope,
  ).catch(() => false);
  detachRemoteSession(session);
}

async function flushJournalEvents(session: LiveSession): Promise<void> {
  const journal = session.journal;
  if (!journal) return;
  const through = journal.admission;
  journalDrainStats(journal);
  if (journal.failure) throw journal.failure;
  // A retained HMR object may predate the explicit admission acknowledgement.
  journal.committedAdmission ??= journal.pending[0]
    ? journal.pending[0].admission - 1
    : journal.admission;
  while (journal.committedAdmission < through) {
    if (journal.failure) throw journal.failure;
    if (!journal.flushing) {
      const drain = Promise.resolve()
        .then(async () => {
          while (journal.pending.length) {
            if (journal.failure) throw journal.failure;
            if (session.closed) throw new Error("The journal writer is detached.");
            // One producer may admit newer work during I/O. FIFO permits one
            // shared drain to include it without weakening any caller's barrier.
            const batch = journal.pending.slice(0, 256);
            const scope = { spaceId: session.spaceId, actorId: session.actorId };
            const sourceSeqs = batch.flatMap((input) =>
              input.sourceSeq === undefined ? [] : [input.sourceSeq],
            );
            const checkpoint =
              journal.completeCoverage && sourceSeqs.length
                ? { sourceSeq: Math.max(...sourceSeqs) }
                : undefined;
            journal.stats.batchCount += 1;
            journal.stats.maxBatchSize = Math.max(journal.stats.maxBatchSize, batch.length);
            let result = await appendJournalEvents(
              session.id,
              batch,
              journal.lease,
              scope,
              checkpoint,
            );
            for (
              let attempt = 0;
              result.outcome === "transient_failure" && attempt < 3;
              attempt += 1
            ) {
              await new Promise<void>((resolve) =>
                setTimeout(
                  resolve,
                  ([100, 300, 900][attempt] ?? 900) + Math.floor(Math.random() * 50),
                ),
              );
              if (journal.failure) throw journal.failure;
              if (session.closed) throw new Error("The journal writer is detached.");
              journal.stats.batchCount += 1;
              result = await appendJournalEvents(
                session.id,
                batch,
                journal.lease,
                scope,
                checkpoint,
              );
            }
            if ("diagnosticRef" in result)
              throw new JournalSynchronizationError(result.outcome, result.diagnosticRef);
            journal.pending.splice(0, batch.length);
            journal.bytes = journal.pending.reduce((sum, input) => sum + input.bytes, 0);
            journal.committedAdmission = batch.at(-1)?.admission ?? journal.committedAdmission;
            const existing = new Set(session.buffer.map((event) => event.seq));
            for (const event of result.events) {
              session.seq = Math.max(session.seq, event.seq);
              session.persistedSeq = Math.max(session.persistedSeq, event.seq);
              if (!existing.has(event.seq)) {
                existing.add(event.seq);
                session.buffer.push(event);
                publishEvent(session, event);
              }
            }
            session.buffer.sort((a, b) => a.seq - b.seq);
            while (session.buffer.length > MAX_BUFFERED_EVENTS) session.buffer.shift();
          }
        })
        .catch((error: unknown) => {
          journal.failure ??= error ?? new Error("History synchronization failed.");
          throw journal.failure;
        })
        .finally(() => {
          journal.flushing = undefined;
        });
      journal.flushing = drain;
      journal.tail = drain.catch(() => undefined);
      session.flushPending = journal.tail;
    }
    await journal.flushing;
  }
}

async function applyJournalBackpressure(session: LiveSession): Promise<void> {
  const journal = session.journal;
  if (!journal || session.closed) return;
  if (journal.failure) throw journal.failure;
  if (journal.pending.length >= 128 || journal.bytes >= 8 * 1024 * 1024) {
    journalDrainStats(journal).backpressureCount += 1;
    await flushJournalEvents(session);
  }
}

function emit(session: LiveSession, event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">) {
  if (session.journal) {
    enqueueJournalEvent(session, event);
    void flushPendingEvents(session).catch((error: unknown) => handleJournalFault(session, error));
    return;
  }
  session.seq += 1;
  session.lastActivityAt = nowIso();
  const full: AgentSessionEventVO = {
    sessionId: session.id,
    seq: session.seq,
    at: session.lastActivityAt,
    ...event,
  };
  session.buffer.push(full);
  logAgentSessionDiagnostic("event_admitted", {
    ...sessionDiagnosticContext(session),
    stage: "notification",
    outcome: "buffered",
    seqThrough: full.seq,
    persistedSeq: session.persistedSeq,
    queueDepth: session.buffer.length,
    ownerId: session.lease?.ownerId,
    fencingToken: session.lease?.fencingToken,
  });
  while (
    session.buffer.length > MAX_BUFFERED_EVENTS &&
    (session.buffer[0]?.seq ?? Infinity) <= session.persistedSeq
  )
    session.buffer.shift();
  if (session.transport === "local-subprocess") publishEvent(session, full);
  if (session.transport === "remote-websocket") {
    void flushPendingEvents(session).catch((error: unknown) => {
      logAgentSessionDiagnostic(
        "flush_detached",
        { ...sessionDiagnosticContext(session), stage: "flush", outcome: "failed" },
        { level: "warn", error, force: true },
      );
      session.status = "failed";
      session.error = error instanceof Error ? error.message : "Could not persist remote events.";
      detachRemoteSession(session);
    });
  }
}

function publishEvent(session: LiveSession, event: AgentSessionEventVO): void {
  for (const listener of session.listeners) {
    try {
      listener(event);
    } catch {
      /* A detached observer cannot fail a run. */
    }
  }
}

async function setStatus(
  session: LiveSession,
  status: AgentSessionStatus,
  message?: string,
): Promise<void> {
  const previousStatus = session.status;
  // A status transition owns exactly the authority it started with. Startup's
  // connecting -> idle write can overlap the first prompt's lease claim while
  // awaiting its event flush; reading these fields after that await would let
  // the stale startup transition borrow the newer turn's fence and clear it.
  const transitionLease = session.lease;
  const transitionPromptStarting = session.promptStarting;
  session.status = status;
  if (status === "failed") session.error = message ?? session.error;
  emit(session, { kind: "status", status, message });
  // A turn ending is the coalescing boundary: chunks that streamed at token
  // granularity are now a settled message, so this is the moment to write them
  // (schema note on `agent_session_events`). Persisting per `emit()` instead
  // would be one INSERT per token.
  if (status !== "busy") await flushPendingEvents(session);
  const expectedStatus =
    transitionPromptStarting && status !== "busy"
      ? "busy"
      : status === "busy" && (previousStatus === "connecting" || previousStatus === "idle")
        ? "busy"
        : previousStatus;
  const persistTransition = async () => {
    const persisted = session.journal
      ? await updateJournalRuntime(
          session.id,
          {
            status,
            error: session.error,
            executionState:
              status === "busy"
                ? "running"
                : status === "waiting_permission"
                  ? "waiting"
                  : status === "idle"
                    ? "idle"
                    : status === "connecting"
                      ? "reserved"
                      : "terminal",
          },
          session.journal.lease,
          { spaceId: session.spaceId, actorId: session.actorId },
        )
      : await persistSessionState(
          toVO(session),
          session.acpSessionId,
          { expectedStatuses: [expectedStatus] },
          { spaceId: session.spaceId, actorId: session.actorId },
          transitionLease ?? undefined,
        );
    if (transitionLease && !persisted) {
      throw new Error("This worker lost the agent session lease.");
    }
  };
  if (transitionLease && status !== "busy") {
    // Keep state commits behind earlier model snapshots while the operation's
    // guard retains the fence through final persistence and explicit release.
    const transition = session.modelOptionSync.then(persistTransition);
    session.modelOptionSync = transition.catch(() => undefined);
    await transition;
  } else {
    await persistTransition();
  }
}

/**
 * Write everything buffered since the last flush, once, as a single insert.
 *
 * Local chunks collapse at the turn boundary. Remote chunks keep their raw
 * sequence so a non-owner worker can poll an in-progress turn without losing
 * or duplicating the remainder of a partially streamed message.
 */
async function flushPendingEvents(session: LiveSession): Promise<void> {
  if (session.journal) return flushJournalEvents(session);
  const fence = session.lease ?? undefined;
  // A queued flush must not consume events admitted after it. A later
  // persist-before-publish write may have reserved an intervening sequence.
  const throughSeq = session.seq;
  const diagnosticContext = sessionDiagnosticContext(session);
  const queuedAt = Date.now();
  const flush = session.flushPending.then(async () => {
    const pending = session.buffer.filter(
      (event) => event.seq > session.persistedSeq && event.seq <= throughSeq,
    );
    if (pending.length === 0) return;
    const nextPersistedSeq = pending[pending.length - 1]?.seq ?? session.persistedSeq;
    const durableEvents =
      session.transport === "remote-websocket" ? pending : collapseForPersistence(pending);
    logAgentSessionDiagnostic("batch_enqueued", {
      ...diagnosticContext,
      stage: "flush",
      outcome: "started",
      seqFrom: pending[0]?.seq,
      seqThrough: nextPersistedSeq,
      eventCount: durableEvents.length,
      queueDepth: session.buffer.length,
      persistedSeq: session.persistedSeq,
      ownerId: fence?.ownerId,
      fencingToken: fence?.fencingToken,
    });
    const persisted = await withAgentSessionDiagnosticContext(diagnosticContext, () =>
      persistSessionEvents(durableEvents, fence, {
        spaceId: session.spaceId,
        actorId: session.actorId,
      }),
    );
    logAgentSessionDiagnostic(
      "flush_completed",
      {
        ...diagnosticContext,
        stage: "flush",
        outcome: persisted ? "committed" : "rejected",
        seqFrom: pending[0]?.seq,
        seqThrough: nextPersistedSeq,
        eventCount: durableEvents.length,
        elapsedMs: Date.now() - queuedAt,
      },
      { level: persisted ? "info" : "warn", force: !persisted },
    );
    if (!persisted && session.transport === "remote-websocket") {
      throw new Error("Could not persist the remote agent transcript.");
    }
    if (!persisted) return;
    session.persistedSeq = nextPersistedSeq;
    if (session.transport === "remote-websocket")
      for (const event of pending) publishEvent(session, event);
    while (
      session.buffer.length > MAX_BUFFERED_EVENTS &&
      (session.buffer[0]?.seq ?? Infinity) <= session.persistedSeq
    )
      session.buffer.shift();
  });
  session.flushPending = flush.catch(() => undefined);
  await flush;
}

/**
 * Local agents are spawned through a login shell on POSIX so they inherit the
 * user's real PATH. Without it `npx` is frequently missing from the environment
 * a server process was started with — the same reason
 * `formulahendry/vscode-acp`'s AgentManager does this.
 */
function spawnAgentProcess(launch: ResolvedLaunch, cwd: string): ChildProcess {
  const command = launch.command as string;
  const args = launch.args ?? [];
  if (launch.direct) {
    return spawn(command, args, {
      cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  if (process.platform === "win32") {
    return spawn(command, args, {
      cwd,
      env: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });
  }
  const shell = process.env.SHELL || "/bin/sh";
  const line = [command, ...args].map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ");
  const path = launch.env?.BUSABASE_DESKTOP_CODEX_SYSTEM_PATH;
  const effectiveLine = path ? `export PATH='${path.replaceAll("'", `'\\''`)}'; ${line}` : line;
  return spawn(shell, ["-l", "-c", effectiveLine], {
    cwd,
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export interface CreateSessionArgs {
  slug: string;
  spaceId: string;
  commandId?: string;
}

interface OpenAgentSessionArgs extends CreateSessionArgs {
  resume?: AgentSessionRuntimeRecord;
  lease?: AgentSessionLease;
  guard?: LeaseGuard;
  persistedId?: string;
  journalLease?: AgentSessionWriterLease;
  journalRuntime?: AgentSessionJournalRuntime;
}

async function openAgentSession({
  slug,
  spaceId,
  resume,
  lease,
  guard,
  persistedId,
  journalLease,
  journalRuntime,
}: OpenAgentSessionArgs): Promise<LiveSession> {
  const actorId = guard ? guard.scope.actorId : (getContextActorId() ?? null);
  const launch = await resolveLaunch(slug);
  guard?.assertOwned();
  // Credentials are hashed, never retained in the cache. A token rotation
  // deliberately misses rather than borrowing another connection's metadata.
  const modelCacheKey =
    launch.transport === "remote-websocket" &&
    (launch.slug === "buda" || launch.slug.startsWith("buda:"))
      ? createHash("sha256")
          .update(JSON.stringify([spaceId, actorId, launch.slug, launch.url, launch.authHeader]))
          .digest("hex")
      : undefined;
  const id =
    persistedId ??
    resume?.session.id ??
    `ags_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  if (journalLease && journalRuntime) {
    const fingerprint = agentSessionBindingFingerprint(launch);
    const pinned = journalRuntime.capabilities?.bindingFingerprint;
    if (pinned && pinned !== fingerprint)
      await invalidateSessionBinding(id, journalLease, { spaceId, actorId });
    if (!pinned) {
      const saved = await updateJournalRuntime(
        id,
        { capabilities: { ...journalRuntime.capabilities, bindingFingerprint: fingerprint } },
        journalLease,
        { spaceId, actorId },
      );
      if (!saved) throw new Error("The session writer changed before binding its connection.");
      journalRuntime = {
        ...journalRuntime,
        capabilities: { ...journalRuntime.capabilities, bindingFingerprint: fingerprint },
      };
    }
  }
  const connectionId = createAcpConnectionId();
  const endpointDiagnostics =
    launch.transport === "remote-websocket" ? describeAcpEndpoint(launch.url) : {};

  logAcpConnection("info", "launch_resolved", {
    connectionId,
    sessionId: id,
    slug: launch.slug,
    transport: launch.transport,
    ...endpointDiagnostics,
  });

  const diagnosticContext = captureAgentSessionDiagnosticContext({
    connectionId,
    sessionId: id,
    acpSessionId: resume?.acpSessionId ?? undefined,
    ...agentSessionScopeReferences({ spaceId, actorId }),
  });
  const session: LiveSession = {
    id,
    diagnosticContext,
    ...(journalLease && journalRuntime
      ? {
          journal: {
            lease: journalLease,
            runtime: journalRuntime,
            pending: [],
            admission: 0,
            committedAdmission: 0,
            bytes: 0,
            tail: Promise.resolve(),
            stats: { maxPending: 0, batchCount: 0, maxBatchSize: 0, backpressureCount: 0 },
            commandReceipts: false,
            completeCoverage: false,
            targetedCancel: false,
            bindingId: `${id}_${journalLease.bindingGeneration}`,
          },
        }
      : {}),
    spaceId,
    actorId,
    slug: launch.slug,
    agentName: launch.name,
    transport: launch.transport,
    status: resume?.session.status ?? "connecting",
    error: resume?.session.error ?? null,
    createdAt: resume?.session.createdAt ?? nowIso(),
    lastActivityAt: resume?.session.lastActivityAt ?? nowIso(),
    acpSessionId: resume?.acpSessionId ?? null,
    child: null,
    ready: Promise.resolve(),
    promptStarting: false,
    prompt: async () => {},
    cancel: async () => {},
    detach: () => {},
    close: () => {},
    closed: false,
    modelOption: structuredClone(
      resume
        ? resume.session.modelOption
        : (modelCacheKey && modelOptions().get(modelCacheKey)) || null,
    ),
    modelCacheKey,
    // Thinking options depend on this session's confirmed model, never the agent cache.
    thinkingOption: resume?.session.thinkingOption ?? null,
    modeOption: resume?.session.modeOption ?? null,
    legacyModeOption:
      resume?.session.modeOption?.source === "legacy" ? resume.session.modeOption : null,
    modeRevision: 0,
    legacyCurrentModeId: null,
    modelOptionSync: Promise.resolve(),
    setConfigOption: async () => null,
    setMode: async () => {},
    seq: resume?.lastEventSeq ?? 0,
    persistedSeq: resume?.lastEventSeq ?? 0,
    flushPending: Promise.resolve(),
    buffer: [],
    listeners: new Set(),
    pendingPermissions: new Map(),
    // Every prior request consumed journal events. Resume above that durable
    // sequence so a new card cannot reuse an already-resolved fallback id.
    permissionCounter: resume?.lastEventSeq ?? 0,
    pendingInputs: new Map(),
    resolvedInputs: new Map(),
    resolvedPermissions: new Map(),
    inputCounter: 0,
    upstreamSeq: journalRuntime ? (journalRuntime.sourceCheckpoint ?? 0) : resume?.upstreamSeq,
    budaEventStream: false,
    budaInteractionRespond: false,
    lease: lease ?? null,
  };
  guard?.attach(session);
  // Identity must be durable before a process or socket exists. Otherwise a
  // failed INSERT creates a live session that no disconnect/delete request in
  // any process can discover or tombstone. Skipped on resume: the row already
  // exists — this is reattachment, not creation, and re-inserting would
  // collide with the durable primary key.
  if (!resume && !persistedId)
    await withAgentSessionDiagnosticContext(diagnosticContext, () =>
      persistSessionCreated(toVO(session), { spaceId, actorId }),
    );
  sessions().set(id, session);

  session.ready = withAgentSessionDiagnosticContext(diagnosticContext, async () => {
    const workspace = await prepareAgentWorkspace(launch.transport, spaceId);
    guard?.assertOwned();

    let stream: acp.Stream;
    if (launch.transport === "local-subprocess") {
      const child = spawnAgentProcess(launch, workspace);
      session.child = child;
      child.stderr?.on("data", (chunk: Buffer) => {
        // Agent stderr is the only place install/startup failures surface.
        console.warn(`[agents:${slug}] ${chunk.toString().trimEnd()}`);
      });
      child.on("exit", (code) => {
        if (session.status !== "ended") {
          void setStatus(
            session,
            "failed",
            `${launch.name} exited unexpectedly (code ${code ?? "?"}).`,
          );
        }
      });
      if (!child.stdin || !child.stdout) throw new Error("Agent process has no stdio");
      stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
    } else {
      logAcpConnection("info", "websocket_connecting", {
        connectionId,
        sessionId: id,
        slug: launch.slug,
        transport: launch.transport,
        ...endpointDiagnostics,
      });
      stream = createWebSocketStream(launch.url as string, {
        headers: {
          [ACP_CONNECTION_ID_HEADER]: connectionId,
          ...(launch.authHeader ? { Authorization: launch.authHeader } : {}),
        },
        WebSocket: WebSocket as unknown as never,
      });
    }

    // `connectWith` owns the connection for as long as its callback runs, so the
    // callback parks on a promise we resolve from close() rather than returning.
    let releaseConnection: (() => void) | undefined;
    const connectionClosed = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    let releaseReady: (() => void) | undefined;
    const connectionReady = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    let replayingHistory = false;
    const genericReplay: { updates: Record<string, unknown>[]; bytes: number; truncated: boolean } =
      {
        updates: [],
        bytes: 0,
        truncated: false,
      };
    const captureGenericReplay = (update: Record<string, unknown>) => {
      const bytes = Buffer.byteLength(JSON.stringify(update));
      if (genericReplay.updates.length < 500 && genericReplay.bytes + bytes <= 4 * 1024 * 1024) {
        genericReplay.updates.push(structuredClone(update));
        genericReplay.bytes += bytes;
      } else genericReplay.truncated = true;
    };
    let activePromptController: AbortController | null = null;
    let refreshActivePromptDeadline: (() => void) | null = null;
    let pauseActivePromptDeadline: (() => void) | null = null;
    let notificationQueue: Promise<void> = Promise.resolve();
    const receiveNotification = (apply: () => Promise<void>): Promise<void> => {
      const pending = notificationQueue.then(async () => {
        if (!session.closed) {
          await applyJournalBackpressure(session);
          await apply();
          await applyJournalBackpressure(session);
        }
      });
      notificationQueue = pending.catch((error: unknown) => {
        if (session.journal) return handleJournalFault(session, error);
        session.error =
          error instanceof Error ? error.message : "Could not apply the agent update.";
        session.status = "failed";
        session.detach();
      });
      return pending;
    };

    const app = acp
      .client({ name: "busabase" })
      .onRequest(acp.methods.client.elicitation.create, async ({ params }) => {
        await notificationQueue;
        if (
          params.mode !== "form" ||
          !("sessionId" in params) ||
          params.sessionId !== session.acpSessionId
        ) {
          return { action: "decline" as const };
        }
        const identity = budaMetadata(params)?.interactionId;
        const requestId =
          typeof identity === "string" ? identity : `input_${session.id}_${++session.inputCounter}`;
        const alreadyResolved = session.resolvedInputs.get(requestId);
        if (alreadyResolved) return alreadyResolved as acp.CreateElicitationResponse;
        pauseActivePromptDeadline?.();
        const schema = params.requestedSchema as Record<string, unknown>;
        const answered = new Promise<acp.CreateElicitationResponse>((resolve) => {
          session.pendingInputs.set(requestId, { schema, resolve });
        });
        const pendingInput = session.pendingInputs.get(requestId);
        emit(session, {
          kind: "inputRequest",
          inputRequest: {
            requestId,
            message: params.message,
            requestedSchema: schema,
            ...(typeof params.toolCallId === "string" ? { toolCallId: params.toolCallId } : {}),
          },
        });
        try {
          const result = await answered;
          if (!session.closed && !(result.action === "cancel" && pendingInput?.answering))
            emit(session, {
              kind: "inputResolved",
              inputRequestId: requestId,
              inputResponse: AgentInputResponseSchema.parse(result),
            });
          return result;
        } finally {
          session.pendingInputs.delete(requestId);
          if (session.pendingInputs.size === 0 && session.pendingPermissions.size === 0)
            refreshActivePromptDeadline?.();
        }
      })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        await notificationQueue;
        // Blocks this ACP request until a human answers via
        // respondToAgentPermission — no timeout, no auto-approve (deliberate;
        // see the type comment on LiveSession.pendingPermissions). The agent's
        // own JSON-RPC framing already holds this request open for however
        // long we take. Other requests from the same turn may be pending
        // alongside this one; each gets its own entry and its own answer.
        const interactionId = budaMetadata(ctx.params)?.interactionId;
        const requestId =
          typeof interactionId === "string"
            ? interactionId
            : `perm_${session.id}_${++session.permissionCounter}`;
        const alreadyResolved = session.resolvedPermissions.get(requestId);
        if (alreadyResolved) return { outcome: alreadyResolved };
        pauseActivePromptDeadline?.();
        const options = ctx.params.options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        }));
        // Registered before the card is published, so an answer can never
        // arrive for a request this map does not know yet.
        const answered = new Promise<acp.RequestPermissionOutcome>((resolve) => {
          session.pendingPermissions.set(requestId, {
            optionIds: new Set(options.map((o) => o.optionId)),
            resolve,
          });
        });
        emit(session, {
          kind: "acpUpdate",
          acpUpdate: {
            ...ctx.params.toolCall,
            sessionUpdate: "tool_call",
            title: ctx.params.toolCall.title ?? "Tool authorization",
            status: ctx.params.toolCall.status ?? "pending",
          },
        });
        emit(session, {
          kind: "permissionRequest",
          permissionRequest: {
            requestId,
            title: ctx.params.toolCall.title ?? undefined,
            options,
            toolCall: ctx.params.toolCall as Record<string, unknown>,
          },
        });
        let outcome: acp.RequestPermissionOutcome;
        try {
          // A concurrent request already moved the session here; a second
          // transition would only repeat the status event.
          if (session.status !== "waiting_permission") {
            await setStatus(session, "waiting_permission");
          }
          outcome = await answered;
        } finally {
          // Also when the status write throws: a stranded entry would keep
          // the session "waiting" after its request is gone.
          session.pendingPermissions.delete(requestId);
        }
        // Teardown: the transport is gone and the close owns the status.
        if (session.closed) return { outcome };
        // `cancelled` (session/cancel) is not a human choice, so there is no
        // answer to show on the card.
        if (outcome.outcome === "selected") {
          emit(session, {
            kind: "permissionResolved",
            permissionRequestId: requestId,
            permissionOptionId: outcome.optionId,
          });
        }
        // Still waiting on the human while any sibling request is unanswered;
        // only the last answer hands the turn back to the agent. After a
        // cancel too: the turn runs until the agent answers the prompt, and
        // that answer's busy -> idle transition is what the lease fence
        // expects. Only from waiting_permission — never over a turn that
        // already failed or finished.
        if (
          session.pendingPermissions.size === 0 &&
          session.pendingInputs.size === 0 &&
          session.status === "waiting_permission"
        ) {
          await setStatus(session, "busy");
          // Re-checked: a new request may have arrived during that write and
          // already paused the deadline again.
          if (session.pendingPermissions.size === 0) refreshActivePromptDeadline?.();
        }
        return { outcome };
      })
      .onNotification(
        "_buda.im/session_event",
        z
          .object({
            sessionId: z.string(),
            event: z.unknown(),
            _meta: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough(),
        ({ params }) => {
          const wasReplaying = replayingHistory;
          return receiveNotification(async () => {
            const envelope = params as Record<string, unknown>;
            if (envelope.sessionId !== session.acpSessionId && session.acpSessionId !== null)
              return;
            const event = {
              kind: "acpExtension" as const,
              acpExtension: { method: "_buda.im/session_event", params: envelope },
            };
            if (wasReplaying && session.journal && !session.budaEventStream) {
              captureGenericReplay({ method: event.acpExtension.method, params: envelope });
              return;
            }
            const seq =
              session.journal && !session.budaEventStream ? undefined : upstreamSeqOf(event);
            if (seq !== undefined && seq <= (session.upstreamSeq ?? -1)) return;
            emit(session, event);
            for (const update of translateAcpExtension(event.acpExtension)) {
              if (update.type === "input_answering") {
                const pending = session.pendingInputs.get(update.requestId);
                if (pending) pending.answering = true;
              }
              if (update.type === "permission_answering") {
                const pending = session.pendingPermissions.get(update.requestId);
                if (pending) pending.answering = true;
              }
              if (update.type === "input_resolved") {
                const response = {
                  action: update.action,
                  ...(update.content ? { content: update.content } : {}),
                };
                session.resolvedInputs.set(update.requestId, response);
                session.pendingInputs
                  .get(update.requestId)
                  ?.resolve(response as acp.CreateElicitationResponse);
                session.pendingInputs.delete(update.requestId);
              }
              if (update.type === "permission_resolved" || update.type === "permission_cancelled") {
                const outcome: acp.RequestPermissionOutcome =
                  update.type === "permission_cancelled"
                    ? { outcome: "cancelled" }
                    : { outcome: "selected", optionId: update.optionId };
                session.resolvedPermissions.set(update.requestId, outcome);
                session.pendingPermissions.get(update.requestId)?.resolve(outcome);
                session.pendingPermissions.delete(update.requestId);
              }
            }
            if (session.resolvedInputs.size > MAX_BUFFERED_EVENTS)
              session.resolvedInputs.delete(session.resolvedInputs.keys().next().value as string);
            if (session.resolvedPermissions.size > MAX_BUFFERED_EVENTS)
              session.resolvedPermissions.delete(
                session.resolvedPermissions.keys().next().value as string,
              );
            if (seq !== undefined) session.upstreamSeq = seq;
          });
        },
      )
      .onNotification(acp.methods.client.session.update, (ctx) => {
        const wasReplaying = replayingHistory;
        return receiveNotification(async () => {
          // With parallel tool calls the agent keeps streaming the work it was
          // allowed to do while a sibling card still waits; that output must
          // not restart the deadline the human's pending decision paused.
          if (session.pendingPermissions.size === 0 && session.pendingInputs.size === 0)
            refreshActivePromptDeadline?.();
          const sourceSeq =
            session.journal && !session.budaEventStream
              ? undefined
              : upstreamSeqOf({ acpUpdate: ctx.params.update });
          if (sourceSeq !== undefined && sourceSeq <= (session.upstreamSeq ?? -1)) return;
          // `config_option_update` is the agent unilaterally changing a config
          // value (e.g. auto-downgrading the model on a rate limit) rather than
          // busabase asking for it — so the local picker must follow the same
          // notification path `setAgentSessionConfigOption`'s own response
          // updates it from, or the UI would show a stale selection until the
          // next full page load.
          if (ctx.params.update.sessionUpdate === "config_option_update") {
            await syncConfigOptions(session, ctx.params.update.configOptions);
          }
          if (ctx.params.update.sessionUpdate === "current_mode_update") {
            session.modeRevision += 1;
            session.legacyCurrentModeId = ctx.params.update.currentModeId;
            if (session.legacyModeOption) {
              session.legacyModeOption = {
                ...session.legacyModeOption,
                currentValue: ctx.params.update.currentModeId,
              };
            }
            if (session.legacyModeOption && session.modeOption?.source !== "config") {
              await syncModelOption(
                session,
                session.modelOption,
                session.thinkingOption,
                session.legacyModeOption,
              );
            }
          }
          if (wasReplaying && session.journal && !session.budaEventStream)
            captureGenericReplay(ctx.params.update as Record<string, unknown>);
          // session/load replays the remote transcript. Busabase already has the
          // outer transcript in its own event table, so emitting message/tool
          // replay again would duplicate history with new seq values. Command
          // metadata is different: it is a current full-list replacement and is
          // needed to restore the composer's slash-command state on reconnect.
          if (
            wasReplaying &&
            sourceSeq === undefined &&
            ctx.params.update.sessionUpdate !== "available_commands_update"
          ) {
            return;
          }
          const update = ctx.params.update;
          const isClientEcho =
            update.sessionUpdate === "user_message_chunk" &&
            typeof update.messageId === "string" &&
            update.messageId.startsWith(`busabase-user:${session.id}:`);
          emit(session, {
            kind: "acpUpdate",
            acpUpdate: isClientEcho
              ? {
                  ...update,
                  _meta: { ...update._meta, "busabase.im": { clientEcho: true } },
                }
              : update,
          });
          if (sourceSeq !== undefined) session.upstreamSeq = sourceSeq;
        });
      });

    const handshakeTimeoutMs = agentHandshakeTimeoutMs();
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    const handshakeTimeout = new Promise<never>((_resolve, reject) => {
      handshakeTimer = setTimeout(() => {
        reject(
          new Error(
            `${launch.name} did not respond to the ACP handshake within ${handshakeTimeoutMs / 1000}s.`,
          ),
        );
      }, handshakeTimeoutMs);
      handshakeTimer.unref?.();
    });
    const clearHandshakeTimeout = () => {
      if (handshakeTimer) clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    };
    // ACP request cancellation is cooperative. Racing the handshake instead
    // makes the `connectWith` callback reject, which makes the SDK close the
    // connection and reject its still-pending request unconditionally.
    const waitForHandshake = <T>(request: Promise<T>): Promise<T> =>
      Promise.race([request, handshakeTimeout]);

    const connectPromise = app
      .connectWith(stream, async (ctx) => {
        logAcpConnection("info", "connection_opened", {
          connectionId,
          sessionId: id,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });
        logAcpConnection("info", "initialize_started", {
          connectionId,
          sessionId: id,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });
        const initialized = await waitForHandshake(
          ctx.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            // We serve no filesystem: agents use their own disk, and v2 removes
            // this surface entirely. Declaring false keeps them from asking.
            clientCapabilities: {
              elicitation: { form: {} },
              _meta: {
                "buda.im": {
                  eventStream: 1,
                  replayCursor: 1,
                  resourceRead: 1,
                  interactionRespond: 1,
                  ...(session.journal
                    ? { commandReceipts: 1, writerEpoch: 1, targetedCancel: 1, journalCoverage: 1 }
                    : {}),
                },
              },
            },
          }),
        );
        const capabilities = budaMetadata(initialized.agentCapabilities);
        session.budaEventStream = capabilities?.eventStream === 1;
        session.budaInteractionRespond = capabilities?.interactionRespond === 1;
        if (session.journal) {
          const negotiated = capabilities as Record<string, unknown> | undefined;
          session.journal.commandReceipts =
            negotiated?.commandReceipts === 1 && negotiated?.writerEpoch === 1;
          session.journal.completeCoverage =
            session.budaEventStream && negotiated?.journalCoverage === 1;
          session.journal.targetedCancel = negotiated?.targetedCancel === 1;
          session.requestExtension = (method, params) => ctx.request(method, params);
          if (session.journal.commandReceipts) {
            await waitForHandshake(
              ctx.request("_buda.im/client/register_writer", {
                bindingId: session.journal.bindingId,
                writerEpoch: session.journal.lease.epoch,
              }),
            );
          }
        }
        session.requestExtension = (method, params) => ctx.request(method, params);
        if (session.closed) {
          clearHandshakeTimeout();
          return;
        }
        logAcpConnection("info", "initialize_succeeded", {
          connectionId,
          sessionId: id,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });

        // Busabase's own MCP endpoint is what makes the agent useful at all —
        // without it the agent sits in an empty scratch directory (§6.5) with no
        // route to the user's data, which is the state Phase 1 shipped in.
        //
        // Negotiated, not assumed: `mcpCapabilities.http` is optional in ACP and
        // agents genuinely differ. Sending an HTTP MCP server to an agent that
        // only speaks stdio-MCP is not harmlessly ignored — it is a malformed
        // session for that agent — so an agent that does not advertise `http`
        // simply gets no server (this used to also emit a visible
        // "no access to this workspace's data" note, but it fired on every
        // session/new regardless of whether the turn ever needed workspace
        // data, which made it noise more often than signal).
        const supportsHttpMcp = initialized.agentCapabilities?.mcpCapabilities?.http === true;
        const mcpServers: acp.McpServer[] = supportsHttpMcp
          ? [
              {
                type: "http",
                name: "busabase",
                url: resolveBusabaseMcpUrl(),
                headers: [
                  {
                    // Cap the agent at proposing, not writing. Without this the
                    // agent inherits the local host's owner rights and its
                    // writes materialise straight into canonical data — which
                    // is the opposite of the product's whole premise, and was
                    // the state the MCP injection first shipped in.
                    //
                    // This is the *same* ceiling header the Local↔Cloud Tunnel
                    // already forwards for a Cloud-issued API key
                    // (`resolveRelayPermissionContext`), reused rather than
                    // reinvented: `/api/v1` reads it, `node-acl.ts` enforces
                    // it. It can only ever lower access — sending `manage`
                    // would gain nothing an unauthenticated local caller does
                    // not already have — so it needs no token to be minted or
                    // verified.
                    //
                    // It is a guard rail, NOT a security boundary: the agent is
                    // a child process on the user's own machine and can reach
                    // the same loopback API directly. It stops an over-eager
                    // agent (the threat `api-key-level.ts` was written for),
                    // not a hostile one — that distinction is real and is why
                    // this is worth doing anyway.
                    name: BUSABASE_RELAY_PERMISSION_LEVEL_HEADER,
                    value: "changeRequest" satisfies ApiKeyPermissionLevel,
                  },
                ],
              },
            ]
          : [];

        const sessionMethod = resume ? "session_load" : "session_new";
        logAcpConnection("info", `${sessionMethod}_started`, {
          connectionId,
          sessionId: id,
          acpSessionId: resume?.acpSessionId,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });
        let acpSessionId: string;
        let configOptions: acp.SessionConfigOption[] | null | undefined;
        let modes: acp.SessionModeState | null | undefined;
        let replayBarrierConfirmed = !resume;
        if (resume?.acpSessionId) {
          if (initialized.agentCapabilities?.loadSession !== true) {
            throw new Error(`${launch.name} does not support reopening an existing ACP session.`);
          }
          replayingHistory = true;
          try {
            const loaded = await waitForHandshake(
              ctx.request(acp.methods.agent.session.load, {
                sessionId: resume.acpSessionId,
                cwd: workspace,
                mcpServers,
                ...((session.budaEventStream && session.upstreamSeq !== undefined) ||
                session.journal?.commandReceipts
                  ? {
                      _meta: {
                        "buda.im": {
                          ...(session.budaEventStream && session.upstreamSeq !== undefined
                            ? { afterSeq: session.upstreamSeq }
                            : {}),
                          ...(session.journal?.commandReceipts
                            ? {
                                bindingId: session.journal.bindingId,
                                writerEpoch: session.journal.lease.epoch,
                              }
                            : {}),
                        },
                      },
                    }
                  : {}),
              }),
            );
            await notificationQueue;
            if (session.journal && session.budaEventStream) {
              await flushPendingEvents(session);
              const replayThrough = budaMetadata(loaded)?.replayThroughSeq;
              if (
                typeof replayThrough === "number" &&
                Number.isSafeInteger(replayThrough) &&
                replayThrough >= 0
              ) {
                if (replayThrough < (resume.upstreamSeq ?? 0))
                  throw new JournalSynchronizationError(
                    "integrity_failure",
                    `diag_${randomUUID().replaceAll("-", "")}`,
                  );
                const covered = await appendJournalEvents(
                  id,
                  [],
                  session.journal.lease,
                  { spaceId, actorId },
                  {
                    sourceSeq: replayThrough,
                    sourceGeneration: resume.acpSessionId,
                  },
                );
                if ("diagnosticRef" in covered)
                  throw new JournalSynchronizationError(covered.outcome, covered.diagnosticRef);
                replayBarrierConfirmed = true;
              }
            }
            acpSessionId = resume.acpSessionId;
            configOptions = loaded.configOptions;
            modes = loaded.modes;
          } finally {
            replayingHistory = false;
          }
        } else {
          if (session.journal) {
            if (
              session.journal.runtime.creationState !== "pending" &&
              !session.journal.commandReceipts
            ) {
              await updateJournalRuntime(
                id,
                { creationState: "unknown", executionState: "unknown", syncState: "gap" },
                session.journal.lease,
                { spaceId, actorId },
              );
              throw new Error(
                "The remote session creation outcome is unknown. Reconcile it before creating another session.",
              );
            }
            const marked = await updateJournalRuntime(
              id,
              { creationState: "dispatching" },
              session.journal.lease,
              { spaceId, actorId },
            );
            if (!marked) throw new Error("The session writer changed before remote creation.");
          }
          const created = await waitForHandshake(
            ctx.request(acp.methods.agent.session.new, {
              cwd: workspace,
              mcpServers,
              ...(session.journal?.commandReceipts
                ? {
                    _meta: {
                      "buda.im": {
                        bindingId: session.journal.bindingId,
                        writerEpoch: session.journal.lease.epoch,
                        commandId: `create_${id}`,
                      },
                    },
                  }
                : {}),
            }),
          );
          await notificationQueue;
          acpSessionId = created.sessionId;
          configOptions = created.configOptions;
          modes = created.modes;
        }
        clearHandshakeTimeout();
        guard?.assertOwned();
        if (session.closed) return;
        logAcpConnection("info", `${sessionMethod}_succeeded`, {
          connectionId,
          sessionId: id,
          acpSessionId,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });

        session.acpSessionId = acpSessionId;
        if (session.journal) {
          await flushPendingEvents(session);
          const recoveredHealthy = !resume || (session.budaEventStream && replayBarrierConfirmed);
          const marked = await updateJournalRuntime(
            id,
            {
              acpSessionId,
              creationState: "confirmed",
              connectionState: "connected",
              syncState: recoveredHealthy ? "synced" : "gap",
              ...(recoveredHealthy ? { diagnosticRef: null } : {}),
              ...(resume && !session.budaEventStream
                ? {
                    recoverySnapshot: {
                      capturedAt: nowIso(),
                      complete: !genericReplay.truncated,
                      truncated: genericReplay.truncated,
                      updates: genericReplay.updates,
                    },
                  }
                : {}),
              sourceGeneration: acpSessionId,
              capabilities: {
                ...session.journal.runtime.capabilities,
                bindingFingerprint: agentSessionBindingFingerprint(launch),
                eventStream: session.budaEventStream,
                commandReceipts: session.journal.commandReceipts,
                journalCoverage: session.journal.completeCoverage,
                targetedCancel: session.journal.targetedCancel,
              },
            },
            session.journal.lease,
            { spaceId, actorId },
          );
          if (!marked) throw new Error("The session writer changed during initialization.");
        }
        session.legacyModeOption = legacyModeOption(modes);
        if (session.legacyModeOption && session.legacyCurrentModeId !== null) {
          session.legacyModeOption.currentValue = session.legacyCurrentModeId;
        }
        await syncConfigOptions(session, configOptions);

        session.prompt = async (
          text: string,
          attachments?: PromptAttachmentInput[],
          cancellationSignal?: AbortSignal,
          contextResources?: readonly AgentContextResourceVO[],
          resourceContext?: readonly PromptResourceContextInput[],
        ) => {
          const promptGuard = requireOperationGuard(session);
          const turnId = `busabase:${randomUUID()}`;
          const emitLifecycle = (event: Record<string, unknown>) =>
            emit(session, {
              kind: "acpExtension",
              acpExtension: {
                method: "_acp-ui/lifecycle",
                params: { event: { version: 1, turnId, at: nowIso(), ...event } },
              },
            });
          if (
            session.status === "waiting_permission" ||
            (session.status === "busy" && !session.promptStarting)
          ) {
            throw new Error("This agent is still replying. Wait for the current turn to finish.");
          }
          // `promptAgentSession` publishes busy before waiting for ACP startup
          // so its HTTP caller can acknowledge acceptance without holding the
          // request open for the whole turn. Direct/internal callers that do
          // not reserve through that wrapper still transition here.
          if (session.status !== "busy") await setStatus(session, "busy");
          if (!session.budaEventStream) emitLifecycle({ type: "turn_started" });
          const promptController = new AbortController();
          activePromptController = promptController;
          const timeoutMessage = `${launch.name} stopped responding. Start a new session to continue.`;
          const inactivityTimeoutMs =
            session.transport === "remote-websocket" ? promptInactivityTimeoutMs() : null;
          let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
          let inactivityTimedOut = false;
          let rejectForInactivity = (_error: AgentPromptInactivityError) => {};
          const inactivityFailure = new Promise<never>((_resolve, reject) => {
            rejectForInactivity = reject;
          });
          const pauseInactivityDeadline = () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            inactivityTimer = undefined;
          };
          const refreshInactivityDeadline = () => {
            pauseInactivityDeadline();
            if (inactivityTimeoutMs === null) return;
            inactivityTimer = setTimeout(() => {
              inactivityTimedOut = true;
              // Send both ACP cancellation forms. The notification gives the
              // agent a session-level signal while aborting the request sends
              // `$/cancel_request` and guarantees our own await settles.
              void ctx
                .notify(acp.methods.agent.session.cancel, { sessionId: acpSessionId })
                .catch(() => undefined);
              const timeoutError = new AgentPromptInactivityError(timeoutMessage);
              promptController.abort(timeoutError);
              // Some peers acknowledge `$/cancel_request` only when their
              // handler returns. Race locally too, so an uncooperative peer
              // cannot keep Busabase busy after the deadline.
              rejectForInactivity(timeoutError);
            }, inactivityTimeoutMs);
            inactivityTimer.unref?.();
          };
          refreshActivePromptDeadline = refreshInactivityDeadline;
          pauseActivePromptDeadline = pauseInactivityDeadline;
          refreshInactivityDeadline();
          const cancelPrompt = () => {
            promptController.abort(new DOMException("ACP turn cancelled", "AbortError"));
          };
          cancellationSignal?.addEventListener("abort", cancelPrompt, { once: true });
          if (cancellationSignal?.aborted) cancelPrompt();
          try {
            if (promptController.signal.aborted) {
              await setStatus(session, "idle");
              return;
            }
            // Negotiated the same way `mcpCapabilities.http` is above, and for
            // the same reason: ACP makes `image`, `audio` and `embeddedContext`
            // opt-in, so an attachment can be valid and still be unsendable to
            // THIS agent. `buildPromptContent` drops or downgrades what the
            // agent cannot take and reports each one, and those notes go to the
            // user rather than leaving them with a reply that silently ignored
            // the PDF they attached.
            const { prompt, notes } = buildPromptContent(
              text,
              attachments,
              initialized.agentCapabilities?.promptCapabilities ?? {},
              [
                ...(resourceContext ?? []).map(promptResourceContextToContentBlock),
                ...(contextResources ?? []).map(contextResourceToContentBlock),
              ],
            );
            for (const note of notes) {
              emit(session, {
                kind: "acpUpdate",
                acpUpdate: { sessionUpdate: "note", text: note },
              });
            }
            await verifyOperationDispatch(session, promptGuard);
            // A stop can arrive while the lease renewal above is in flight.
            // Do not dispatch a new provider request after that decision.
            if (promptController.signal.aborted) {
              throw new DOMException("ACP turn cancelled before dispatch", "AbortError");
            }
            logAgentSessionDiagnostic(
              "prompt_dispatch_started",
              {
                ...sessionDiagnosticContext(session),
                stage: "dispatch",
                outcome: "started",
                ownerId: session.lease?.ownerId,
                fencingToken: session.lease?.fencingToken,
              },
              { force: true },
            );
            const result = await Promise.race([
              ctx.request(
                acp.methods.agent.session.prompt,
                {
                  sessionId: acpSessionId,
                  prompt,
                  ...((session.budaEventStream && session.currentUserMessageId) ||
                  session.journal?.commandReceipts
                    ? {
                        _meta: {
                          "buda.im": {
                            ...(session.budaEventStream && session.currentUserMessageId
                              ? { clientMessageId: session.currentUserMessageId }
                              : {}),
                            ...(session.journal?.commandReceipts && supervisedDispatch.getStore()
                              ? {
                                  bindingId: session.journal.bindingId,
                                  writerEpoch: session.journal.lease.epoch,
                                  commandId: supervisedDispatch.getStore()?.command.commandId,
                                }
                              : {}),
                          },
                        },
                      }
                    : {}),
                },
                { cancellationSignal: promptController.signal },
              ),
              inactivityFailure,
            ]);
            logAgentSessionDiagnostic(
              "prompt_response_received",
              {
                ...sessionDiagnosticContext(session),
                stage: "dispatch",
                outcome: "response_received",
              },
              { force: true },
            );
            await notificationQueue;
            if (!session.budaEventStream)
              emitLifecycle({
                type: "turn_finished",
                stopReason: promptController.signal.aborted ? "cancelled" : result.stopReason,
                ...(promptController.signal.aborted
                  ? { providerStopReason: result.stopReason }
                  : {}),
                ...(result.usage ? { usage: result.usage } : {}),
              });
            await setStatus(session, "idle");
          } catch (error) {
            if (session.journal) {
              if (isSessionBindingChangedError(error)) throw error;
              const current = await getJournalRuntime(session.id, {
                spaceId: session.spaceId,
                actorId: session.actorId,
              }).catch(() => null);
              await updateJournalRuntime(
                session.id,
                {
                  executionState: "unknown",
                  syncState:
                    current?.session.reliability?.synchronization === "gap" ? "gap" : "recovering",
                },
                session.journal.lease,
                { spaceId: session.spaceId, actorId: session.actorId },
              ).catch(() => false);
              throw error;
            }
            if (!session.budaEventStream)
              emitLifecycle({
                type: "turn_finished",
                stopReason: inactivityTimedOut
                  ? "error"
                  : promptController.signal.aborted
                    ? "cancelled"
                    : "error",
              });
            if (inactivityTimedOut) {
              logAcpConnection("warn", "prompt_inactivity_timeout", {
                connectionId,
                sessionId: id,
                acpSessionId,
                slug: launch.slug,
                transport: launch.transport,
                ...endpointDiagnostics,
                timeoutMs: inactivityTimeoutMs,
              });
              await setStatus(session, "failed", timeoutMessage);
              throw new AgentPromptInactivityError(timeoutMessage);
            }
            if (promptController.signal.aborted) {
              await setStatus(session, "idle");
              return;
            }
            const diagnostics = describeAcpError(error);
            logAcpConnection("warn", "prompt_failed", {
              connectionId,
              sessionId: id,
              acpSessionId,
              slug: launch.slug,
              transport: launch.transport,
              ...endpointDiagnostics,
              ...diagnostics,
            });
            await setStatus(session, "failed", diagnostics.message);
            throw error;
          } finally {
            pauseInactivityDeadline();
            if (refreshActivePromptDeadline === refreshInactivityDeadline) {
              refreshActivePromptDeadline = null;
            }
            if (pauseActivePromptDeadline === pauseInactivityDeadline) {
              pauseActivePromptDeadline = null;
            }
            cancellationSignal?.removeEventListener("abort", cancelPrompt);
            if (activePromptController === promptController) activePromptController = null;
          }
        };

        session.cancel = async () => {
          // `session/cancel` is a notification: it tells the agent to stop, but
          // does not itself resolve anything (ACP §Cancellation). The turn is
          // only really over when the agent responds to the *original*
          // `session/prompt` request — with `stopReason: "cancelled"` if it
          // honours the cancellation — and `session.prompt`'s own `await
          // ctx.request(...)` above is what's waiting on that response. Forcing
          // `idle` here would race that still-pending call: this notify can
          // resolve (the notification was sent) well before the agent finishes
          // stopping, and a resulting `setStatus` here would fight the one
          // `session.prompt` performs when its request actually settles.
          await ctx.notify(acp.methods.agent.session.cancel, { sessionId: acpSessionId });
          // ACP: a client that sends session/cancel MUST answer every pending
          // session/request_permission with the `cancelled` outcome. Left
          // open, a card clicked after Stop would flip the finished turn back
          // to busy.
          cancelPendingPermissions(session);
          // ACP also defines generic request cancellation. Aborting the SDK
          // request sends `$/cancel_request`, giving agents a request-scoped
          // signal in addition to the session-level notification above.
          activePromptController?.abort(new DOMException("ACP turn cancelled", "AbortError"));
        };

        const applyConfigOption = async (configId: string, value: string) => {
          const response = await ctx.request(acp.methods.agent.session.setConfigOption, {
            sessionId: acpSessionId,
            configId,
            value,
          });
          // Replace, not patch: a model change can shift what else is
          // selectable (e.g. a reasoning-effort option tied to the model), so
          // trusting the agent's complete `configOptions` list is what keeps
          // dependent values current rather than showing a choice the new
          // model no longer honours.
          await syncConfigOptions(session, response.configOptions);
          return session.modelOption;
        };
        const applyMode = async (value: string) => {
          const revision = session.modeRevision;
          await ctx.request(acp.methods.agent.session.setMode, {
            sessionId: acpSessionId,
            modeId: value,
          });
          await notificationQueue;
          // A newer notification is authoritative, including an agent-selected
          // alternative. The empty success response confirms the requested mode
          // only when no notification superseded it.
          if (revision === session.modeRevision && session.legacyModeOption) {
            session.legacyModeOption = { ...session.legacyModeOption, currentValue: value };
            if (session.modeOption?.source === "legacy") {
              await syncModelOption(
                session,
                session.modelOption,
                session.thinkingOption,
                session.legacyModeOption,
              );
            }
          }
        };
        session.setConfigOption = async (configId: string, value: string) => {
          const configGuard = requireOperationGuard(session);
          await verifyOperationDispatch(session, configGuard);
          return applyConfigOption(configId, value);
        };
        session.setMode = async (value: string) => {
          const configGuard = requireOperationGuard(session);
          await verifyOperationDispatch(session, configGuard);
          await applyMode(value);
        };

        // Apply a default only to a newly created connected session. Resuming
        // must retain the agent's persisted choice, including explicit Default.
        if (!resume && launch.transport === "remote-websocket") {
          const mode = session.modeOption;
          const full = mode?.options.find(
            (option) =>
              /^(full([ -]?access)?|bypassPermissions|danger-full-access)$/i.test(option.value) ||
              /^full( access)?$/i.test(option.name.trim()),
          );
          if (mode && full && mode.currentValue !== full.value) {
            try {
              // Creation owns this unpublished session; mutation leases are
              // acquired only by later user operations, after readiness.
              guard?.assertOwned();
              if (mode.source === "legacy") await applyMode(full.value);
              else await applyConfigOption(mode.id, full.value);
            } catch (error) {
              if (!(error instanceof acp.RequestError)) throw error;
              // A provider may advertise Full while policy forbids selecting
              // it. Keep its confirmed mode and allow the session to proceed.
              logAcpConnection("warn", "default_permission_mode_rejected", {
                connectionId,
                sessionId: id,
                ...describeAcpError(error),
              });
            }
          }
        }

        if (resume) {
          // Reattachment itself is not a user-visible state transition. The
          // durable row and event sequence remain authoritative until an
          // operation claims and changes them.
          session.status = resume.session.status;
        } else if (session.promptStarting) {
          // A same-worker first prompt may reserve the durable row while
          // session/new is still running. Publish only the inner id here so
          // readiness cannot overwrite that cross-worker busy reservation.
          if (!session.journal)
            await persistSessionAcpIdentity(session.id, acpSessionId, {
              spaceId: session.spaceId,
              actorId: session.actorId,
            });
        } else {
          if (launch.transport === "remote-websocket" && !session.journal) {
            await persistSessionAcpIdentity(session.id, acpSessionId, {
              spaceId: session.spaceId,
              actorId: session.actorId,
            });
          }
          await setStatus(session, "idle");
        }
        releaseReady?.();
        await connectionClosed;
      })
      .catch(async (error: unknown) => {
        clearHandshakeTimeout();
        const diagnostics = describeAcpError(error);
        logAcpConnection("warn", "connection_failed", {
          connectionId,
          sessionId: id,
          acpSessionId: session.acpSessionId,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
          ...diagnostics,
        });
        if (session.journal) {
          await handleJournalFault(session, error);
          releaseReady?.();
          return;
        }
        if (resume || (launch.transport === "remote-websocket" && session.status === "idle")) {
          // A recoverable remote session is durable in the agent. Losing one
          // client socket must not make another healthy worker's session
          // terminal; the next operation can attach again with session/load.
          session.status = "failed";
          session.error = diagnostics.message;
          if (sessions().get(session.id) === session) sessions().delete(session.id);
        } else {
          await setStatus(session, "failed", diagnostics.message);
        }
        releaseReady?.();
      });

    session.detach = () => {
      logAgentSessionDiagnostic(
        "session_detached",
        {
          ...sessionDiagnosticContext(session),
          stage: "detach",
          outcome: "detached",
          persistedSeq: session.persistedSeq,
          seqThrough: session.seq,
          queueDepth: session.buffer.length,
        },
        { force: true },
      );
      session.closed = true;
      // Nobody can answer a card on a released transport; settle every parked
      // handler instead of leaving its promise pending forever.
      cancelPendingPermissions(session);
      logAcpConnection("info", "connection_closing", {
        connectionId,
        sessionId: id,
        acpSessionId: session.acpSessionId,
        slug: launch.slug,
        transport: launch.transport,
        ...endpointDiagnostics,
      });
      releaseConnection?.();
      session.child?.kill();
      clearHandshakeTimeout();
      releaseReady?.();
      void connectPromise;
    };
    session.close = () => {
      session.detach();
      if (session.status !== "failed") void setStatus(session, "ended");
    };
    await connectionReady;
  }).catch(async (error: unknown) => {
    const diagnostics = describeAcpError(error);
    logAcpConnection("warn", "setup_failed", {
      connectionId,
      sessionId: id,
      slug: launch.slug,
      transport: launch.transport,
      ...endpointDiagnostics,
      ...diagnostics,
    });
    if (session.journal) {
      await handleJournalFault(session, error);
      return;
    }
    if (resume || (launch.transport === "remote-websocket" && session.status === "idle")) {
      session.status = "failed";
      session.error = diagnostics.message;
      if (sessions().get(session.id) === session) sessions().delete(session.id);
    } else {
      await setStatus(session, "failed", diagnostics.message);
    }
  });

  return session;
}

export async function createAgentSession(args: CreateSessionArgs): Promise<AgentSessionVO> {
  if (agentSessionSupervisorRequested()) {
    const launch = await resolveLaunch(args.slug);
    if (launch.transport === "remote-websocket") {
      assertAgentSessionSupervisorAvailable();
      const scope = { spaceId: args.spaceId, actorId: getContextActorId() ?? null };
      const at = nowIso();
      if (args.commandId) AgentSessionCommandIdSchema.parse(args.commandId);
      const id = args.commandId
        ? `ags_${createHash("sha256")
            .update(JSON.stringify([scope.spaceId, scope.actorId, args.commandId]))
            .digest("hex")
            .slice(0, 32)}`
        : `ags_${randomUUID().replaceAll("-", "")}`;
      const fingerprint = agentSessionBindingFingerprint(launch);
      const existing = args.commandId ? await getJournalRuntime(id, scope) : null;
      if (existing) {
        if (
          existing.session.slug !== launch.slug ||
          existing.capabilities?.bindingFingerprint !== fingerprint
        )
          throw new Error(
            "This session creation identity was already used for a different connection.",
          );
        return existing.session;
      }
      const session: AgentSessionVO = {
        id,
        slug: launch.slug,
        agentName: launch.name,
        transport: "remote-websocket",
        status: "connecting",
        error: null,
        createdAt: at,
        lastActivityAt: at,
        modelOption: null,
        thinkingOption: null,
        modeOption: null,
        reliability: { connection: "connecting", execution: "idle", synchronization: "recovering" },
        pendingCommands: [],
      };
      try {
        await createJournalSession(session, scope, { bindingFingerprint: fingerprint });
      } catch (error) {
        const raced = args.commandId ? await getJournalRuntime(id, scope).catch(() => null) : null;
        if (
          !raced ||
          raced.session.slug !== launch.slug ||
          raced.capabilities?.bindingFingerprint !== fingerprint
        )
          throw error;
        return raced.session;
      }
      void wakeAgentSessionSupervisor();
      return session;
    }
  }
  return toVO(await openAgentSession(args));
}

function toVO(s: LiveSession): AgentSessionVO {
  return {
    id: s.id,
    slug: s.slug,
    agentName: s.agentName,
    transport: s.transport,
    status: s.status,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    error: s.error,
    modelOption: s.modelOption,
    thinkingOption: s.thinkingOption,
    modeOption: s.modeOption,
  };
}

/** Mirrors agent-session-store's space + actor predicate for in-memory rows. */
function isLiveSessionVisibleToCurrentRequest(session: LiveSession): boolean {
  return (
    session.spaceId === getContextSpaceId() && session.actorId === (getContextActorId() || null)
  );
}

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForRemoteSessionIdentity(
  sessionId: string,
): Promise<AgentSessionRuntimeRecord | null> {
  const deadline = Date.now() + remoteSessionReadyTimeoutMs();
  let record = await loadSessionRuntime(sessionId);
  while (
    record?.session.transport === "remote-websocket" &&
    record.session.status === "connecting" &&
    !record.acpSessionId &&
    Date.now() < deadline
  ) {
    await wait(REMOTE_SESSION_READY_POLL_MS);
    record = await loadSessionRuntime(sessionId);
  }
  return record;
}

const reattachmentKey = (sessionId: string): string =>
  `${getContextSpaceId()}:${getContextActorId() ?? "local"}:${sessionId}`;

async function reattachRemoteSession(
  sessionId: string,
  claimedRecord?: AgentSessionRuntimeRecord,
  lease?: AgentSessionLease,
  guard?: LeaseGuard,
): Promise<LiveSession> {
  const existing = sessions().get(sessionId);
  if (existing) {
    if (!isLiveSessionVisibleToCurrentRequest(existing)) {
      throw new Error(`Unknown agent session: ${sessionId}`);
    }
    return existing;
  }

  const key = reattachmentKey(sessionId);
  const pending = reattachments().get(key);
  if (pending) return pending;

  const attempt = (async () => {
    const record = claimedRecord ?? (await waitForRemoteSessionIdentity(sessionId));
    if (!record) throw new Error(`Unknown agent session: ${sessionId}`);
    if (record.session.status === "failed") {
      throw new AgentSessionTerminalError(
        "failed",
        false,
        record.session.error ?? "This session has failed.",
      );
    }
    if (record.session.status === "ended") {
      throw new AgentSessionTerminalError("ended", false, "This session has ended.");
    }
    if (record.session.transport !== "remote-websocket") {
      throw new Error(`Unknown agent session: ${sessionId}`);
    }
    if (!record.acpSessionId) {
      throw new Error("This remote agent session is still starting. Try again shortly.");
    }
    if (
      !claimedRecord &&
      (record.session.status === "busy" || record.session.status === "waiting_permission")
    ) {
      throw new Error("This agent is still replying. Wait for the current turn to finish.");
    }

    let session: LiveSession;
    try {
      session = await openAgentSession({
        slug: record.session.slug,
        spaceId: guard?.scope.spaceId ?? getContextSpaceId(),
        resume: record,
        lease,
        guard,
      });
      await session.ready;
      guard?.assertOwned();
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "The remote agent session could not reconnect.",
      );
    }

    if (session.status === "failed") {
      sessions().delete(sessionId);
      throw new Error(
        session.error ?? "The remote agent session could not reconnect. Try again shortly.",
      );
    }
    return session;
  })();

  reattachments().set(key, attempt);
  try {
    return await attempt;
  } finally {
    if (reattachments().get(key) === attempt) reattachments().delete(key);
  }
}

function requireLocalSession(sessionId: string): LiveSession {
  const session = sessions().get(sessionId);
  if (!session || !isLiveSessionVisibleToCurrentRequest(session)) {
    throw new Error(`Unknown agent session: ${sessionId}`);
  }
  return session;
}

/**
 * Claim the single-turn slot before this worker acts on a session.
 *
 * `local-subprocess` sessions are pinned to one child process on one worker
 * — no other worker can ever hold a socket for them — so there is no
 * cross-worker race to fence and this stays a plain in-memory status check.
 * `remote-websocket` sessions can be reattached from any worker, so
 * they go through the DB-backed fencing lease: `acquireSessionLease` is one
 * atomic claim of both the lease and the busy status, keyed on an owner UUID
 * this call mints fresh each attempt.
 */
function throwUnavailableSession(
  sessionId: string,
  record: AgentSessionRuntimeRecord | null,
): never {
  if (record?.session.status === "failed") {
    throw new AgentSessionTerminalError(
      "failed",
      false,
      record.session.error ?? "This session has failed.",
    );
  }
  if (record?.session.status === "ended") {
    throw new AgentSessionTerminalError("ended", false, "This session has ended.");
  }
  if (!record || record.session.transport !== "remote-websocket") {
    throw new Error(`Unknown agent session: ${sessionId}`);
  }
  throw new Error("This agent is still replying. Wait for the current turn to finish.");
}

async function acquireOperationSession(
  sessionId: string,
): Promise<{ session: LiveSession; guard?: OperationLeaseGuard }> {
  const scope = Object.freeze({
    spaceId: getContextSpaceId(),
    actorId: getContextActorId() ?? null,
  });
  const candidate = sessions().get(sessionId);
  const existing =
    candidate && isLiveSessionVisibleToCurrentRequest(candidate) ? candidate : undefined;
  if (existing?.transport === "local-subprocess") {
    return { session: existing };
  }

  if (existing) {
    if (existing.journal) {
      const dispatch = supervisedDispatch.getStore();
      if (!dispatch) throw new Error("This supervised session must use durable command admission.");
      const guard = new JournalOperationGuard(existing, dispatch.command.commandId);
      try {
        await guard.ready();
      } catch (error) {
        await guard.release();
        throw error;
      }
      existing.status = "idle";
      return { session: existing, guard };
    }
    const ownerId = randomUUID();
    const claim = existing.modelOptionSync.then(async () => {
      const lease = await acquireSessionLease(sessionId, ownerId, sessionLeaseTtlSeconds(), scope);
      if (!lease) throwUnavailableSession(sessionId, await loadSessionRuntime(sessionId));
      const guard = new LeaseGuard(lease, scope);
      try {
        guard.attach(existing);
        const claimed = await loadSessionRuntime(sessionId, scope);
        await guard.ready();
        if (!claimed) throw new Error(`Unknown agent session: ${sessionId}`);
        // The queue drained every earlier local config update before the
        // claim, so this durable snapshot is now the cross-worker authority.
        existing.modelOption = claimed.session.modelOption;
        existing.thinkingOption = claimed.session.thinkingOption ?? null;
        existing.modeOption = claimed.session.modeOption ?? null;
        if (claimed.session.modeOption?.source === "legacy") {
          existing.legacyModeOption = claimed.session.modeOption;
        }
        existing.seq = Math.max(existing.seq, claimed.lastEventSeq);
        existing.permissionCounter = Math.max(existing.permissionCounter, claimed.lastEventSeq);
        existing.persistedSeq = Math.max(existing.persistedSeq, claimed.lastEventSeq);
        existing.status = "idle";
        return { session: existing, guard };
      } catch (error) {
        await releaseClaimedPromptPreservingFailure(guard, error, false);
        throw error;
      }
    });
    // Notifications arriving while the claim is in flight queue behind it and
    // therefore persist with the newly established fence.
    existing.modelOptionSync = claim.then(
      () => undefined,
      () => undefined,
    );
    return claim;
  }

  const initial = await waitForRemoteSessionIdentity(sessionId);
  if (initial?.session.reliability) {
    throw new Error("This supervised session must be handled by its current session writer.");
  }
  if (!initial || initial.session.transport !== "remote-websocket") {
    throwUnavailableSession(sessionId, initial);
  }
  if (!initial.acpSessionId) {
    throw new Error("This remote agent session is still starting. Try again shortly.");
  }

  const ownerId = randomUUID();
  const lease = await acquireSessionLease(sessionId, ownerId, sessionLeaseTtlSeconds(), scope);
  if (!lease) throwUnavailableSession(sessionId, await loadSessionRuntime(sessionId));
  const guard = new LeaseGuard(lease, scope);

  try {
    const claimed = await loadSessionRuntime(sessionId, scope);
    await guard.ready();
    if (!claimed) throw new Error(`Unknown agent session: ${sessionId}`);
    const session = await reattachRemoteSession(sessionId, claimed, guard.lease, guard);
    guard.attach(session);
    // This worker may have kept an older idle socket while another worker ran
    // the previous turn. The DB claim is the handoff point, so refresh the
    // sequence before this worker emits anything for the newly-owned turn.
    session.seq = Math.max(session.seq, claimed.lastEventSeq);
    session.persistedSeq = Math.max(session.persistedSeq, claimed.lastEventSeq);
    // The durable row is busy because this lease now owns the operation. The
    // local ACP wrapper must begin from idle so `session.prompt` can perform
    // its normal idle -> busy transition under that same fence.
    session.status = "idle";
    return { session, guard };
  } catch (error) {
    await releaseClaimedPromptPreservingFailure(guard, error, false);
    throw error;
  }
}

/** Release the turn slot claimed by `acquireOperationSession`, if any. */
async function releaseClaimedPromptPreservingFailure(
  guard: OperationLeaseGuard,
  operationError?: unknown,
  waitForWrites = true,
): Promise<void> {
  try {
    await guard.release(waitForWrites);
  } catch (releaseError) {
    if (operationError === undefined) throw releaseError;
    logAgentSessionDiagnostic(
      "lease_release_failed_after_operation_failure",
      {
        sessionId: guard.lease.sessionId,
        ownerId: guard.lease.ownerId,
        fencingToken: guard.lease.fencingToken,
        stage: "lease_release",
        outcome: "failed",
      },
      { level: "warn", error: releaseError, force: true },
    );
  }
}

function detachRemoteSession(session: LiveSession): void {
  if (session.transport !== "remote-websocket") return;
  session.detach();
  if (sessions().get(session.id) === session) sessions().delete(session.id);
}

function assertSessionCanAcceptPrompt(session: LiveSession, promptRecorded: boolean): void {
  if (session.status === "failed") {
    throw new AgentSessionTerminalError(
      "failed",
      promptRecorded,
      session.error ?? "This session has failed.",
    );
  }
  if (session.status === "ended") {
    throw new AgentSessionTerminalError("ended", promptRecorded, "This session has ended.");
  }
}

/**
 * Every session for this space, live or historical.
 *
 * Persisted rows are the authoritative list — that is what makes deletion and
 * disconnect deterministic across server instances. A scoped live session may
 * override only a matching non-terminal row, whose async status write can
 * legitimately be a moment behind the process actually running the agent.
 */
export async function listAgentSessions(): Promise<AgentSessionVO[]> {
  const stored = await loadSessions();
  const live = new Map(
    [...sessions().values()]
      .filter(isLiveSessionVisibleToCurrentRequest)
      .map((session) => [session.id, toVO(session)]),
  );
  // Persistence decides membership and terminal state. A live copy may only
  // make an existing active row fresher; it can never resurrect a deleted or
  // remotely-ended session.
  const merged = stored.map((row) => {
    if (TERMINAL_STATUSES.has(row.status)) return row;
    const active = live.get(row.id);
    if (!active) return row;
    // Both remote status and model selection are cross-worker state. A worker
    // may retain an older idle socket after another worker changes the model,
    // so its in-memory copy must never override the durable snapshot.
    return row.transport === "remote-websocket" ? row : active;
  });
  return merged.sort(compareSessionsByRecency);
}

export function listLiveAgentSessionIds(slug: string): string[] {
  return [...sessions().values()]
    .filter(isLiveSessionVisibleToCurrentRequest)
    .filter((session) => session.slug === slug)
    .map((session) => session.id);
}

export async function listAgentSessionsPaged(
  input: ListAgentSessionsPagedInput,
): Promise<AgentSessionsPageVO> {
  const cursor = input.cursor ? decodeAgentSessionCursor(input.cursor) : null;
  const live = [...sessions().values()]
    .filter(isLiveSessionVisibleToCurrentRequest)
    .map(toVO)
    .filter((session) => session.slug === input.slug);
  const liveById = new Map(live.map((session) => [session.id, session]));
  // A stored copy of every live session may occupy the database window, then
  // move ahead of the cursor when replaced by fresher in-memory activity. The
  // live-count allowance guarantees enough non-overlapping rows remain to fill
  // the requested page without loading the complete history.
  const stored = await loadSessionPageCandidates({
    slug: input.slug,
    limit: input.limit + live.length + 1,
    cursor,
  });
  const merged = stored
    .map((session) => {
      const active = liveById.get(session.id);
      if (!active) return session;
      return session.transport === "remote-websocket" ? session : active;
    })
    .filter((session) => isAgentSessionAfterCursor(session, cursor));
  return paginateAgentSessions(merged, input);
}

/**
 * Reserve a unique seq immediately, then persist and publish on the same
 * queue as notification flushes. Notifications arriving during the write
 * receive later sequences and cannot overtake its durable cursor.
 *
 * Failed acceptance leaves a sequence gap, but never buffers or publishes
 * the failed user event: later flushes and retries cannot revive it.
 */
async function emitPersistedFirst(
  session: LiveSession,
  event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">,
  fence: LeaseFence,
): Promise<AgentSessionEventVO | null> {
  if (session.journal) {
    enqueueJournalEvent(session, event);
    await flushJournalEvents(session);
    const committed = session.buffer.find(
      (candidate) =>
        (candidate.acpUpdate as { commandId?: string } | undefined)?.commandId ===
        supervisedDispatch.getStore()?.command.commandId,
    );
    return committed ?? null;
  }
  session.seq += 1;
  const seq = session.seq;
  const at = nowIso();
  const full: AgentSessionEventVO = { sessionId: session.id, seq, at, ...event };
  const write = session.flushPending.then(async () => {
    const persisted = await persistSessionEvents(collapseForPersistence([full]), fence, {
      spaceId: session.spaceId,
      actorId: session.actorId,
    });
    if (!persisted) return null;
    session.persistedSeq = seq;
    if (session.lastActivityAt < at) session.lastActivityAt = at;
    // Later notifications may already be buffered while this insert awaited
    // the database. Preserve replay order without buffering failed prompts.
    const nextIndex = session.buffer.findIndex((event) => event.seq > seq);
    session.buffer.splice(nextIndex < 0 ? session.buffer.length : nextIndex, 0, full);
    while (
      session.buffer.length > MAX_BUFFERED_EVENTS &&
      (session.buffer[0]?.seq ?? Infinity) <= session.persistedSeq
    )
      session.buffer.shift();
    publishEvent(session, full);
    return full;
  });
  session.flushPending = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

/**
 * ACP's `PromptRequest.prompt` is a `ContentBlock[]`, not a bare string — a
 * text block first (possibly empty, when the user sent only attachments;
 * the contract's refine already guarantees at least one of text/attachments
 * is real), then one image/audio/resource block per attachment the agent
 * advertised it can accept, in the order the browser attached them.
 */
export function promptAgentSession(
  ...args: Parameters<typeof performPromptAgentSession>
): ReturnType<typeof performPromptAgentSession> {
  return traceSessionOperation(args[0], "prompt", async () => {
    if (agentSessionSupervisorRequested()) {
      const scope = { spaceId: getContextSpaceId(), actorId: getContextActorId() ?? null };
      const runtime = await getJournalRuntime(args[0], scope);
      if (runtime?.journalMode === "supervised") {
        const options = args[3];
        const requestDigest = agentSessionCommandDigest({
          text: args[1],
          attachments: args[2],
          presentation: options?.presentation,
          contextReferences: options?.contextReferences,
          resourceContext: options?.resourceContext,
        });
        if (options?.commandId) {
          const prior = await loadSessionCommand(args[0], options.commandId, scope);
          if (prior) {
            if (prior.kind !== "prompt" || prior.payload.requestDigest !== requestDigest)
              throw new Error("This command identity was already used with different content.");
            options.onAccepted?.();
            return;
          }
        }
        const contextResources =
          options?.resolvedContextResources ??
          (options?.contextReferences?.length
            ? await resolveAgentContextResources(options.contextReferences)
            : []);
        await admitSupervisedCommand(
          args[0],
          "prompt",
          {
            text: args[1],
            requestDigest,
            ...(args[2]?.length ? { attachments: args[2] } : {}),
            ...(options?.presentation ? { presentation: options.presentation } : {}),
            ...(contextResources.length ? { contextResources } : {}),
            resourceContext: validateAgentPromptResourceContext(options?.resourceContext),
          },
          options?.commandId,
        );
        options?.onAccepted?.();
        return;
      }
    }
    return performPromptAgentSession(...args);
  });
}

async function performPromptAgentSession(
  sessionId: string,
  text: string,
  attachments?: PromptAttachmentInput[],
  options?: {
    onAccepted?: () => void;
    presentation?: AgentPromptPresentation;
    contextReferences?: readonly AgentContextReferenceInput[];
    resourceContext?: readonly PromptResourceContextInput[];
    commandId?: string;
    resolvedContextResources?: readonly AgentContextResourceVO[];
  },
): Promise<void> {
  const { session: s, guard } = await acquireOperationSession(sessionId);
  try {
    assertSessionCanAcceptPrompt(s, false);
    if (s.promptStarting || s.status === "busy" || s.status === "waiting_permission") {
      throw new Error("This agent is still replying. Wait for the current turn to finish.");
    }
  } catch (error) {
    if (guard) await releaseClaimedPromptPreservingFailure(guard, error);
    throw error;
  }
  s.promptStarting = true;
  const promptController = new AbortController();
  startingPromptControllers.set(s, promptController);
  let operationError: unknown;

  try {
    guard?.assertOwned();
    const resourceContext = validateAgentPromptResourceContext(options?.resourceContext);
    // Resolve once, before any user event is recorded or the prompt accepted.
    // Replay and ACP dispatch must use this exact snapshot, even if the page
    // changes while the agent is still starting.
    const contextResources =
      options?.resolvedContextResources ??
      (options?.contextReferences?.length
        ? await resolveAgentContextResources(options.contextReferences)
        : []);
    guard?.assertOwned();
    if (promptController.signal.aborted) {
      throw new Error("Message sending cancelled.");
    }
    // Persist the user's own message before waiting for initialize +
    // session/new, so it is authoritative and visible to current and late
    // clients even though agent startup may take seconds. `attachments`
    // rides along on this synthetic (non-ACP) event; the frontend's
    // `translate()` adapter unpacks it into content-block chunks.
    //
    // For `local-subprocess` there is no fencing lease (see
    // acquireOperationSession) — `s.lease` stays null and this write goes
    // through the plain unfenced path, matching prior behavior for that
    // transport exactly.
    const userMessage: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at"> = {
      kind: "acpUpdate",
      acpUpdate: {
        sessionUpdate: "user_message",
        text,
        ...(options?.presentation ? { presentation: options.presentation } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(contextResources.length > 0 ? { contextResources } : {}),
        ...(resourceContext.length > 0 ? { resourceContext } : {}),
      },
    };
    if (s.lease) {
      // Persist THEN publish THEN send: a failed persist here must never
      // reach a listener's buffer and must never be sent to the agent.
      await flushPendingEvents(s);
      const persistedEvent = await emitPersistedFirst(s, userMessage, s.lease);
      if (!persistedEvent) {
        throw new Error("Could not persist the prompt. Try again.");
      }
      s.currentUserMessageId = `busabase-user:${s.id}:${persistedEvent.seq}`;
    } else {
      emit(s, userMessage);
      s.currentUserMessageId = `busabase-user:${s.id}:${s.seq}`;
      await flushPendingEvents(s);
    }
    // Acceptance means the prompt is durable and the one-turn slot is owned.
    // Publish that state before waiting for initialize/session-load or the
    // remote agent's response: the browser RPC can now return quickly while
    // the subscription remains the authority for progress and completion.
    await setStatus(s, "busy");
    logAgentSessionDiagnostic(
      "prompt_accepted",
      {
        ...sessionDiagnosticContext(s),
        stage: "admission",
        outcome: "accepted",
        seqThrough: s.seq,
      },
      { force: true },
    );
    options?.onAccepted?.();
    const readiness = await waitForReadyOrCancellation(
      s.ready,
      promptController.signal,
      s.transport === "remote-websocket" ? remoteSessionReadyTimeoutMs() : undefined,
    );
    if (readiness === "cancelled") {
      await setStatus(s, "idle");
      return;
    }
    if (readiness === "timed_out") {
      const message = `${s.agentName} did not finish connecting. Start a new session to continue.`;
      promptController.abort(new Error(message));
      await setStatus(s, "failed", message);
      throw new Error(message);
    }
    assertSessionCanAcceptPrompt(s, true);
    guard?.assertOwned();
    if (resourceContext.length > 0) {
      await s.prompt(text, attachments, promptController.signal, contextResources, resourceContext);
    } else if (contextResources.length > 0) {
      await s.prompt(text, attachments, promptController.signal, contextResources);
    } else {
      await s.prompt(text, attachments, promptController.signal);
    }
    guard?.assertOwned();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      if (guard) await releaseClaimedPromptPreservingFailure(guard, operationError);
    } finally {
      if (startingPromptControllers.get(s) === promptController) {
        startingPromptControllers.delete(s);
      }
      s.promptStarting = false;
      if (s.status === "failed") detachRemoteSession(s);
    }
  }
}

/**
 * Start a turn and return once its user message is durable and its busy state
 * is published. The accepted turn continues on the live session after the RPC
 * response; transcript/status subscriptions report its eventual outcome.
 */
export async function startAgentSessionPrompt(
  sessionId: string,
  text: string,
  attachments?: PromptAttachmentInput[],
  presentation?: AgentPromptPresentation,
  contextReferences?: readonly AgentContextReferenceInput[],
  resourceContext?: readonly PromptResourceContextInput[],
  commandId?: string,
): Promise<void> {
  let accepted = false;
  let resolveStarted = () => {};
  let rejectStarted = (_error: unknown) => {};
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const completion = promptAgentSession(sessionId, text, attachments, {
    presentation,
    contextReferences,
    resourceContext,
    commandId,
    onAccepted: () => {
      accepted = true;
      resolveStarted();
    },
  });
  void completion.catch((error: unknown) => {
    if (!accepted) {
      rejectStarted(error);
      return;
    }
    // The session lifecycle already persisted and emitted the concrete failed
    // state. Keep this log structural so credentials embedded in a third-party
    // error can never leak through an unredacted background rejection.
    logAgentSessionDiagnostic(
      "accepted_prompt_failed",
      {
        sessionId,
        stage: "dispatch",
        outcome: "failed",
      },
      { level: "warn", error, force: true },
    );
  });

  await started;
}

/**
 * Send `session/cancel` for a remote session owned by another worker.
 *
 * This deliberately does not call `reattachRemoteSession`: reattachment runs
 * `session/load`, which may wait behind the in-flight turn we are trying to
 * stop. ACP cancellation only needs an initialized connection and the
 * durable ACP session id, so a short-lived connection can deliver the
 * notification immediately without replaying history or claiming the turn's
 * lease.
 */
async function cancelRemoteAgentSession(record: AgentSessionRuntimeRecord): Promise<void> {
  const launch = await resolveLaunch(record.session.slug);
  await assertScopedExtensionBinding(record, launch);
  const acpSessionId = record.acpSessionId;
  if (launch.transport !== "remote-websocket" || !launch.url || !acpSessionId) {
    throw new Error(`Unknown agent session: ${record.session.id}`);
  }

  const connectionId = createAcpConnectionId();
  const endpointDiagnostics = describeAcpEndpoint(launch.url);
  const stream = createWebSocketStream(launch.url, {
    headers: {
      [ACP_CONNECTION_ID_HEADER]: connectionId,
      ...(launch.authHeader ? { Authorization: launch.authHeader } : {}),
    },
    WebSocket: WebSocket as unknown as never,
  });

  logAcpConnection("info", "cancel_connection_started", {
    connectionId,
    sessionId: record.session.id,
    acpSessionId,
    slug: launch.slug,
    transport: launch.transport,
    ...endpointDiagnostics,
  });

  try {
    await acp.client({ name: "busabase" }).connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      await assertScopedExtensionBinding(record, await resolveLaunch(record.session.slug));
      await ctx.notify(acp.methods.agent.session.cancel, {
        sessionId: acpSessionId,
      });
    });
    logAcpConnection("info", "cancel_sent", {
      connectionId,
      sessionId: record.session.id,
      acpSessionId,
      slug: launch.slug,
      transport: launch.transport,
      ...endpointDiagnostics,
    });
  } catch (error) {
    logAcpConnection("warn", "cancel_failed", {
      connectionId,
      sessionId: record.session.id,
      acpSessionId,
      slug: launch.slug,
      transport: launch.transport,
      ...endpointDiagnostics,
      ...describeAcpError(error),
    });
    throw error;
  }
}

export function cancelAgentSession(
  ...args: Parameters<typeof performCancelAgentSession>
): ReturnType<typeof performCancelAgentSession> {
  return traceSessionOperation(args[0], "cancel", async () => {
    if (await routeSupervisedControl(args[0], "cancel", {}, args[1])) return;
    return performCancelAgentSession(...args);
  });
}

async function performCancelAgentSession(sessionId: string, _commandId?: string): Promise<void> {
  const candidate = sessions().get(sessionId);
  const local =
    candidate && isLiveSessionVisibleToCurrentRequest(candidate) ? candidate : undefined;
  if (local) {
    startingPromptControllers
      .get(local)
      ?.abort(new DOMException("Agent turn cancelled during startup", "AbortError"));
    // Before session/new/session.load there is no ACP session id a protocol
    // cancellation could name. Aborting the startup waiter above settles the
    // prompt RPC without ending this durable conversation; initialization keeps
    // running so a later prompt can reuse the same session.
    if (local.acpSessionId === null) return;
    await local.cancel();
    return;
  }

  const record = await waitForRemoteSessionIdentity(sessionId);
  if (!record || record.session.transport !== "remote-websocket") {
    throw new Error(`Unknown agent session: ${sessionId}`);
  }
  if (record.session.status === "failed" || record.session.status === "ended") {
    throw new AgentSessionTerminalError(
      record.session.status,
      false,
      record.session.error ?? `This session has ${record.session.status}.`,
    );
  }
  if (!record.acpSessionId) {
    throw new Error("This remote agent session is still starting. Try again shortly.");
  }
  await cancelRemoteAgentSession(record);
}

/**
 * Change the session's model or thinking level via ACP `session/set_config_option`.
 *
 * `configId`/`value` are validated against what THIS session most recently
 * advertised before anything is sent — the picker only ever offers values
 * from the confirmed selectors, but the RPC is the trust boundary, not the UI, so a
 * request naming a stale id or a value the agent never listed is rejected
 * here rather than forwarded.
 *
 * `s.ready` resolves even when startup failed (its `.catch` branch sets
 * `status`/`error` and still calls `releaseReady`, so `reattachRemoteSession`
 * can report a clean message instead of an unhandled rejection) — so a
 * failed/ended/closed status or a still-missing `acpSessionId` is checked
 * explicitly here. Without this, a cached `modelOption` from before the
 * failed handshake would pass the checks below and reach the startup
 * placeholder `setConfigOption` (`async () => null`), which never talks to
 * the agent and would make a failed connection look like a successful
 * config change.
 */
export function setAgentSessionConfigOption(
  ...args: Parameters<typeof performSetAgentSessionConfigOption>
): ReturnType<typeof performSetAgentSessionConfigOption> {
  return traceSessionOperation(args[0], "config", async () => {
    if (
      await routeSupervisedControl(
        args[0],
        "config",
        {
          configId: args[1],
          value: args[2],
          source: args[3] ?? "config",
        },
        args[4],
      )
    ) {
      const runtime = await loadSessionRuntime(args[0]);
      if (!runtime) throw new Error("Unknown agent session.");
      return runtime.session;
    }
    return performSetAgentSessionConfigOption(...args);
  });
}

async function performSetAgentSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string,
  source: "config" | "legacy" = "config",
  _commandId?: string,
): Promise<AgentSessionVO> {
  // Startup owns the connecting -> idle transition. Claiming a lease before
  // it finishes would change the durable status to busy and invalidate that
  // transition's fence. Wait without claiming, then validate and acquire.
  const starting = sessions().get(sessionId);
  if (
    starting &&
    isLiveSessionVisibleToCurrentRequest(starting) &&
    starting.transport === "remote-websocket" &&
    starting.status === "connecting"
  ) {
    await starting.ready;
    assertSessionCanAcceptPrompt(starting, false);
    if (starting.closed || !starting.acpSessionId) {
      throw new Error("This agent session is not connected.");
    }
  }
  const { session: s, guard } = await acquireOperationSession(sessionId);
  let operationError: unknown;
  try {
    await s.ready;
    guard?.assertOwned();
    assertSessionCanAcceptPrompt(s, false);
    if (s.closed || !s.acpSessionId) {
      throw new Error("This agent session is not connected.");
    }
    const option = (
      source === "legacy"
        ? [s.modeOption?.source === "legacy" ? s.modeOption : null]
        : [s.modelOption, s.thinkingOption, s.modeOption?.source === "config" ? s.modeOption : null]
    ).find((item) => item?.id === configId);
    if (!option) {
      throw new Error("This session has no such config option to set.");
    }
    if (!option.options.some((choice) => choice.value === value)) {
      throw new Error(`"${value}" is not one of the offered options.`);
    }
    if (source === "legacy") await s.setMode(value);
    else await s.setConfigOption(configId, value);
    guard?.assertOwned();
    return toVO(s);
  } catch (error) {
    operationError = error;
    // ACP applies the change before returning its new config snapshot. If the
    // following durable write fails, discard this socket so the next operation
    // must session/load and reconcile from the agent instead of continuing
    // with a stale split-brain view.
    if (s.transport === "remote-websocket") detachRemoteSession(s);
    throw error;
  } finally {
    if (guard) await releaseClaimedPromptPreservingFailure(guard, operationError);
    if (s.status === "failed") detachRemoteSession(s);
  }
}

/**
 * Answer every still-pending `session/request_permission` with ACP's
 * `cancelled` outcome — never `selected`, so this can never approve anything
 * on the human's behalf. The map is emptied first, so a late click on one of
 * these cards is rejected as no longer pending.
 */
function cancelPendingPermissions(session: LiveSession): void {
  const pending = [...session.pendingPermissions.entries()];
  session.pendingPermissions.clear();
  for (const [requestId, { resolve, answering }] of pending) {
    if (!answering) {
      session.resolvedPermissions.set(requestId, { outcome: "cancelled" });
      if (!session.closed)
        emit(session, {
          kind: "acpExtension",
          acpExtension: {
            method: "_acp-ui/lifecycle",
            params: { event: { type: "permission_cancelled", requestId } },
          },
        });
    }
    resolve({ outcome: "cancelled" });
  }
  const inputs = [...session.pendingInputs.entries()];
  session.pendingInputs.clear();
  for (const [requestId, { resolve, answering }] of inputs) {
    if (!answering) {
      session.resolvedInputs.set(requestId, { action: "cancel" });
      if (!session.closed)
        emit(session, {
          kind: "inputResolved",
          inputRequestId: requestId,
          inputResponse: { action: "cancel" },
        });
    }
    resolve({ action: "cancel" });
  }
}

/**
 * Answer one pending `session/request_permission`. Several can be pending at
 * once (parallel tool calls), and each is answered by its own `requestId`, in
 * any order. A stale or wrong id is rejected rather than silently resolving
 * whatever happens to be pending, since a client that raced a reconnect could
 * otherwise answer the wrong question.
 */
export function respondToAgentPermission(
  ...args: Parameters<typeof performRespondToAgentPermission>
): ReturnType<typeof performRespondToAgentPermission> {
  return traceSessionOperation(args[0], "permission", () => {
    if (!agentSessionSupervisorRequested()) return performRespondToAgentPermission(...args);
    return routeSupervisedControl(
      args[0],
      "permission",
      {
        requestId: args[1],
        optionId: args[2],
      },
      args[3],
    ).then((handled) => {
      if (!handled) return performRespondToAgentPermission(...args);
    });
  });
}

function performRespondToAgentPermission(
  sessionId: string,
  requestId: string,
  optionId: string,
  _commandId?: string,
): void | Promise<void> {
  const live = sessions().get(sessionId);
  if (live && !isLiveSessionVisibleToCurrentRequest(live))
    throw new Error(`Unknown agent session: ${sessionId}`);
  const s = live && isLiveSessionVisibleToCurrentRequest(live) ? live : undefined;
  const previous = s?.resolvedPermissions.get(requestId);
  if (previous) {
    if (previous.outcome === "selected" && previous.optionId === optionId) return;
    throw new Error("A different decision was already recorded for this request.");
  }
  if (!s || (s.budaEventStream && !s.pendingPermissions.has(requestId)))
    return respondToPersistedPermission(sessionId, requestId, optionId);
  if (s.pendingPermissions.size === 0) {
    throw new Error("No permission request is pending for this session.");
  }
  const pending = s.pendingPermissions.get(requestId);
  if (!pending) {
    throw new Error("This permission request is no longer pending.");
  }
  if (!pending.optionIds.has(optionId)) {
    throw new Error(`"${optionId}" is not one of the offered options.`);
  }
  if (s.budaInteractionRespond) {
    pending.answering = true;
    return (async () => {
      const receipt = await requestScopedAgentExtension(
        sessionId,
        "_buda.im/interaction/respond",
        { requestId, optionId, action: "accept" },
        "interactionRespond",
      );
      if (!receipt || typeof receipt !== "object" || !("ok" in receipt) || receipt.ok !== true)
        throw new Error("The agent did not confirm this decision.");
      if (s.pendingPermissions.get(requestId) !== pending) return;
      s.pendingPermissions.delete(requestId);
      s.resolvedPermissions.set(requestId, { outcome: "selected", optionId });
      pending.resolve({ outcome: "selected", optionId });
    })();
  }
  s.pendingPermissions.delete(requestId);
  s.resolvedPermissions.set(requestId, { outcome: "selected", optionId });
  pending.resolve({ outcome: "selected", optionId });
}

async function respondToPersistedPermission(
  sessionId: string,
  requestId: string,
  optionId: string,
): Promise<void> {
  const events = await loadSessionEvents(sessionId, -1);
  const receiptState = inspectPermissionReceipt(events, requestId, optionId);
  if (receiptState === "same") return;
  if (receiptState === "conflict")
    throw new Error("A different decision was already recorded for this request.");
  const request = pendingPermissionOf(events, requestId);
  if (!request || !request.options.some((option) => option.optionId === optionId))
    throw new Error("This permission request is no longer pending.");
  const receipt = await requestScopedAgentExtension(
    sessionId,
    "_buda.im/interaction/respond",
    { requestId, optionId, action: "accept" },
    "interactionRespond",
  );
  if (!receipt || typeof receipt !== "object" || !("ok" in receipt) || receipt.ok !== true)
    throw new Error("The agent did not confirm this decision.");
}

export function respondToAgentInput(
  ...args: Parameters<typeof performRespondToAgentInput>
): ReturnType<typeof performRespondToAgentInput> {
  return traceSessionOperation(args[0], "input", async () => {
    if (
      await routeSupervisedControl(
        args[0],
        "input",
        { requestId: args[1], response: args[2] },
        args[3],
      )
    )
      return;
    return performRespondToAgentInput(...args);
  });
}

async function performRespondToAgentInput(
  sessionId: string,
  requestId: string,
  response: AgentInputResponse,
  _commandId?: string,
): Promise<void> {
  if (response.action !== "accept") response = { action: response.action };
  const session = sessions().get(sessionId);
  if (session && isLiveSessionVisibleToCurrentRequest(session)) {
    const previous = session.resolvedInputs.get(requestId);
    if (previous) {
      const receipt = inspectInputReceipt(
        [
          {
            sessionId,
            seq: 0,
            at: "",
            kind: "inputResolved",
            inputRequestId: requestId,
            inputResponse: previous,
          },
        ],
        requestId,
        response,
      );
      if (receipt === "same") return;
      throw new Error("A different answer was already recorded for this question.");
    }
    const pending = session.pendingInputs.get(requestId);
    if (pending) {
      assertAgentInputResponse(pending.schema, response);
      if (session.budaInteractionRespond) {
        pending.answering = true;
        const receipt = await requestScopedAgentExtension(
          sessionId,
          "_buda.im/interaction/respond",
          { requestId, ...response },
          "interactionRespond",
        );
        if (!receipt || typeof receipt !== "object" || !("ok" in receipt) || receipt.ok !== true)
          throw new Error("The agent did not confirm this answer.");
        if (session.pendingInputs.get(requestId) !== pending) return;
      }
      session.pendingInputs.delete(requestId);
      session.resolvedInputs.set(requestId, response);
      pending.resolve(response as acp.CreateElicitationResponse);
      return;
    }
  }
  const events = await loadSessionEvents(sessionId, -1);
  const receiptState = inspectInputReceipt(events, requestId, response);
  if (receiptState === "same") return;
  if (receiptState === "conflict")
    throw new Error("A different answer was already recorded for this question.");
  const request = pendingInputOf(events, requestId);
  if (!request) throw new Error("This question is no longer pending.");
  assertAgentInputResponse(request.requestedSchema, response);
  const receipt = await requestScopedAgentExtension(
    sessionId,
    "_buda.im/interaction/respond",
    { requestId, ...response },
    "interactionRespond",
  );
  if (!receipt || typeof receipt !== "object" || !("ok" in receipt) || receipt.ok !== true)
    throw new Error("The agent did not confirm this answer.");
}

/** Authorize from the durable row even when the original socket is owned by another worker. */
async function requestScopedAgentExtension(
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
  capability: string,
): Promise<unknown> {
  const record = await loadSessionRuntime(sessionId);
  if (!record?.acpSessionId) throw new Error(`Unknown agent session: ${sessionId}`);
  const launch = await resolveLaunch(record.session.slug);
  await assertScopedExtensionBinding(record, launch);
  if (launch.transport !== "remote-websocket" || !launch.url)
    throw new Error("This agent does not make this operation available in the panel.");
  const stream = createWebSocketStream(launch.url, {
    headers: {
      [ACP_CONNECTION_ID_HEADER]: createAcpConnectionId(),
      ...(launch.authHeader ? { Authorization: launch.authHeader } : {}),
    },
    WebSocket: WebSocket as unknown as never,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      acp.client({ name: "busabase-resource-interaction" }).connectWith(stream, async (ctx) => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { _meta: { "buda.im": { resourceRead: 1, interactionRespond: 1 } } },
        });
        if (budaMetadata(initialized.agentCapabilities)?.[capability] !== 1)
          throw new Error("This agent does not make this operation available in the panel.");
        await assertScopedExtensionBinding(record, await resolveLaunch(record.session.slug));
        return ctx.request(method, { ...params, sessionId: record.acpSessionId });
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("The agent did not confirm this operation. Try again.")),
          30_000,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await stream.writable.close().catch(() => undefined);
  }
}

export async function resolveAgentResource(
  sessionId: string,
  resource: AgentResourceVO,
): Promise<AgentResourceVO> {
  const result = await requestScopedAgentExtension(
    sessionId,
    "_buda.im/resource/read",
    { resourceId: resource.id, uri: resource.uri },
    "resourceRead",
  );
  return AgentResourceVOSchema.parse(result);
}

export async function getAgentSessionSnapshot(sessionId: string) {
  return AgentSessionSnapshotVOSchema.parse(
    await requestScopedAgentExtension(
      sessionId,
      "_buda.im/session/snapshot",
      {},
      "sessionSnapshot",
    ),
  );
}

/**
 * End one session on behalf of the current request: release the process or
 * socket, keep the persisted transcript.
 *
 * The persisted row is scoped to the current actor and space. Local live
 * sessions get the same check via `requireLocalSession`; a foreign id always
 * looks like an unknown id, even when its socket lives on this worker.
 *
 * `closeAgentSessions` (plural) stays unchecked on purpose — it is the
 * server's own restart/orphan cleanup, which runs with no request context at
 * all.
 */
export async function closeAgentSession(sessionId: string, commandId?: string): Promise<void> {
  if (await routeSupervisedControl(sessionId, "close", {}, commandId)) return;
  const candidate = sessions().get(sessionId);
  const live = candidate && isLiveSessionVisibleToCurrentRequest(candidate) ? candidate : null;
  const record = await loadSessionRuntime(sessionId);
  if (!record) throw new Error(`Unknown agent session: ${sessionId}`);
  if (record.session.transport === "remote-websocket") {
    if (record.session.status === "ended" || record.session.status === "failed") {
      throw new Error(`Unknown agent session: ${sessionId}`);
    }
    if (!(await endRemoteSession(sessionId))) {
      throw new Error("This agent is still replying. Wait for the current turn to finish.");
    }
    live?.detach();
    if (sessions().get(sessionId) === live) sessions().delete(sessionId);
    return;
  }
  const local = live ?? requireLocalSession(sessionId);
  local.close();
  sessions().delete(sessionId);
}

export async function closeAgentSessions(sessionIds: string[]): Promise<void> {
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      const session = sessions().get(sessionId);
      if (!session) return;
      session.close();
      await session.ready.catch(() => undefined);
      sessions().delete(sessionId);
    }),
  );
}

async function waitForRemoteEventPoll(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, REMOTE_EVENT_POLL_MS);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Replay buffered events after `afterSeq`, then follow live. The replay is what
 * lets a client that reconnected mid-turn catch up instead of showing a gap.
 */
export async function* subscribeAgentSession(
  ...args: Parameters<typeof subscribeAgentSessionInternal>
): AsyncGenerator<AgentSessionEventVO> {
  let release: (() => void) | undefined;
  if (agentSessionSupervisorRequested()) {
    const scope = { spaceId: getContextSpaceId(), actorId: getContextActorId() ?? null };
    const runtime = await getJournalRuntime(args[0], scope);
    if (runtime?.journalMode === "supervised")
      release = await retainAgentSessionDemand(args[0], scope);
  }
  try {
    yield* subscribeAgentSessionInternal(...args);
  } finally {
    release?.();
  }
}

async function* subscribeAgentSessionInternal(
  sessionId: string,
  afterSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentSessionEventVO> {
  logAgentSessionDiagnostic("subscription_started", {
    sessionId,
    stage: "subscription",
    outcome: "started",
    persistedSeq: afterSeq,
  });
  let s = sessions().get(sessionId);
  if (s && !isLiveSessionVisibleToCurrentRequest(s)) s = undefined;
  // Use the live listener/buffer path whenever this worker holds the live
  // session object, for ANY transport — including remote-websocket, whose
  // owning worker has exactly the same in-memory buffer a local-subprocess
  // session does. Only a worker with no live, visible session for this id
  // falls back to durable polling. Correctness of "present in `sessions()`
  // implies still live and owned" rests on every lease-loss path (a fenced
  // write rejection, a heartbeat renewal failure) calling
  // `detachRemoteSession`, which evicts the map entry — see
  // `emitPersistedFirst`'s callers and `setStatus`'s failure path.
  if (!s) {
    // A remote session may be running on another server process. Keep reading
    // its durable event log until it ends or this request is aborted.
    const initialRecord = await loadSessionRuntime(sessionId);
    if (!initialRecord) throw new Error(`Unknown agent session: ${sessionId}`);
    let cursor = afterSeq;
    let record: typeof initialRecord | null = initialRecord;
    while (!signal?.aborted) {
      if (!record) return;
      for (const event of await loadSessionEvents(sessionId, cursor)) {
        cursor = Math.max(cursor, event.seq);
        yield event;
      }
      if (
        record.session.transport !== "remote-websocket" ||
        record.session.status === "ended" ||
        record.session.status === "failed"
      ) {
        return;
      }
      await waitForRemoteEventPoll(signal);
      record = await loadSessionRuntime(sessionId);
    }
    return;
  }
  if (signal?.aborted) return;
  let cursor = afterSeq;
  const queue: AgentSessionEventVO[] = [];
  let notify: (() => void) | undefined;
  const listener = (event: AgentSessionEventVO) => {
    queue.push(event);
    notify?.();
  };
  s.listeners.add(listener);

  try {
    const durable = await loadSessionEvents(sessionId, afterSeq);
    const buffered = s.buffer.filter(
      (event) =>
        event.seq > afterSeq && (s.transport === "local-subprocess" || event.seq <= s.persistedSeq),
    );
    const combined = new Map(
      [...durable, ...buffered, ...queue].map((event) => [event.seq, event]),
    );
    queue.splice(0, queue.length, ...[...combined.values()].sort((a, b) => a.seq - b.seq));
    while (!signal?.aborted) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next && next.seq > cursor) {
          cursor = next.seq;
          yield next;
        }
      }
      if (
        s.status === "ended" ||
        s.status === "failed" ||
        s.closed ||
        sessions().get(sessionId) !== s
      )
        return;
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        notify = done;
        if (s.transport === "remote-websocket") timer = setTimeout(done, REMOTE_EVENT_POLL_MS);
        signal?.addEventListener("abort", done, { once: true });
        if (signal?.aborted) done();
      });
      notify = undefined;
    }
  } finally {
    s.listeners.delete(listener);
    logAgentSessionDiagnostic(
      "subscription_finished",
      {
        ...sessionDiagnosticContext(s),
        stage: "subscription",
        outcome: "finished",
        persistedSeq: cursor,
      },
      { force: true },
    );
  }
}

registerAgentSessionSupervisorDriver({
  isConnected(sessionId, lease) {
    const session = sessions().get(sessionId);
    return Boolean(
      session &&
        !session.closed &&
        session.acpSessionId &&
        session.journal?.lease.ownerId === lease.ownerId &&
        session.journal.lease.epoch === lease.epoch,
    );
  },
  async connect(runtime, lease, scope) {
    const prior = sessions().get(runtime.session.id);
    if (prior) detachRemoteSession(prior);
    const resume = runtime.acpSessionId
      ? await loadSessionRuntime(runtime.session.id, scope)
      : undefined;
    if (runtime.acpSessionId && !resume)
      throw new Error("Could not read the remote session identity.");
    const session = await openAgentSession({
      slug: runtime.session.slug,
      spaceId: scope.spaceId,
      ...(resume ? { resume } : {}),
      persistedId: runtime.session.id,
      journalLease: lease,
      journalRuntime: runtime,
    });
    await session.ready;
    if (session.closed || !session.acpSessionId || session.status === "failed")
      throw (
        session.journal?.failure ?? new Error("The supervised remote session did not become ready.")
      );
  },
  async execute(sessionId, command, beforeDispatch) {
    const session = sessions().get(sessionId);
    if (!session?.journal || !isLiveSessionVisibleToCurrentRequest(session))
      throw new Error("The supervised session writer is not connected.");
    if (new Date(command.expiresAt).getTime() < Date.now())
      throw new Error("This command expired before dispatch.");
    const journal = session.journal;
    const scope = { spaceId: session.spaceId, actorId: session.actorId };
    const dispatch = async () => {
      await assertCurrentSessionBinding(session);
      await beforeDispatch();
      if (journal.bindingInvalidated) throw new SessionBindingChangedError();
      if (session.closed) throw new Error("The session writer is detached before dispatch.");
    };
    if (command.kind !== "close") await assertCurrentSessionBinding(session);
    return supervisedDispatch
      .run({ command, beforeDispatch: dispatch }, async () => {
        if (command.kind === "prompt") {
          journal.activeCommandId = command.commandId;
          try {
            const input = command.payload;
            if (typeof input.text !== "string") throw new Error("Invalid stored prompt.");
            await performPromptAgentSession(
              sessionId,
              input.text,
              input.attachments as PromptAttachmentInput[] | undefined,
              {
                commandId: command.commandId,
                presentation: input.presentation as AgentPromptPresentation | undefined,
                resourceContext: input.resourceContext as PromptResourceContextInput[] | undefined,
                resolvedContextResources: input.contextResources as
                  | AgentContextResourceVO[]
                  | undefined,
              },
            );
            await flushPendingEvents(session);
            return {};
          } finally {
            if (journal.activeCommandId === command.commandId) journal.activeCommandId = undefined;
          }
        }
        if (command.kind === "config") {
          const { configId, value, source } = command.payload;
          if (typeof configId !== "string" || typeof value !== "string")
            throw new Error("Invalid stored configuration.");
          await performSetAgentSessionConfigOption(
            sessionId,
            configId,
            value,
            source === "legacy" ? "legacy" : "config",
          );
          return {};
        }
        if (command.kind === "cancel") {
          const runtime = await getJournalRuntime(sessionId, scope);
          if (!command.targetCommandId || runtime?.activeCommandId !== command.targetCommandId)
            return { outcome: "stale" };
          const target = (await loadSessionCommands(sessionId, scope)).find(
            (item) => item.commandId === command.targetCommandId,
          );
          if (target && ["queued", "claimed"].includes(target.state)) {
            const cancelled = await transitionSessionCommand(
              sessionId,
              target.commandId,
              ["queued", "claimed"],
              "rejected",
              journal.lease,
              scope,
              { errorCode: "CANCELLED_BEFORE_DISPATCH" },
            );
            if (cancelled) return { outcome: "cancelled_before_dispatch" };
          }
          if (journal.commandReceipts && journal.targetedCancel && session.requestExtension) {
            const found = (await session.requestExtension("_buda.im/command/receipt", {
              bindingId: journal.bindingId,
              commandId: command.targetCommandId,
            })) as { receipt?: { turnId?: string } };
            if (!found.receipt?.turnId) throw new Error("The target turn is not yet confirmed.");
            await dispatch();
            const cancellation = (await session.requestExtension("_buda.im/session/cancel_turn", {
              bindingId: journal.bindingId,
              writerEpoch: journal.lease.epoch,
              commandId: command.commandId,
              targetCommandId: command.targetCommandId,
              sessionId: session.acpSessionId,
              turnId: found.receipt.turnId,
            })) as { outcome?: unknown } | null;
            if (!cancellation || !["requested", "stale"].includes(String(cancellation.outcome)))
              throw new Error(
                "The agent could not confirm cancellation. Reconcile the turn before retrying.",
              );
            return cancellation;
          }
          // Generic v1 cannot prove which turn a delayed session-level cancel
          // will hit. Never carry a saved cancellation into a later turn.
          if (!journal.activeCommandId || journal.activeCommandId !== command.targetCommandId)
            throw new Error("This endpoint cannot safely cancel a recovered turn.");
          await dispatch();
          await performCancelAgentSession(sessionId);
          return {};
        }
        if (command.kind === "permission") {
          if (
            typeof command.payload.requestId !== "string" ||
            typeof command.payload.optionId !== "string"
          )
            throw new Error("Invalid stored decision.");
          await dispatch();
          await performRespondToAgentPermission(
            sessionId,
            command.payload.requestId,
            command.payload.optionId,
          );
          await flushPendingEvents(session);
          return {};
        }
        if (command.kind === "input") {
          if (typeof command.payload.requestId !== "string")
            throw new Error("Invalid stored input response.");
          const response = AgentInputResponseSchema.parse(command.payload.response);
          await dispatch();
          await performRespondToAgentInput(sessionId, command.payload.requestId, response);
          await flushPendingEvents(session);
          return {};
        }
        if (command.kind === "close") {
          const runtime = await getJournalRuntime(sessionId, scope);
          if (runtime?.activeCommandId) throw new Error("This agent is still replying.");
          return { outcome: "ready_to_close" };
        }
        throw new Error("Unsupported session command.");
      })
      .catch((error: unknown) => {
        let code: unknown;
        try {
          if (error && typeof error === "object" && Reflect.get(error, "code") === -32003) {
            const data = Reflect.get(error, "data");
            if (data && typeof data === "object") code = Reflect.get(data, "code");
          }
        } catch {
          /* A hostile peer getter is not proof of rejected admission. */
        }
        if (
          journal.commandReceipts &&
          typeof code === "string" &&
          [
            "COMMAND_RECEIPT_CAPACITY",
            "COMMAND_CONTENT_CONFLICT",
            "COMMAND_OPERATION_BUSY",
            "STALE_WRITER_EPOCH",
            "COMMAND_SESSION_MISMATCH",
            "WRITER_NOT_REGISTERED",
          ].includes(code)
        )
          throw new AgentSessionCommandAdmissionError(code);
        throw error;
      });
  },
  async reconcile(sessionId, command) {
    const session = sessions().get(sessionId);
    if (!session?.journal || !session.requestExtension) return { state: "unknown" };
    await assertCurrentSessionBinding(session);
    if (
      (command.kind === "permission" || command.kind === "input") &&
      session.budaInteractionRespond
    ) {
      const payload =
        command.kind === "permission"
          ? {
              requestId: command.payload.requestId,
              optionId: command.payload.optionId,
              action: "accept",
            }
          : {
              requestId: command.payload.requestId,
              ...AgentInputResponseSchema.parse(command.payload.response),
            };
      const outcome = (await session.requestExtension("_buda.im/interaction/respond", {
        ...payload,
        sessionId: session.acpSessionId,
      })) as { ok?: boolean };
      return { state: outcome?.ok === true ? "completed" : "unknown" };
    }
    if (!session.journal.commandReceipts || !["prompt", "cancel"].includes(command.kind))
      return { state: "unknown" };
    const found = (await session.requestExtension("_buda.im/command/receipt", {
      bindingId: session.journal.bindingId,
      commandId: command.commandId,
    })) as {
      receipt?: { state?: string; turnId?: string | null; result?: Record<string, unknown> } | null;
    };
    const receipt = found.receipt;
    if (!receipt) return { state: "unknown" };
    if (receipt.state === "accepted" && new Date(command.expiresAt).getTime() <= Date.now()) {
      // An expired local intent cannot be requeued behind a remote accepted
      // receipt: that would clear the local reservation yet strand the remote
      // binding. Only a confirmed targeted rejection releases it safely.
      if (
        session.journal.targetedCancel &&
        typeof receipt.turnId === "string" &&
        session.acpSessionId
      ) {
        try {
          const cancelled = (await session.requestExtension("_buda.im/session/cancel_turn", {
            bindingId: session.journal.bindingId,
            writerEpoch: session.journal.lease.epoch,
            commandId: `expire_${createHash("sha256").update(command.commandId).digest("hex").slice(0, 32)}`,
            targetCommandId: command.commandId,
            sessionId: session.acpSessionId,
            turnId: receipt.turnId,
          })) as { outcome?: string };
          if (cancelled.outcome === "requested" || cancelled.outcome === "stale") {
            const confirmed = (await session.requestExtension("_buda.im/command/receipt", {
              bindingId: session.journal.bindingId,
              commandId: command.commandId,
            })) as { receipt?: { state?: string } | null };
            if (confirmed.receipt?.state === "rejected")
              return { state: "rejected", result: { code: "COMMAND_EXPIRED_BEFORE_DISPATCH" } };
          }
        } catch {
          /* Missing confirmation is not permission to replay or release. */
        }
      }
      await updateJournalRuntime(
        sessionId,
        { executionState: "unknown", syncState: "gap" },
        session.journal.lease,
        {
          spaceId: session.spaceId,
          actorId: session.actorId,
        },
      );
      return { state: "unknown" };
    }
    if (
      receipt.state === "completed" ||
      receipt.state === "rejected" ||
      receipt.state === "accepted"
    )
      return { state: receipt.state, result: receipt.result ?? {} };
    if (receipt.state === "running" || receipt.state === "dispatching") return { state: "running" };
    return { state: "unknown" };
  },
  detach(sessionId, lease) {
    const session = sessions().get(sessionId);
    if (
      session?.journal?.lease.ownerId === lease.ownerId &&
      session.journal.lease.epoch === lease.epoch
    )
      detachRemoteSession(session);
  },
});
