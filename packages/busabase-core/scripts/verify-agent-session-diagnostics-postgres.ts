/**
 * Opt-in diagnostics acceptance against a fresh, disposable local PostgreSQL DB.
 *
 * NODE_OPTIONS=--conditions=react-server \
 * ACP_DIAGNOSTICS_POSTGRES_ADMIN_URL=postgres://...@127.0.0.1:5433/postgres \
 *   pnpm --filter busabase-core exec tsx scripts/verify-agent-session-diagnostics-postgres.ts
 *
 * Creates formula_acceptance_acp_<timestamp>_<random>, applies the application's
 * existing generated migrations, runs two independent store workers, then drops
 * only that database. It never opens the configured application database. No ACP
 * socket or model is involved: connection metadata is a synthetic trace fixture.
 * The expected collision characterizes legacy behavior, not a reliability fix.
 */
import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../../..");
const migrationsFolder = path.join(repoRoot, "apps/busabase/src/db/migrations");
const fixtureDatabasePattern = /^formula_acceptance_acp_[0-9]+_[a-f0-9]{8}$/;
const scope = { spaceId: "acp-diagnostic-fixture-space", actorId: "acp-diagnostic-fixture-actor" };
const secretSeeds = [
  "sk_acp_diagnostic_never_log_8a42dffe",
  "acp_diagnostic_private_prompt_8a42dffe",
  "acp_diagnostic_signed_url_token_8a42dffe",
];
const prompt = `${secretSeeds[1]} Bearer ${secretSeeds[0]} https://example.invalid/file?token=${secretSeeds[2]}`;

type DiagnosticRecord = Record<string, string | number>;
type WorkerRole = "retained" | "owner";
type Action = "create" | "claim" | "append_unfenced" | "append_owned" | "append_stale" | "release";
interface Result {
  kind: "result";
  requestId: string;
  role: WorkerRole;
  action: Action;
  pid: number;
  operationId: string;
  value: boolean;
  records: DiagnosticRecord[];
}

function localUrl(value: string, database: "admin" | "fixture"): URL {
  const parsed = new URL(value);
  assert(
    ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.search === "" &&
      parsed.hash === "",
    "Only explicit loopback PostgreSQL URLs without query overrides are allowed",
  );
  const name = decodeURIComponent(parsed.pathname.slice(1));
  assert(
    database === "admin" ? name === "postgres" : fixtureDatabasePattern.test(name),
    "Admin URL must name postgres; worker URL must name this script's isolated fixture",
  );
  return parsed;
}

async function worker(role: WorkerRole): Promise<void> {
  const target = process.env.ACP_DIAGNOSTICS_POSTGRES_URL;
  assert(target, "Worker fixture URL is required");
  const url = localUrl(target, "fixture");
  const client = postgres(url.href, { max: 1, prepare: false, onnotice: () => {} });
  const schema = await import("../src/db/schema");
  const db = drizzle({ client, schema });
  const { runWithBusabaseContext } = await import("../src/context");
  const { withAgentSessionDiagnosticContext } = await import(
    "../src/domains/agents/logic/agent-session-diagnostics"
  );
  const store = await import("../src/domains/agents/logic/agent-session-store");
  const sessionId = "ags_diagnostic_two_process";
  const connectionId = `acp_diagnostic_${role}`;
  let lease: Awaited<ReturnType<typeof store.acquireSessionLease>> = null;
  const records: DiagnosticRecord[] = [];
  const originals = { info: console.info, warn: console.warn, error: console.error };
  for (const level of ["info", "warn", "error"] as const) {
    console[level] = (...values: unknown[]) => {
      if (values[0] === "[agents:session]" && values[1] && typeof values[1] === "object") {
        records.push(values[1] as DiagnosticRecord);
        return;
      }
      originals[level](...values);
    };
  }
  const event = {
    sessionId,
    seq: 1,
    kind: "acpUpdate" as const,
    acpUpdate: { sessionUpdate: "user_message", text: prompt },
    at: "2026-11-03T00:00:00.000Z",
  };
  let tail = Promise.resolve();
  process.on("message", (message: { requestId: string; action: Action } | "shutdown") => {
    if (message === "shutdown") {
      void tail.finally(async () => {
        await client.end();
        process.disconnect?.();
      });
      return;
    }
    tail = tail
      .then(async () => {
        const { requestId, action } = message;
        const operationId = `diag_${role}_${action}`;
        const before = records.length;
        const value = await runWithBusabaseContext(
          { db, ...scope, isSpaceManager: true, embedOrigin: "https://fixture.invalid" },
          () =>
            withAgentSessionDiagnosticContext(
              {
                sessionId,
                acpSessionId: "remote_diagnostic_fixture",
                connectionId,
                operationId,
                attemptId: requestId,
              },
              async () => {
                if (action === "create") {
                  const at = new Date().toISOString();
                  await store.persistSessionCreated({
                    id: sessionId,
                    slug: "buda:diagnostic-fixture",
                    agentName: "Diagnostics fixture",
                    transport: "remote-websocket",
                    status: "idle",
                    error: null,
                    modelOption: null,
                    createdAt: at,
                    lastActivityAt: at,
                  });
                  return true;
                }
                if (action === "claim") {
                  lease = await store.acquireSessionLease(sessionId, "diagnostic_owner", 60);
                  return lease !== null;
                }
                if (action === "append_unfenced") return store.persistSessionEvents([event]);
                assert(lease, "Owner action requires a durable lease");
                if (action === "release") {
                  return store.releaseSessionLease(sessionId, lease.ownerId, lease.fencingToken);
                }
                return store.persistSessionEvents(
                  [event],
                  action === "append_stale"
                    ? { ownerId: "diagnostic_stale_owner", fencingToken: lease.fencingToken }
                    : lease,
                );
              },
            ),
        );
        process.send?.({
          kind: "result",
          requestId,
          role,
          action,
          pid: process.pid,
          operationId,
          value,
          records: records.slice(before),
        } satisfies Result);
      })
      .catch(() => {
        // Error messages can contain seeded SQL parameters. Fail without
        // transmitting raw exceptions through either output or IPC.
        process.send?.({ kind: "failed", role, stage: "worker_action" });
        process.exitCode = 1;
      });
  });
  process.send?.({ kind: "ready", role, pid: process.pid });
}

async function launch(role: WorkerRole, target: URL) {
  const workerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ACP_DIAGNOSTICS_POSTGRES_URL: target.href,
    PG_DATABASE_URL: target.href,
    PG_DATABASE_READ_URL: "",
  };
  delete workerEnv.ACP_DIAGNOSTICS_POSTGRES_ADMIN_URL;
  const child = fork(scriptPath, ["worker", role], {
    execPath: process.execPath,
    execArgv: process.execArgv,
    env: workerEnv,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const wait = <T>(predicate: (message: { kind?: string; requestId?: string }) => boolean) =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => done(new Error(`Diagnostics worker ${role} timed out`)),
        30_000,
      );
      const onMessage = (message: { kind?: string; requestId?: string }) => {
        if (message.kind === "failed") done(new Error(`Diagnostics worker ${role} failed`));
        else if (predicate(message)) done(undefined, message as T);
      };
      const onExit = () => done(new Error(`Diagnostics worker ${role} exited before its result`));
      const onError = () => done(new Error(`Diagnostics worker ${role} could not start`));
      function done(error?: Error, value?: T) {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", onError);
        if (error) reject(error);
        else resolve(value as T);
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  try {
    await wait((message) => message.kind === "ready");
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
  let ordinal = 0;
  return {
    child,
    output: () => output,
    action: async (action: Action) => {
      const requestId = `diag_${role}_${++ordinal}`;
      const result = wait<Result>(
        (message) => message.kind === "result" && message.requestId === requestId,
      );
      child.send({ requestId, action });
      return result;
    },
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    if (child.connected) child.send("shutdown");
    else child.kill("SIGTERM");
  });
}

async function main(): Promise<void> {
  const adminTarget = process.env.ACP_DIAGNOSTICS_POSTGRES_ADMIN_URL;
  assert(adminTarget, "Set ACP_DIAGNOSTICS_POSTGRES_ADMIN_URL explicitly to local /postgres");
  const adminUrl = localUrl(adminTarget, "admin");
  const databaseName = `formula_acceptance_acp_${Date.now()}_${randomBytes(4).toString("hex")}`;
  assert(fixtureDatabasePattern.test(databaseName));
  const target = new URL(adminUrl);
  target.pathname = `/${databaseName}`;
  const admin = postgres(adminUrl.href, { max: 1, prepare: false, onnotice: () => {} });
  let databaseCreated = false;
  let fixture: ReturnType<typeof postgres> | undefined;
  const workers: Array<Awaited<ReturnType<typeof launch>>> = [];
  try {
    await admin`create database ${admin(databaseName)}`;
    databaseCreated = true;
    fixture = postgres(target.href, { max: 1, prepare: false, onnotice: () => {} });
    await migrate(drizzle({ client: fixture }), { migrationsFolder });
    const retained = await launch("retained", target);
    workers.push(retained);
    const owner = await launch("owner", target);
    workers.push(owner);
    const results = [await retained.action("create"), await owner.action("claim")];
    assert(
      results.every((result) => result.value),
      "Fixture initialization must succeed",
    );
    const staleSocket = await retained.action("append_unfenced");
    const collision = await owner.action("append_owned");
    const rejected = await owner.action("append_stale");
    const duplicateRetry = await retained.action("append_unfenced");
    results.push(staleSocket, collision, rejected, duplicateRetry);
    assert.notEqual(staleSocket.pid, collision.pid, "The stores must run in separate OS processes");
    // Deliberate legacy characterization. The later journal/supervisor
    // acceptance harness must require the opposite ownership/idempotency result.
    assert.equal(staleSocket.value, true, "Legacy unfenced append must remain observable");
    assert.equal(collision.value, false, "Legacy sequence collision must be returned as false");
    assert.equal(duplicateRetry.value, false, "Legacy identical retry must still return false");
    assert.equal(rejected.value, false, "Stale-fence append must be rejected");

    for (const result of results) {
      assert(result.records.length > 0, "Each operation must produce a diagnostic record");
      for (const record of result.records) {
        assert.equal(record.sessionId, "ags_diagnostic_two_process");
        assert.equal(record.acpSessionId, "remote_diagnostic_fixture");
        assert.equal(record.connectionId, `acp_diagnostic_${result.role}`);
        assert.equal(record.operationId, result.operationId);
        assert.equal(record.attemptId, result.requestId);
        assert.equal(record.schemaVersion, 1);
      }
    }
    const failedInsert = collision.records.find((record) => record.stage === "event_commit");
    assert(failedInsert, "Collision must identify its event-commit stage");
    assert.equal(failedInsert.outcome, "storage_failure");
    assert.equal(failedInsert.sqlState, "23505");
    assert.equal(failedInsert.failureClass, "storage_failure");
    const ownership = rejected.records.find((record) => record.stage === "event_commit");
    assert(ownership, "Rejection must identify its event-commit stage");
    assert.equal(ownership.outcome, "ownership_rejected");
    assert.equal(ownership.reason, "predicate_not_matched");
    assert.equal(ownership.sqlState, undefined);
    assert.notEqual(staleSocket.records[0].workerId, collision.records[0].workerId);
    const stored = await fixture`select seq, payload from busabase_agent_session_events`;
    assert.equal(stored.length, 1, "Rejected writes must not insert a partial or duplicate batch");
    assert.equal(stored[0].seq, 1);
    assert.equal(stored[0].payload.acpUpdate.text, prompt, "Fixture must contain the secret input");
    const released = await owner.action("release");
    assert.equal(released.value, true);
    const evidence = JSON.stringify({
      results: [...results, released],
      output: workers.map((w) => w.output()),
    });
    for (const secret of secretSeeds) {
      assert(!evidence.includes(secret), "Diagnostics must not leak a seeded sensitive input");
    }
    console.log(
      JSON.stringify({
        verification: "real_postgresql_two_process_diagnostics",
        outcome: "passed",
        database: databaseName,
        workers: [staleSocket.pid, collision.pid],
        sqlState: failedInsert.sqlState,
        ownershipOutcome: ownership.outcome,
        legacyDefectsCharacterized: ["unfenced_writer_collision", "non_idempotent_retry"],
        records: results.flatMap((result) => result.records),
        scope: "storage diagnostics; synthetic connection context; no ACP/model execution",
      }),
    );
  } finally {
    await Promise.all(workers.map(({ child }) => stop(child)));
    await fixture?.end();
    if (databaseCreated) {
      // databaseName was generated in this process and cannot name an app DB.
      await admin`drop database ${admin(databaseName)} with (force)`;
      console.log(JSON.stringify({ cleanup: "dropped_task_fixture", database: databaseName }));
    }
    await admin.end();
  }
}

const role = process.argv[3];
let operation: Promise<void>;
if (process.argv[2] === "worker") {
  assert(role === "retained" || role === "owner", "Invalid fixture role");
  operation = worker(role);
} else {
  operation = main();
}
operation.catch((error: unknown) => {
  // Avoid raw DB exceptions, which can contain the seeded prompt or connection URL.
  console.error(
    JSON.stringify({ outcome: "failed", errorName: error instanceof Error ? error.name : "Error" }),
  );
  process.exitCode = 1;
});
