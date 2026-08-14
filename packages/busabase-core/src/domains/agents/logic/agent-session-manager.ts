import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client";
import type {
  AgentSessionEventVO,
  AgentSessionStatus,
  AgentSessionVO,
} from "busabase-contract/domains/agents/types";
import WebSocket from "ws";
import { type ResolvedLaunch, resolveLaunch } from "./agent-catalog";

/**
 * Live ACP sessions.
 *
 * State is in-memory and `globalThis`-scoped, for the same reason
 * `apps/busabase-cloud/src/domains/tunnel/logic/tunnel-relay.ts` does it: Next's
 * dev-mode lazy per-route compilation can re-evaluate this module independently
 * per importer, which would otherwise mint a second, empty session map — the
 * subscribe route would then never see the session the create route made.
 *
 * Sessions deliberately do not survive a restart yet; persistence
 * (`agent_sessions` / `agent_session_events`) is a later phase.
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
  prompt: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  close: () => void;
  seq: number;
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

/**
 * Force a conservative default permission mode for Claude Code sessions,
 * regardless of the user's own global `~/.claude/settings.json`.
 *
 * Verified empirically (2026-08-13), not assumed: on a machine whose global
 * Claude Code config had no explicit `permissions.defaultMode`, the ACP
 * adapter still let a Bash `echo` run without asking (its own allow-rules
 * treat some commands as safe) — expected. But without this file, a machine
 * whose global config sets a permissive mode (`acceptEdits`/`bypassPermissions`,
 * common for a developer's own daily-driver terminal use) would carry that
 * straight into every Busabase-spawned session, silently defeating the
 * permission cards this domain exists to show. Writing an explicit
 * project-level override is what makes "every request blocks and asks" a
 * guarantee Busabase controls, not something borrowed from whatever the host
 * machine happens to have configured for unrelated work.
 */
async function seedClaudeSettings(dir: string): Promise<void> {
  const claudeDir = join(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(
    join(claudeDir, "settings.json"),
    `${JSON.stringify({ permissions: { defaultMode: "default" } }, null, 2)}\n`,
  );
}

/**
 * ACP requires a real, existing absolute `cwd` and agents enforce it (Claude's
 * adapter `stat`s it and keys its session history by it). Busabase has no
 * filesystem workspace, so we allocate a stable per-space scratch directory —
 * stable because a per-connect temp dir would silently break agent-side resume.
 * See spec §6.5.
 */
async function ensureWorkspace(spaceId: string): Promise<string> {
  const dir = join(homedir(), ".busabase", "agent-workspaces", spaceId || "default");
  await mkdir(dir, { recursive: true });
  await seedClaudeSettings(dir);
  return dir;
}

export interface CreateSessionArgs {
  slug: string;
  spaceId: string;
}

export async function createAgentSession({
  slug,
  spaceId,
}: CreateSessionArgs): Promise<AgentSessionVO> {
  const launch = resolveLaunch(slug);
  const id = `ags_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;

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
    buffer: [],
    listeners: new Set(),
    pendingPermission: null,
    permissionCounter: 0,
  };
  sessions().set(id, session);

  session.ready = (async () => {
    const workspace = await ensureWorkspace(spaceId);

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
      stream = createWebSocketStream(launch.url as string, {
        headers: launch.authHeader ? { Authorization: launch.authHeader } : {},
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
        await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          // We serve no filesystem: agents use their own disk, and v2 removes
          // this surface entirely. Declaring false keeps them from asking.
          clientCapabilities: {},
        });

        const created = await ctx.request(acp.methods.agent.session.new, {
          cwd: workspace,
          mcpServers: [],
        });
        session.acpSessionId = created.sessionId;
        setStatus(session, "idle");

        session.prompt = async (text: string) => {
          if (session.status === "busy" || session.status === "waiting_permission") {
            throw new Error("This agent is still replying. Wait for the current turn to finish.");
          }
          setStatus(session, "busy");
          try {
            await ctx.request(acp.methods.agent.session.prompt, {
              sessionId: created.sessionId,
              prompt: [{ type: "text", text }],
            });
            setStatus(session, "idle");
          } catch (error) {
            setStatus(session, "failed", error instanceof Error ? error.message : String(error));
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
        setStatus(session, "failed", error instanceof Error ? error.message : String(error));
      });

    session.close = () => {
      releaseConnection?.();
      session.child?.kill();
      if (session.status !== "failed") setStatus(session, "ended");
      void connectPromise;
    };
  })().catch((error: unknown) => {
    setStatus(session, "failed", error instanceof Error ? error.message : String(error));
  });

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

export const listAgentSessions = (): AgentSessionVO[] =>
  [...sessions().values()].map(toVO).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export async function promptAgentSession(sessionId: string, text: string): Promise<void> {
  const s = requireSession(sessionId);
  await s.ready;
  if (s.status === "failed") throw new Error(s.error ?? "This session has failed.");
  // Echo the user's own message so a late subscriber can render the whole turn.
  emit(s, { kind: "acpUpdate", acpUpdate: { sessionUpdate: "user_message", text } });
  await s.prompt(text);
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

/**
 * Replay buffered events after `afterSeq`, then follow live. The replay is what
 * lets a client that reconnected mid-turn catch up instead of showing a gap.
 */
export async function* subscribeAgentSession(
  sessionId: string,
  afterSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<AgentSessionEventVO> {
  const s = requireSession(sessionId);
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
