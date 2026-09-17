import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { buildPromptContent } from "@acp-ui/core/prompt";
import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import {
  type ApiKeyPermissionLevel,
  BUSABASE_RELAY_PERMISSION_LEVEL_HEADER,
} from "busabase-contract/access-control/api-key-level";
import type {
  AgentSessionEventVO,
  AgentSessionModelOptionVO,
  AgentSessionStatus,
  AgentSessionsPageVO,
  AgentSessionVO,
  ListAgentSessionsPagedInput,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import WebSocket from "ws";
import { getContextActorId, getContextSpaceId } from "../../../context";
import {
  decodeAgentSessionCursor,
  isAgentSessionAfterCursor,
  paginateAgentSessions,
} from "../utils/agent-session-pagination";
import { collapseForPersistence } from "../utils/session-updates";
import {
  ACP_CONNECTION_ID_HEADER,
  createAcpConnectionId,
  describeAcpEndpoint,
  describeAcpError,
} from "./acp-connection-diagnostics";
import { type ResolvedLaunch, resolveLaunch } from "./agent-catalog";
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

/**
 * Reduce the agent's advertised `configOptions` to the one this domain
 * renders a picker for: a flat `type: "select"` entry tagged
 * `category: "model"`. Anything else the agent offers (modes, thought level,
 * boolean toggles) is out of scope for this feature and stays unadvertised
 * rather than mis-rendered.
 *
 * Grouped select options (`SessionConfigSelectGroup[]`) are flattened —
 * dropping groups rather than modelling them keeps `AgentSessionModelOptionVO`
 * a flat list, which is all the current picker needs.
 */
function findModelOption(
  configOptions: acp.SessionConfigOption[] | null | undefined,
): AgentSessionModelOptionVO | null {
  const selects = configOptions?.filter((candidate) => candidate.type === "select") ?? [];
  const option =
    selects.find((candidate) => candidate.category === "model") ??
    selects.find((candidate) => candidate.id === "model");
  if (!option || option.type !== "select") return null;
  const options = option.options.flatMap((entry) =>
    "options" in entry
      ? entry.options.map((grouped) => ({ value: grouped.value, name: grouped.name }))
      : [{ value: entry.value, name: entry.name }],
  );
  return { id: option.id, name: option.name, currentValue: option.currentValue, options };
}

interface LiveSession {
  id: string;
  /** Immutable request ownership captured when the process/socket is launched. */
  spaceId: string;
  actorId: string | null;
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
  ) => Promise<void>;
  cancel: () => Promise<void>;
  /** Release transport ownership without ending the durable remote session. */
  detach: () => void;
  close: () => void;
  closed: boolean;
  /**
   * `null` until the agent's `session/new` response (or a later
   * `config_option_update`) advertises a `category: "model"` select.
   * Live-only, like the rest of `LiveSession` — a session reloaded from
   * history after a restart has no process left to send
   * `session/set_config_option` to, so there is nothing to advertise.
   */
  modelOption: AgentSessionModelOptionVO | null;
  /** Serializes model snapshots with remote lease acquisition and release. */
  modelOptionSync: Promise<void>;
  setConfigOption: (configId: string, value: string) => Promise<AgentSessionModelOptionVO | null>;
  seq: number;
  /** Highest `seq` already written to the database; everything above is pending. */
  persistedSeq: number;
  /** Serializes writes so terminal state never overtakes an earlier event batch. */
  flushPending: Promise<void>;
  buffer: AgentSessionEventVO[];
  listeners: Set<(event: AgentSessionEventVO) => void>;
  /**
   * At most one outstanding `session/request_permission` at a time — ACP turns
   * are sequential per session, so the agent cannot ask a second question
   * before this one resolves. `respondToAgentPermission` is the only thing
   * that resolves it; there is no timeout and no auto-approve (spec decision).
   */
  pendingPermission: { requestId: string; resolve: (optionId: string) => void } | null;
  permissionCounter: number;
  /**
   * The fencing lease held for the turn currently in flight on
   * `remote-websocket` sessions; `null` when idle or on `local-subprocess`
   * (which has no cross-worker race to fence — a single child process is
   * never contended). Read by `setStatus`/`flushPendingEvents` so the fence
   * does not need threading through every call site.
   */
  lease: AgentSessionLease | null;
}

/**
 * Update the live model selector AND queue its durable mirror (PUL-246) from
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
): Promise<void> {
  if (session.transport !== "remote-websocket") {
    session.modelOption = modelOption;
    return Promise.resolve();
  }
  const write = session.modelOptionSync.then(async () => {
    const scope = { spaceId: session.spaceId, actorId: session.actorId };
    const fence = session.lease
      ? { ownerId: session.lease.ownerId, fencingToken: session.lease.fencingToken }
      : undefined;
    const persisted = await persistSessionModelOption(session.id, modelOption, scope, fence);
    if (!persisted) throw new Error("Could not persist the agent's model options. Try again.");
    // Publish only after the durable snapshot succeeds. Keeping persistence
    // and in-memory publication in the same queue entry prevents a lease
    // claim's durable refresh from clobbering a newer queued notification.
    session.modelOption = modelOption;
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
};

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
const DEFAULT_REMOTE_SESSION_READY_TIMEOUT_MS = 30_000;
const REMOTE_SESSION_READY_POLL_MS = 100;
const REMOTE_EVENT_POLL_MS = 500;
const DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;

const configuredTimeoutMs = (name: string, fallback: number): number => {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
};

const remoteSessionReadyTimeoutMs = (): number =>
  configuredTimeoutMs(
    "BUSABASE_AGENT_SESSION_READY_TIMEOUT_MS",
    DEFAULT_REMOTE_SESSION_READY_TIMEOUT_MS,
  );

const agentHandshakeTimeoutMs = (): number =>
  configuredTimeoutMs("BUSABASE_AGENT_HANDSHAKE_TIMEOUT_MS", DEFAULT_AGENT_HANDSHAKE_TIMEOUT_MS);

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
  console[level]("[agents:acp]", { event, ...fields });
};

function emit(session: LiveSession, event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">) {
  session.seq += 1;
  session.lastActivityAt = nowIso();
  const full: AgentSessionEventVO = {
    sessionId: session.id,
    seq: session.seq,
    at: session.lastActivityAt,
    ...event,
  };
  session.buffer.push(full);
  if (session.buffer.length > MAX_BUFFERED_EVENTS) session.buffer.shift();
  for (const listener of session.listeners) {
    try {
      listener(full);
    } catch {
      // A dead subscriber must never take the session down with it.
    }
  }
  if (session.transport === "remote-websocket" && session.lease) {
    void flushPendingEvents(session).catch((error: unknown) => {
      session.status = "failed";
      session.error = error instanceof Error ? error.message : "Could not persist remote events.";
      detachRemoteSession(session);
    });
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
    const persisted = await persistSessionState(
      toVO(session),
      session.acpSessionId,
      { expectedStatuses: [expectedStatus] },
      { spaceId: session.spaceId, actorId: session.actorId },
      transitionLease ?? undefined,
    );
    if (transitionLease && !persisted) {
      throw new Error("This worker lost the agent session lease.");
    }
    if (transitionLease && status !== "busy" && session.lease === transitionLease) {
      session.lease = null;
    }
  };
  if (transitionLease && status !== "busy") {
    // This state write clears the durable lease. Queue it behind every model
    // snapshot received during the turn; later idle notifications queue after
    // it and observe the cleared local lease.
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
  const flush = session.flushPending.then(async () => {
    const pending = session.buffer.filter((event) => event.seq > session.persistedSeq);
    if (pending.length === 0) return;
    const nextPersistedSeq = pending[pending.length - 1]?.seq ?? session.persistedSeq;
    const durableEvents =
      session.transport === "remote-websocket" ? pending : collapseForPersistence(pending);
    const persisted = await persistSessionEvents(durableEvents, session.lease ?? undefined);
    if (!persisted && session.transport === "remote-websocket") {
      throw new Error("Could not persist the remote agent transcript.");
    }
    if (!persisted) return;
    session.persistedSeq = nextPersistedSeq;
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
  if (process.platform === "win32") {
    return spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], shell: true });
  }
  const shell = process.env.SHELL || "/bin/sh";
  const line = [command, ...args].map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ");
  return spawn(shell, ["-l", "-c", line], { cwd, stdio: ["pipe", "pipe", "pipe"] });
}

export interface CreateSessionArgs {
  slug: string;
  spaceId: string;
}

interface OpenAgentSessionArgs extends CreateSessionArgs {
  resume?: AgentSessionRuntimeRecord;
  lease?: AgentSessionLease;
}

async function openAgentSession({
  slug,
  spaceId,
  resume,
  lease,
}: OpenAgentSessionArgs): Promise<LiveSession> {
  const actorId = getContextActorId() ?? null;
  const launch = await resolveLaunch(slug);
  const id =
    resume?.session.id ??
    `ags_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
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

  const session: LiveSession = {
    id,
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
    modelOption: null,
    modelOptionSync: Promise.resolve(),
    setConfigOption: async () => null,
    seq: resume?.lastEventSeq ?? 0,
    persistedSeq: resume?.lastEventSeq ?? 0,
    flushPending: Promise.resolve(),
    buffer: [],
    listeners: new Set(),
    pendingPermission: null,
    permissionCounter: 0,
    lease: lease ?? null,
  };
  // Identity must be durable before a process or socket exists. Otherwise a
  // failed INSERT creates a live session that no disconnect/delete request in
  // any process can discover or tombstone. Skipped on resume: the row already
  // exists — this is reattachment, not creation, and re-inserting would
  // collide with the durable primary key.
  if (!resume) await persistSessionCreated(toVO(session), { spaceId, actorId });
  sessions().set(id, session);

  session.ready = (async () => {
    const workspace = await prepareAgentWorkspace(launch.transport, spaceId);

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
    let activePromptController: AbortController | null = null;
    let refreshActivePromptDeadline: (() => void) | null = null;
    let pauseActivePromptDeadline: (() => void) | null = null;

    const app = acp
      .client({ name: "busabase" })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        // Blocks the ACP turn until a human answers via respondToAgentPermission
        // — no timeout, no auto-approve (deliberate; see the type comment on
        // LiveSession.pendingPermission). The agent's own JSON-RPC framing
        // already holds this request open for however long we take.
        pauseActivePromptDeadline?.();
        const requestId = `perm_${session.id}_${++session.permissionCounter}`;
        const options = ctx.params.options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        }));
        emit(session, {
          kind: "permissionRequest",
          permissionRequest: {
            requestId,
            title: ctx.params.toolCall.title ?? undefined,
            options,
          },
        });
        await setStatus(session, "waiting_permission");

        const optionId = await new Promise<string>((resolve) => {
          session.pendingPermission = { requestId, resolve };
        });

        session.pendingPermission = null;
        emit(session, {
          kind: "permissionResolved",
          permissionRequestId: requestId,
          permissionOptionId: optionId,
        });
        await setStatus(session, "busy");
        refreshActivePromptDeadline?.();
        return { outcome: { outcome: "selected", optionId } };
      })
      .onNotification(acp.methods.client.session.update, async (ctx) => {
        refreshActivePromptDeadline?.();
        // `config_option_update` is the agent unilaterally changing a config
        // value (e.g. auto-downgrading the model on a rate limit) rather than
        // busabase asking for it — so the local picker must follow the same
        // notification path `setAgentSessionConfigOption`'s own response
        // updates it from, or the UI would show a stale selection until the
        // next full page load.
        if (ctx.params.update.sessionUpdate === "config_option_update") {
          await syncModelOption(session, findModelOption(ctx.params.update.configOptions));
        }
        // session/load replays the remote transcript. Busabase already has the
        // outer transcript in its own event table, so emitting that replay
        // again would duplicate every historical message with new seq values.
        if (replayingHistory) return;
        emit(session, { kind: "acpUpdate", acpUpdate: ctx.params.update });
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
            clientCapabilities: {},
          }),
        );
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
        // simply gets no server (PUL-214: this used to also emit a visible
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
              }),
            );
            acpSessionId = resume.acpSessionId;
            configOptions = loaded.configOptions;
          } finally {
            replayingHistory = false;
          }
        } else {
          const created = await waitForHandshake(
            ctx.request(acp.methods.agent.session.new, {
              cwd: workspace,
              mcpServers,
            }),
          );
          acpSessionId = created.sessionId;
          configOptions = created.configOptions;
        }
        clearHandshakeTimeout();
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
        await syncModelOption(session, findModelOption(configOptions));

        session.prompt = async (
          text: string,
          attachments?: PromptAttachmentInput[],
          cancellationSignal?: AbortSignal,
        ) => {
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
            );
            for (const note of notes) {
              emit(session, {
                kind: "acpUpdate",
                acpUpdate: { sessionUpdate: "note", text: note },
              });
            }
            await Promise.race([
              ctx.request(
                acp.methods.agent.session.prompt,
                {
                  sessionId: acpSessionId,
                  prompt,
                },
                { cancellationSignal: promptController.signal },
              ),
              inactivityFailure,
            ]);
            await setStatus(session, "idle");
          } catch (error) {
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
          // ACP also defines generic request cancellation. Aborting the SDK
          // request sends `$/cancel_request`, giving agents a request-scoped
          // signal in addition to the session-level notification above.
          activePromptController?.abort(new DOMException("ACP turn cancelled", "AbortError"));
        };

        session.setConfigOption = async (configId: string, value: string) => {
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
          await syncModelOption(session, findModelOption(response.configOptions));
          return session.modelOption;
        };

        if (resume) {
          // Reattachment itself is not a user-visible state transition. The
          // durable row and event sequence remain authoritative until an
          // operation claims and changes them.
          session.status = resume.session.status;
        } else if (session.promptStarting) {
          // A same-worker first prompt may reserve the durable row while
          // session/new is still running. Publish only the inner id here so
          // readiness cannot overwrite that cross-worker busy reservation.
          await persistSessionAcpIdentity(session.id, acpSessionId);
        } else {
          if (launch.transport === "remote-websocket") {
            await persistSessionAcpIdentity(session.id, acpSessionId);
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
      session.closed = true;
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
  })().catch(async (error: unknown) => {
    const diagnostics = describeAcpError(error);
    logAcpConnection("warn", "setup_failed", {
      connectionId,
      sessionId: id,
      slug: launch.slug,
      transport: launch.transport,
      ...endpointDiagnostics,
      ...diagnostics,
    });
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
        spaceId: getContextSpaceId(),
        resume: record,
        lease,
      });
      await session.ready;
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
 * `remote-websocket` sessions can be reattached from any worker (PUL-223), so
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
): Promise<{ session: LiveSession; leased: boolean }> {
  const candidate = sessions().get(sessionId);
  const existing =
    candidate && isLiveSessionVisibleToCurrentRequest(candidate) ? candidate : undefined;
  if (existing?.transport === "local-subprocess") {
    return { session: existing, leased: false };
  }

  if (existing) {
    const ownerId = randomUUID();
    const claim = existing.modelOptionSync.then(async () => {
      const lease = await acquireSessionLease(sessionId, ownerId);
      if (!lease) throwUnavailableSession(sessionId, await loadSessionRuntime(sessionId));
      try {
        const claimed = await loadSessionRuntime(sessionId);
        if (!claimed) throw new Error(`Unknown agent session: ${sessionId}`);
        // The queue drained every earlier local config update before the
        // claim, so this durable snapshot is now the cross-worker authority.
        existing.modelOption = claimed.session.modelOption;
        existing.seq = Math.max(existing.seq, claimed.lastEventSeq);
        existing.persistedSeq = Math.max(existing.persistedSeq, claimed.lastEventSeq);
        existing.lease = lease;
        existing.status = "idle";
        return { session: existing, leased: true };
      } catch (error) {
        await releaseSessionLease(sessionId, lease.ownerId, lease.fencingToken);
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
  if (!initial || initial.session.transport !== "remote-websocket") {
    throwUnavailableSession(sessionId, initial);
  }
  if (!initial.acpSessionId) {
    throw new Error("This remote agent session is still starting. Try again shortly.");
  }

  const ownerId = randomUUID();
  const lease = await acquireSessionLease(sessionId, ownerId);
  if (!lease) throwUnavailableSession(sessionId, await loadSessionRuntime(sessionId));

  try {
    const claimed = await loadSessionRuntime(sessionId);
    if (!claimed) throw new Error(`Unknown agent session: ${sessionId}`);
    const session = await reattachRemoteSession(sessionId, claimed, lease);
    // This worker may have kept an older idle socket while another worker ran
    // the previous turn. The DB claim is the handoff point, so refresh the
    // sequence before this worker emits anything for the newly-owned turn.
    session.seq = Math.max(session.seq, claimed.lastEventSeq);
    session.persistedSeq = Math.max(session.persistedSeq, claimed.lastEventSeq);
    session.lease = lease;
    // The durable row is busy because this lease now owns the operation. The
    // local ACP wrapper must begin from idle so `session.prompt` can perform
    // its normal idle -> busy transition under that same fence.
    session.status = "idle";
    return { session, leased: true };
  } catch (error) {
    await releaseSessionLease(sessionId, lease.ownerId, lease.fencingToken);
    throw error;
  }
}

/** Release the turn slot claimed by `acquireOperationSession`, if any. */
async function releaseClaimedPrompt(session: LiveSession): Promise<void> {
  if (session.transport !== "remote-websocket" || !session.lease) return;
  const lease = session.lease;
  const release = session.modelOptionSync.then(async () => {
    const released = await releaseSessionLease(session.id, lease.ownerId, lease.fencingToken);
    if (!released) {
      if (session.lease === lease) session.lease = null;
      detachRemoteSession(session);
      throw new Error("This worker lost the agent session lease.");
    }
    if (session.lease === lease) session.lease = null;
  });
  // A notification received after release was queued chains behind it and
  // reads the now-cleared lease when its own queue entry executes.
  session.modelOptionSync = release.catch(() => undefined);
  await release;
}

async function releaseClaimedPromptPreservingFailure(
  session: LiveSession,
  operationError?: unknown,
): Promise<void> {
  try {
    await releaseClaimedPrompt(session);
  } catch (releaseError) {
    if (operationError === undefined) throw releaseError;
    console.warn("[agents:acp]", {
      event: "lease_release_failed_after_operation_failure",
      sessionId: session.id,
      operationMessage:
        operationError instanceof Error ? operationError.message : String(operationError),
      releaseMessage: releaseError instanceof Error ? releaseError.message : String(releaseError),
    });
  }
}

function startLeaseHeartbeat(session: LiveSession): () => void {
  const lease = session.lease;
  if (!lease) return () => {};
  let renewing = false;
  const timer = setInterval(
    () => {
      if (renewing || session.lease !== lease) return;
      renewing = true;
      void renewSessionLease(session.id, lease.ownerId, lease.fencingToken)
        .then((renewed) => {
          if (renewed || session.lease !== lease) return;
          session.status = "failed";
          session.error = "This worker lost the agent session lease.";
          detachRemoteSession(session);
        })
        .finally(() => {
          renewing = false;
        });
    },
    Math.max(1_000, (sessionLeaseTtlSeconds() * 1_000) / 3),
  );
  timer.unref?.();
  return () => clearInterval(timer);
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
  return merged.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
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
 * Allocate the next seq, persist it fenced to the turn's current lease, and
 * only publish to the buffer/listeners if that persist succeeds.
 *
 * This is the persist-before-publish half of the ordering PUL-223's review
 * required: without it, a synthetic `user_message` event (or any other event
 * written this way) could be visible to a live subscriber, or already sent to
 * the agent, before it was durably recorded — so a persistence failure would
 * leave a client rendering a message that a retry could then duplicate. On
 * failure, `session.seq`/`persistedSeq`/`buffer` are left completely
 * untouched, so a retry recomputes the same candidate seq and writes exactly
 * one row on success; nothing here is visible to anyone until the write
 * lands.
 */
async function emitPersistedFirst(
  session: LiveSession,
  event: Omit<AgentSessionEventVO, "sessionId" | "seq" | "at">,
  fence: LeaseFence,
): Promise<AgentSessionEventVO | null> {
  const seq = session.seq + 1;
  const at = nowIso();
  const full: AgentSessionEventVO = { sessionId: session.id, seq, at, ...event };
  const persisted = await persistSessionEvents(collapseForPersistence([full]), fence);
  if (!persisted) return null;
  session.seq = seq;
  session.persistedSeq = seq;
  session.lastActivityAt = at;
  session.buffer.push(full);
  if (session.buffer.length > MAX_BUFFERED_EVENTS) session.buffer.shift();
  for (const listener of session.listeners) {
    try {
      listener(full);
    } catch {
      // A dead subscriber must never take the session down with it.
    }
  }
  return full;
}

/**
 * ACP's `PromptRequest.prompt` is a `ContentBlock[]`, not a bare string — a
 * text block first (possibly empty, when the user sent only attachments;
 * the contract's refine already guarantees at least one of text/attachments
 * is real), then one image/audio/resource block per attachment the agent
 * advertised it can accept, in the order the browser attached them.
 */
export async function promptAgentSession(
  sessionId: string,
  text: string,
  attachments?: PromptAttachmentInput[],
  options?: { onAccepted?: () => void },
): Promise<void> {
  const { session: s, leased } = await acquireOperationSession(sessionId);
  let stopHeartbeat = () => {};
  try {
    assertSessionCanAcceptPrompt(s, false);
    if (s.promptStarting || s.status === "busy" || s.status === "waiting_permission") {
      throw new Error("This agent is still replying. Wait for the current turn to finish.");
    }
  } catch (error) {
    if (leased) await releaseClaimedPromptPreservingFailure(s, error);
    throw error;
  }
  s.promptStarting = true;
  const promptController = new AbortController();
  startingPromptControllers.set(s, promptController);
  stopHeartbeat = startLeaseHeartbeat(s);
  let operationError: unknown;

  try {
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
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
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
    } else {
      emit(s, userMessage);
      await flushPendingEvents(s);
    }
    // Acceptance means the prompt is durable and the one-turn slot is owned.
    // Publish that state before waiting for initialize/session-load or the
    // remote agent's response: the browser RPC can now return quickly while
    // the subscription remains the authority for progress and completion.
    await setStatus(s, "busy");
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
    await s.prompt(text, attachments, promptController.signal);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      if (leased) await releaseClaimedPromptPreservingFailure(s, operationError);
    } finally {
      stopHeartbeat();
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
): Promise<void> {
  let accepted = false;
  let resolveStarted = () => {};
  let rejectStarted = (_error: unknown) => {};
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const completion = promptAgentSession(sessionId, text, attachments, {
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
    console.warn("[agents:acp]", {
      event: "accepted_prompt_failed",
      sessionId,
      errorName: error instanceof Error ? error.name : "Error",
    });
  });

  await started;
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const s = requireLocalSession(sessionId);
  startingPromptControllers
    .get(s)
    ?.abort(new DOMException("Agent turn cancelled during startup", "AbortError"));
  // Before session/new/session.load there is no ACP session id a protocol
  // cancellation could name. Aborting the startup waiter above settles the
  // prompt RPC without ending this durable conversation; initialization keeps
  // running so a later prompt can reuse the same session.
  if (s.acpSessionId === null) return;
  await s.cancel();
}

/**
 * Change the session's model via ACP `session/set_config_option`.
 *
 * `configId`/`value` are validated against what THIS session most recently
 * advertised before anything is sent — the picker only ever offers values
 * from `modelOption`, but the RPC is the trust boundary, not the UI, so a
 * request naming a stale id or a value the agent never listed is rejected
 * here rather than forwarded.
 */
export async function setAgentSessionConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<AgentSessionVO> {
  const { session: s, leased } = await acquireOperationSession(sessionId);
  const stopHeartbeat = startLeaseHeartbeat(s);
  let operationError: unknown;
  try {
    await s.ready;
    if (!s.modelOption || s.modelOption.id !== configId) {
      throw new Error("This session has no such config option to set.");
    }
    if (!s.modelOption.options.some((option) => option.value === value)) {
      throw new Error(`"${value}" is not one of the offered options.`);
    }
    await s.setConfigOption(configId, value);
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
    try {
      if (leased) await releaseClaimedPromptPreservingFailure(s, operationError);
    } finally {
      stopHeartbeat();
    }
    if (s.status === "failed") detachRemoteSession(s);
  }
}

/**
 * Answer a pending `session/request_permission`. `requestId` must match the
 * one currently pending — a stale or wrong id is rejected rather than
 * silently resolving whatever happens to be pending, since a client that
 * raced a reconnect could otherwise answer the wrong question.
 */
export function respondToAgentPermission(
  sessionId: string,
  requestId: string,
  optionId: string,
): void {
  const s = requireLocalSession(sessionId);
  if (!s.pendingPermission) {
    throw new Error("No permission request is pending for this session.");
  }
  if (s.pendingPermission.requestId !== requestId) {
    throw new Error("This permission request is no longer pending.");
  }
  const optionIds = new Set(
    (
      s.buffer.findLast(
        (e) => e.kind === "permissionRequest" && e.permissionRequest?.requestId === requestId,
      )?.permissionRequest?.options ?? []
    ).map((o) => o.optionId),
  );
  if (!optionIds.has(optionId)) {
    throw new Error(`"${optionId}" is not one of the offered options.`);
  }
  s.pendingPermission.resolve(optionId);
}

/**
 * End one session on behalf of the current request: release the process or
 * socket, keep the persisted transcript.
 *
 * Ownership is checked with the same predicate `listAgentSessionsPaged` uses,
 * so a session id belonging to another member (or another space) cannot be
 * closed by anyone who merely knows the id — the family's `write` gate is
 * about *whether* you may end sessions, not *whose*. Deliberately reported
 * with the same "Unknown agent session" wording `requireSession` throws:
 * someone else's session must be indistinguishable from one that never
 * existed, or the error itself becomes an id oracle.
 *
 * `closeAgentSessions` (plural) stays unchecked on purpose — it is the
 * server's own restart/orphan cleanup, which runs with no request context at
 * all.
 */
export async function closeAgentSession(sessionId: string): Promise<void> {
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
  sessionId: string,
  afterSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentSessionEventVO> {
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
  const queue: AgentSessionEventVO[] = s.buffer.filter((e) => e.seq > afterSeq);
  let notify: (() => void) | undefined;
  const listener = (event: AgentSessionEventVO) => {
    queue.push(event);
    notify?.();
  };
  s.listeners.add(listener);

  try {
    while (!signal?.aborted) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) yield next;
      }
      if (s.status === "ended" || s.status === "failed") return;
      await new Promise<void>((resolve) => {
        notify = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      notify = undefined;
    }
  } finally {
    s.listeners.delete(listener);
  }
}
