import { type ChildProcess, spawn } from "node:child_process";
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
  AgentSessionStatus,
  AgentSessionVO,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import WebSocket from "ws";
import { collapseForPersistence } from "../utils/session-updates";
import {
  ACP_CONNECTION_ID_HEADER,
  createAcpConnectionId,
  describeAcpEndpoint,
  describeAcpError,
} from "./acp-connection-diagnostics";
import { type ResolvedLaunch, resolveLaunch } from "./agent-catalog";
import {
  loadSessionEvents,
  loadSessions,
  persistSessionCreated,
  persistSessionEvents,
  persistSessionState,
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
 * does not. Reads merge the two, with the live copy winning where both exist.
 */

const MAX_BUFFERED_EVENTS = 500;

interface LiveSession {
  id: string;
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
  /** Resolves once initialize + session/new have completed. */
  ready: Promise<void>;
  prompt: (text: string, attachments?: PromptAttachmentInput[]) => Promise<void>;
  cancel: () => Promise<void>;
  close: () => void;
  seq: number;
  /** Highest `seq` already written to the database; everything above is pending. */
  persistedSeq: number;
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
}

type GlobalWithAgentSessions = typeof globalThis & {
  __busabaseAgentSessions?: Map<string, LiveSession>;
};

function sessions(): Map<string, LiveSession> {
  const g = globalThis as GlobalWithAgentSessions;
  if (!g.__busabaseAgentSessions) g.__busabaseAgentSessions = new Map();
  return g.__busabaseAgentSessions;
}

const nowIso = () => new Date().toISOString();

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
}

function setStatus(session: LiveSession, status: AgentSessionStatus, message?: string) {
  session.status = status;
  if (status === "failed") session.error = message ?? session.error;
  emit(session, { kind: "status", status, message });
  void persistSessionState(toVO(session), session.acpSessionId);
  // A turn ending is the coalescing boundary: chunks that streamed at token
  // granularity are now a settled message, so this is the moment to write them
  // (schema note on `agent_session_events`). Persisting per `emit()` instead
  // would be one INSERT per token.
  if (status !== "busy") void flushPendingEvents(session);
}

/**
 * Write everything buffered since the last flush, once, as a single insert.
 *
 * Collapsing happens here rather than at read time so the stored transcript is
 * the same shape the UI renders — a reader of this table should not have to
 * know that a sentence arrived as forty rows.
 */
async function flushPendingEvents(session: LiveSession): Promise<void> {
  const pending = session.buffer.filter((event) => event.seq > session.persistedSeq);
  if (pending.length === 0) return;
  session.persistedSeq = pending[pending.length - 1]?.seq ?? session.persistedSeq;
  await persistSessionEvents(collapseForPersistence(pending));
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

export async function createAgentSession({
  slug,
  spaceId,
}: CreateSessionArgs): Promise<AgentSessionVO> {
  const launch = await resolveLaunch(slug);
  const id = `ags_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
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
    slug: launch.slug,
    agentName: launch.name,
    transport: launch.transport,
    status: "connecting",
    error: null,
    createdAt: nowIso(),
    lastActivityAt: nowIso(),
    acpSessionId: null,
    child: null,
    ready: Promise.resolve(),
    prompt: async () => {},
    cancel: async () => {},
    close: () => {},
    seq: 0,
    persistedSeq: 0,
    buffer: [],
    listeners: new Set(),
    pendingPermission: null,
    permissionCounter: 0,
  };
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
          setStatus(session, "failed", `${launch.name} exited unexpectedly (code ${code ?? "?"}).`);
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

    const app = acp
      .client({ name: "busabase" })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        // Blocks the ACP turn until a human answers via respondToAgentPermission
        // — no timeout, no auto-approve (deliberate; see the type comment on
        // LiveSession.pendingPermission). The agent's own JSON-RPC framing
        // already holds this request open for however long we take.
        const requestId = `perm_${session.id}_${++session.permissionCounter}`;
        const options = ctx.params.options.map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        }));
        setStatus(session, "waiting_permission");
        emit(session, {
          kind: "permissionRequest",
          permissionRequest: {
            requestId,
            title: ctx.params.toolCall.title ?? undefined,
            options,
          },
        });

        const optionId = await new Promise<string>((resolve) => {
          session.pendingPermission = { requestId, resolve };
        });

        session.pendingPermission = null;
        emit(session, {
          kind: "permissionResolved",
          permissionRequestId: requestId,
          permissionOptionId: optionId,
        });
        setStatus(session, "busy");
        return { outcome: { outcome: "selected", optionId } };
      })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        emit(session, { kind: "acpUpdate", acpUpdate: ctx.params.update });
      });

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
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          // We serve no filesystem: agents use their own disk, and v2 removes
          // this surface entirely. Declaring false keeps them from asking.
          clientCapabilities: {},
        });
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
        // gets no server and the user gets a visible note explaining why its
        // Busabase tools are missing, rather than an agent that silently cannot
        // see their data.
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

        logAcpConnection("info", "session_new_started", {
          connectionId,
          sessionId: id,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });
        const created = await ctx.request(acp.methods.agent.session.new, {
          cwd: workspace,
          mcpServers,
        });
        logAcpConnection("info", "session_new_succeeded", {
          connectionId,
          sessionId: id,
          acpSessionId: created.sessionId,
          slug: launch.slug,
          transport: launch.transport,
          ...endpointDiagnostics,
        });

        if (!supportsHttpMcp) {
          emit(session, {
            kind: "acpUpdate",
            acpUpdate: {
              sessionUpdate: "note",
              text: `${launch.name} does not support HTTP MCP servers, so it has no access to this workspace's data. It can still answer general questions.`,
            },
          });
        }
        session.acpSessionId = created.sessionId;
        setStatus(session, "idle");

        session.prompt = async (text: string, attachments?: PromptAttachmentInput[]) => {
          if (session.status === "busy" || session.status === "waiting_permission") {
            throw new Error("This agent is still replying. Wait for the current turn to finish.");
          }
          setStatus(session, "busy");
          try {
            await ctx.request(acp.methods.agent.session.prompt, {
              sessionId: created.sessionId,
              prompt: buildPromptContent(text, attachments),
            });
            setStatus(session, "idle");
          } catch (error) {
            const diagnostics = describeAcpError(error);
            logAcpConnection("warn", "prompt_failed", {
              connectionId,
              sessionId: id,
              acpSessionId: created.sessionId,
              slug: launch.slug,
              transport: launch.transport,
              ...endpointDiagnostics,
              ...diagnostics,
            });
            setStatus(session, "failed", diagnostics.message);
            throw error;
          }
        };

        session.cancel = async () => {
          await ctx.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });
          setStatus(session, "idle");
        };

        await connectionClosed;
      })
      .catch((error: unknown) => {
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
        setStatus(session, "failed", diagnostics.message);
      });

    session.close = () => {
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
      if (session.status !== "failed") setStatus(session, "ended");
      void connectPromise;
    };
  })().catch((error: unknown) => {
    const diagnostics = describeAcpError(error);
    logAcpConnection("warn", "setup_failed", {
      connectionId,
      sessionId: id,
      slug: launch.slug,
      transport: launch.transport,
      ...endpointDiagnostics,
      ...diagnostics,
    });
    setStatus(session, "failed", diagnostics.message);
  });

  await persistSessionCreated(toVO(session));
  return toVO(session);
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
  };
}

function requireSession(sessionId: string): LiveSession {
  const s = sessions().get(sessionId);
  if (!s) throw new Error(`Unknown agent session: ${sessionId}`);
  return s;
}

/**
 * Every session for this space, live or historical.
 *
 * Persisted rows are the base list — that is what makes a session survive a
 * restart — but a live session's in-memory state wins where both exist: status
 * changes several times a turn and the row is written asynchronously, so the
 * database can legitimately be a moment behind the process actually running
 * the agent.
 */
export async function listAgentSessions(): Promise<AgentSessionVO[]> {
  const stored = await loadSessions();
  const live = new Map([...sessions().values()].map((s) => [s.id, toVO(s)]));
  const merged = stored.map((row) => live.get(row.id) ?? row);
  // A session created before its INSERT landed (or when there is no db at all)
  // exists only in memory; it must still appear.
  for (const [id, vo] of live) {
    if (!merged.some((s) => s.id === id)) merged.push(vo);
  }
  return merged.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * ACP's `PromptRequest.prompt` is a `ContentBlock[]`, not a bare string — a
 * text block first (possibly empty, when the user sent only attachments;
 * the contract's refine already guarantees at least one of text/attachments
 * is real), then one image/audio block per attachment, in the order the
 * browser attached them.
 */
export async function promptAgentSession(
  sessionId: string,
  text: string,
  attachments?: PromptAttachmentInput[],
): Promise<void> {
  const s = requireSession(sessionId);
  await s.ready;
  if (s.status === "failed") throw new Error(s.error ?? "This session has failed.");
  // Echo the user's own message so a late subscriber can render the whole
  // turn. `attachments` rides along on this same synthetic (non-ACP) event —
  // the frontend's `translate()` adapter (use-agent-session.ts) knows to
  // unpack it into image/audio content-block chunks alongside the text one.
  emit(s, {
    kind: "acpUpdate",
    acpUpdate: {
      sessionUpdate: "user_message",
      text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    },
  });
  await s.prompt(text, attachments);
}

export async function cancelAgentSession(sessionId: string): Promise<void> {
  const s = requireSession(sessionId);
  await s.cancel();
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
  const s = requireSession(sessionId);
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

export function closeAgentSession(sessionId: string): void {
  const s = requireSession(sessionId);
  s.close();
  sessions().delete(sessionId);
}

export async function closeAgentSessions(sessionIds: string[]): Promise<void> {
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      const session = sessions().get(sessionId);
      if (!session) return;
      await session.ready.catch(() => undefined);
      session.close();
      sessions().delete(sessionId);
    }),
  );
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
  const s = sessions().get(sessionId);
  if (!s) {
    // No live process — either this session ended before a restart, or another
    // process owns it. Replay the stored transcript and stop, rather than
    // failing the way an unknown id used to: a session the user can still see
    // in the list must be readable, not an error.
    for (const event of await loadSessionEvents(sessionId, afterSeq)) {
      yield event;
    }
    return;
  }
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
      if (s.status === "ended") return;
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
