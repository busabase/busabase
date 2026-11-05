/**
 * Actual manager/supervisor + two OS processes + shared disposable PostgreSQL
 * + one physical loopback ACP endpoint. No browser, app server or model runs.
 * POSIX only: a short SIGSTOP gives the second worker its own session owner.
 * NODE_OPTIONS=--conditions=react-server ACP_SUPERVISOR_POSTGRES_ADMIN_URL=...
 *   pnpm --filter busabase-core exec tsx scripts/verify-agent-session-supervisor-postgres.ts
 */
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { AcpServer } from "@agentclientprotocol/sdk/experimental/server";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { WebSocketServer } from "ws";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../../..");
const fixturePattern = /^formula_acceptance_acp_supervisor_[0-9]+_[a-f0-9]{8}$/;
const agentId = "supervisor_protocol_fixture";
const fixtureToken = "synthetic_supervisor_protocol_token_no_provider";
type Role = "A" | "B";
const spaceId = (role: Role) => `supervisor_postgres_space_${role}`;
interface Request {
  requestId: string;
  action: "create" | "ready" | "prompt" | "completed" | "foreign" | "status" | "pause";
  sessionId?: string;
  scope?: Role;
  commandId?: string;
  text?: string;
}
interface Result {
  kind: "result";
  requestId: string;
  pid: number;
  value: unknown;
}

function localDatabase(value: string, admin: boolean): URL {
  const url = new URL(value);
  assert(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      !url.search &&
      !url.hash,
  );
  assert(
    admin
      ? url.pathname === "/postgres"
      : fixturePattern.test(decodeURIComponent(url.pathname.slice(1))),
  );
  return url;
}

async function until<T>(probe: () => Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Supervisor fixture timed out: ${label}`);
}

async function worker(role: Role): Promise<void> {
  const url = localDatabase(process.env.ACP_SUPERVISOR_POSTGRES_URL ?? "", false);
  const client = postgres(url.href, { max: 2, prepare: false, onnotice: () => {} });
  const schema = await import("../src/db/schema");
  const database = drizzle({ client, schema });
  const context = await import("../src/context");
  const manager = await import("../src/domains/agents/logic/agent-session-manager");
  const supervisor = await import("../src/domains/agents/logic/agent-session-supervisor");
  const store = await import("../src/domains/agents/logic/agent-session-journal-store");
  const runAs = <T>(
    scope: { spaceId: string; actorId: string | null },
    operation: () => Promise<T>,
  ) =>
    context.runWithBusabaseContext(
      { db: database, spaceId: scope.spaceId, isSpaceManager: true },
      operation,
    );
  const stopHost = supervisor.startAgentSessionSupervisorHost({
    database: async () => database,
    runAs,
  });
  const registry = () =>
    (
      globalThis as typeof globalThis & {
        __busabaseSessionSupervisor?: {
          ticking?: Promise<void>;
          owners: Map<
            string,
            {
              sessionId: string;
              connected: boolean;
              connecting: Promise<void> | null;
              data: Promise<void> | null;
              controls: Map<string, unknown>;
              lease: { ownerId: string; epoch: number };
            }
          >;
        };
      }
    ).__busabaseSessionSupervisor;
  let tail = Promise.resolve();
  process.on("message", (request: Request | "shutdown") => {
    if (request === "shutdown") {
      void tail.finally(async () => {
        await stopHost();
        await client.end();
        process.disconnect?.();
      });
      return;
    }
    tail = tail
      .then(async () => {
        const target = { spaceId: spaceId(request.scope ?? role), actorId: null };
        const value = await runAs(target, async () => {
          if (request.action === "create") {
            const session = await manager.createAgentSession({
              slug: "buda",
              spaceId: target.spaceId,
              commandId: `create_supervisor_${role}`,
            });
            return { sessionId: session.id };
          }
          if (request.action === "status" || request.action === "pause") {
            await supervisor.wakeAgentSessionSupervisor();
            return {
              ownedSessions: [...(registry()?.owners.values() ?? [])].map((owner) => ({
                sessionId: owner.sessionId,
                ownerId: owner.lease.ownerId,
                connected: owner.connected,
              })),
            };
          }
          assert(request.sessionId);
          const requestedSessionId = request.sessionId;
          if (request.action === "ready")
            return until(async () => {
              await supervisor.wakeAgentSessionSupervisor();
              const runtime = await store.getJournalRuntime(requestedSessionId, target);
              const owner = [...(registry()?.owners.values() ?? [])].find(
                (entry) => entry.sessionId === request.sessionId,
              );
              return runtime?.session.reliability?.connection === "connected" &&
                owner?.connected &&
                !owner.connecting
                ? { ready: true, ownerId: owner.lease.ownerId }
                : undefined;
            }, "ready");
          if (request.action === "foreign") {
            try {
              await manager.promptAgentSession(
                request.sessionId,
                "foreign scope must not dispatch",
                undefined,
                { commandId: "command_foreign_scope_denied" },
              );
              return { rejected: false };
            } catch {
              return { rejected: true };
            }
          }
          assert(request.commandId);
          const requestedCommandId = request.commandId;
          if (request.action === "completed")
            return until(async () => {
              await supervisor.wakeAgentSessionSupervisor();
              const command = await store.loadSessionCommand(
                requestedSessionId,
                requestedCommandId,
                target,
              );
              if (command?.state === "rejected" || command?.state === "unknown")
                throw new Error("Fixture command did not complete safely");
              return command?.state === "completed" ? { completed: true } : undefined;
            }, "completed");
          await manager.promptAgentSession(
            request.sessionId,
            request.text ?? "fixture message",
            undefined,
            { commandId: request.commandId },
          );
          return { accepted: true };
        });
        const result = {
          kind: "result",
          requestId: request.requestId,
          pid: process.pid,
          value,
        } satisfies Result;
        if (request.action === "pause") {
          process.send?.(result, () => {
            void (async () => {
              // Pause only at an idle event-loop boundary, not while holding a DB
              // transaction that would hide the second worker's independent work.
              await registry()?.ticking;
              assert(
                [...(registry()?.owners.values() ?? [])].every(
                  (owner) => !owner.data && !owner.connecting && owner.controls.size === 0,
                ),
              );
              process.kill(process.pid, "SIGSTOP");
            })();
          });
        } else process.send?.(result);
      })
      .catch(() => {
        process.send?.({ kind: "failed", requestId: request.requestId, action: request.action });
        process.exitCode = 1;
      });
  });
  process.send?.({ kind: "ready", pid: process.pid });
}

async function launch(role: Role, database: URL, endpoint: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ACP_SUPERVISOR_POSTGRES_URL: database.href,
    PG_DATABASE_URL: database.href,
    PG_DATABASE_READ_URL: "",
    REDIS_URL: "",
    KV_URL: "",
    BUDA_API_KEY: fixtureToken,
    BUDA_AGENT_ID: agentId,
    BUDA_ACP_URL: endpoint,
    BUSABASE_AGENT_SUPERVISOR_ENABLED: "true",
    BUSABASE_AGENT_LEGACY_WRITERS_DRAINED: "true",
    VERCEL: "0",
    NETLIFY: "false",
    AWS_LAMBDA_FUNCTION_NAME: "",
  };
  delete env.ACP_SUPERVISOR_POSTGRES_ADMIN_URL;
  delete env.ACP_JOURNAL_POSTGRES_ADMIN_URL;
  const child = fork(scriptPath, ["worker", role], {
    execArgv: process.execArgv,
    execPath: process.execPath,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout?.on("data", (value: Buffer) => {
    output += value.toString();
  });
  child.stderr?.on("data", (value: Buffer) => {
    output += value.toString();
  });
  const wait = <T>(matches: (message: { kind?: string; requestId?: string }) => boolean) =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("Supervisor worker timed out")), 30_000);
      const onMessage = (message: { kind?: string; requestId?: string }) => {
        if (message.kind === "failed") finish(new Error("Supervisor worker action failed"));
        else if (matches(message)) finish(undefined, message as T);
      };
      const onExit = () => finish(new Error("Supervisor worker exited early"));
      function finish(error?: Error, value?: T) {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve(value as T);
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
    });
  await wait((message) => message.kind === "ready");
  let counter = 0;
  return {
    child,
    output: () => output,
    action: (
      action: Request["action"],
      fields: Omit<Partial<Request>, "requestId" | "action"> = {},
    ) => {
      const requestId = `supervisor_${role}_${++counter}`;
      const answer = wait<Result>(
        (message) => message.kind === "result" && message.requestId === requestId,
      );
      child.send({ requestId, action, ...fields });
      return answer;
    },
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGCONT");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    if (child.connected) child.send("shutdown");
    else child.kill("SIGTERM");
  });
}

async function main(): Promise<void> {
  assert(
    ["darwin", "linux"].includes(process.platform),
    "Fixture requires POSIX process suspension",
  );
  const adminValue =
    process.env.ACP_SUPERVISOR_POSTGRES_ADMIN_URL ?? process.env.ACP_JOURNAL_POSTGRES_ADMIN_URL;
  assert(adminValue, "Set ACP_SUPERVISOR_POSTGRES_ADMIN_URL explicitly to loopback /postgres");
  const adminUrl = localDatabase(adminValue, true);
  const name = `formula_acceptance_acp_supervisor_${Date.now()}_${randomBytes(4).toString("hex")}`;
  assert(fixturePattern.test(name));
  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  const admin = postgres(adminUrl.href, { max: 1, prepare: false, onnotice: () => {} });
  let sql: ReturnType<typeof postgres> | undefined;
  let created = false;
  const workers: Array<Awaited<ReturnType<typeof launch>>> = [];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const sessions = new Map<string, { seq: number; events: acp.SessionUpdate[] }>();
  const active = new Set<string>();
  const prompts: Array<{ sessionId: string; text: string }> = [];
  let maxConcurrent = 0;
  let connections = 0;
  let releaseBoth!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });
  server.on("connection", (socket, request) => {
    connections += 1;
    if (
      request.headers.authorization !== `Bearer ${fixtureToken}` ||
      new URL(request.url ?? "/", "http://fixture").searchParams.get("agentId") !== agentId
    ) {
      socket.close(1008);
      return;
    }
    const app = acp
      .agent({ name: "loopback-supervisor-fixture" })
      .onRequest(acp.methods.agent.initialize, () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          _meta: { "buda.im": { eventStream: 1, replayCursor: 1, journalCoverage: 1 } },
        },
      }))
      .onRequest(acp.methods.agent.session.new, async (ctx) => {
        const id = `remote_${randomUUID()}`;
        const update: acp.SessionUpdate = {
          sessionUpdate: "available_commands_update",
          availableCommands: [],
          _meta: { "buda.im": { seq: 1 } },
        };
        sessions.set(id, { seq: 1, events: [update] });
        await ctx.client.notify(acp.methods.client.session.update, { sessionId: id, update });
        return { sessionId: id, configOptions: [] };
      })
      .onRequest(acp.methods.agent.session.load, async (ctx) => {
        const state = sessions.get(ctx.params.sessionId);
        assert(state);
        const after =
          (ctx.params._meta?.["buda.im"] as { afterSeq?: number } | undefined)?.afterSeq ?? 0;
        for (const update of state.events)
          if (Number((update._meta?.["buda.im"] as { seq?: number } | undefined)?.seq) > after)
            await ctx.client.notify(acp.methods.client.session.update, {
              sessionId: ctx.params.sessionId,
              update,
            });
        return { configOptions: [], _meta: { "buda.im": { replayThroughSeq: state.seq } } };
      })
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        const state = sessions.get(ctx.params.sessionId);
        assert(state);
        const text = ctx.params.prompt.find((item) => item.type === "text");
        prompts.push({
          sessionId: ctx.params.sessionId,
          text: text?.type === "text" ? text.text : "",
        });
        active.add(ctx.params.sessionId);
        maxConcurrent = Math.max(maxConcurrent, active.size);
        if (active.size >= 2) releaseBoth();
        await bothStarted;
        const update: acp.SessionUpdate = {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `reply:${text?.type === "text" ? text.text : ""}` },
          _meta: { "buda.im": { seq: ++state.seq } },
        };
        state.events.push(update);
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update,
        });
        active.delete(ctx.params.sessionId);
        return { stopReason: "end_turn" };
      });
    new AcpServer({ agent: app }).prepareWebSocketUpgrade().accept(socket);
  });
  let stage = "listen";
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const endpoint = `ws://127.0.0.1:${address.port}/api/acp`;
    stage = "migrate";
    await admin`create database ${admin(name)}`;
    created = true;
    sql = postgres(target.href, { max: 2, prepare: false, onnotice: () => {} });
    await migrate(drizzle({ client: sql }), {
      migrationsFolder: path.join(repoRoot, "apps/busabase/src/db/migrations"),
    });
    stage = "first_owner";
    const a = await launch("A", target, endpoint);
    workers.push(a);
    const first = (await a.action("create")).value as { sessionId: string };
    await a.action("ready", { sessionId: first.sessionId });
    await a.action("pause");
    await until(async () => {
      const state = execFileSync("ps", ["-o", "stat=", "-p", String(a.child.pid)], {
        encoding: "utf8",
      });
      return state.includes("T") ? true : undefined;
    }, "first worker stopped");
    stage = "second_owner";
    const b = await launch("B", target, endpoint);
    workers.push(b);
    const second = (await b.action("create")).value as { sessionId: string };
    await b.action("ready", { sessionId: second.sessionId });
    a.child.kill("SIGCONT");
    const ownerA = (await a.action("status")).value as {
      ownedSessions: Array<{ sessionId: string; ownerId: string }>;
    };
    const ownerB = (await b.action("status")).value as {
      ownedSessions: Array<{ sessionId: string; ownerId: string }>;
    };
    assert(ownerA.ownedSessions.some((entry) => entry.sessionId === first.sessionId));
    assert(ownerB.ownedSessions.some((entry) => entry.sessionId === second.sessionId));
    assert.notEqual(a.child.pid, b.child.pid);
    stage = "foreign_scope";
    assert.deepEqual(
      (await b.action("foreign", { sessionId: first.sessionId, scope: "B" })).value,
      { rejected: true },
    );
    assert.equal(prompts.length, 0);
    stage = "opposite_worker_admission";
    const commands = [
      {
        sessionId: first.sessionId,
        scope: "A" as const,
        commandId: "command_actual_supervisor_A",
        text: "opposite worker to session A",
      },
      {
        sessionId: second.sessionId,
        scope: "B" as const,
        commandId: "command_actual_supervisor_B",
        text: "opposite worker to session B",
      },
    ];
    await Promise.all([b.action("prompt", commands[0]), a.action("prompt", commands[1])]);
    await Promise.all([a.action("completed", commands[0]), b.action("completed", commands[1])]);
    assert.equal(maxConcurrent, 2);
    assert.equal(prompts.length, 2);
    assert.equal(sessions.size, 2);
    stage = "duplicate_retry";
    await Promise.all([b.action("prompt", commands[0]), a.action("prompt", commands[1])]);
    await Promise.all([a.action("status"), b.action("status")]);
    assert.equal(prompts.length, 2);
    assert.equal(connections, 2);
    const rows =
      await sql`select id,space_id,actor_id,writer_owner_id,writer_epoch from busabase_agent_sessions order by space_id`;
    assert.equal(rows.length, 2);
    assert(rows.every((row) => row.actor_id === null && row.writer_owner_id));
    const proof =
      await sql`select session_id,command_id,state from busabase_agent_session_commands where kind='prompt' order by session_id`;
    assert.equal(proof.length, 2);
    assert(proof.every((row) => row.state === "completed"));
    const counts =
      await sql`select session_id,payload->>'commandId' as command_id,count(*)::int as n from busabase_agent_session_events where payload->'acpUpdate'->>'sessionUpdate'='user_message' group by session_id,payload->>'commandId'`;
    assert.equal(counts.length, 2);
    assert(counts.every((row) => row.n === 1));
    for (const command of commands)
      assert(
        counts.some(
          (row) => row.session_id === command.sessionId && row.command_id === command.commandId,
        ),
      );
    assert(
      !workers.some((entry) => entry.output().includes(fixtureToken)),
      "Credential must not appear in logs",
    );
    console.log(
      JSON.stringify({
        verification: "two_process_actual_supervisor_postgresql_acp",
        outcome: "passed",
        workers: workers.map((entry) => entry.child.pid),
        endpointCount: 1,
        remoteConnections: connections,
        remoteSessions: sessions.size,
        remotePromptRequests: prompts.length,
        maxConcurrent,
        oppositeWorkerAdmission: true,
        duplicateRetryExecutedAgain: false,
        foreignScopeDenied: true,
        distinctLiveOwners: true,
        processSuspendedAndResumed: true,
        userEventsPerCommand: 1,
        paidProviderInvoked: false,
        scope:
          "Actual manager/supervisor/SDK, real loopback WebSocket and PostgreSQL; scripted protocol peer, no model/runtime invocation",
      }),
    );
  } catch (error) {
    const location =
      error instanceof Error
        ? error.stack?.match(/verify-agent-session-supervisor-postgres\.ts:(\d+):(\d+)/)
        : undefined;
    console.error(
      JSON.stringify({
        outcome: "failed",
        stage,
        errorName: error instanceof Error ? error.name : "Error",
        ...(location ? { line: Number(location[1]) } : {}),
      }),
    );
    process.exitCode = 1;
  } finally {
    releaseBoth();
    await Promise.all(workers.map(({ child }) => stop(child)));
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await sql?.end();
    if (created) await admin`drop database ${admin(name)} with (force)`;
    await admin.end();
    console.log(
      JSON.stringify({
        cleanup: "supervisor_workers_endpoint_and_task_database_closed",
        databaseDropped: created,
      }),
    );
  }
}

const role = process.argv[3];
void (process.argv[2] === "worker" ? worker(role === "A" ? "A" : "B") : main()).catch(() => {
  console.error(JSON.stringify({ outcome: "failed", stage: "startup" }));
  process.exitCode = 1;
});
