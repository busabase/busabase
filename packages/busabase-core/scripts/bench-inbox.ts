/**
 * Real Inbox snapshot benchmark: router + database + ACL + hydration.
 *
 * Defaults are a laptop/CI smoke fixture. Set BENCH_SCALE=1 for the production
 * shape (3,295 CRs per fixture), and BENCH_DATA_DIR to reuse a PGLite fixture.
 *
 * Usage:
 *   pnpm --filter busabase-core bench:inbox
 *   BENCH_SCALE=1 BENCH_WARM_RUNS=5 pnpm --filter busabase-core bench:inbox
 *   BENCH_ENGINE=postgres BENCH_PG_URL=postgres://... pnpm --filter busabase-core bench:inbox
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const ENGINE = (process.env.BENCH_ENGINE ?? "pglite") as "pglite" | "postgres";
const SCALE = Number(process.env.BENCH_SCALE ?? 0.02);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 2);
const LARGE_PAYLOAD_BYTES = Number(process.env.BENCH_LARGE_PAYLOAD_BYTES ?? 400_000);
const PG_URL =
  process.env.BENCH_PG_URL ?? "postgres://bika:bikabika@localhost:5432/busabase_bench_inbox";
const REUSE_DIR = process.env.BENCH_DATA_DIR ?? "";
const SKIP_SEED = process.env.BENCH_SKIP_SEED === "1";

const scaled = (value: number) => Math.max(1, Math.round(value * SCALE));
const TARGET = {
  merged: scaled(2719),
  inReview: scaled(448),
  approved: scaled(3),
  closed: scaled(125),
  mine: scaled(123),
};

interface Fixture {
  name: "small" | "large";
  spaceId: string;
  body: string;
}

interface Timing {
  scenario: string;
  coldMs: number;
  avgWarmMs: number;
  peakHeapDeltaMb: number;
  responseBytes: number;
  rows: number;
}

const heapMb = () => process.memoryUsage().heapUsed / 1024 / 1024;

const measure = async <T>(fn: () => Promise<T>) => {
  global.gc?.();
  const baseline = heapMb();
  let peak = baseline;
  const sampler = setInterval(() => {
    peak = Math.max(peak, heapMb());
  }, 5);
  const startedAt = performance.now();
  try {
    const out = await fn();
    return {
      ms: performance.now() - startedAt,
      heapDeltaMb: Math.max(0, Math.max(peak, heapMb()) - baseline),
      responseBytes: Buffer.byteLength(JSON.stringify(out)),
      out,
    };
  } finally {
    clearInterval(sampler);
  }
};

const benchmark = async <T extends { changeRequests: unknown[] }>(
  scenario: string,
  fn: () => Promise<T>,
): Promise<Timing> => {
  const cold = await measure(fn);
  const warm = [];
  for (let index = 0; index < WARM_RUNS; index++) warm.push(await measure(fn));
  const samples = [cold, ...warm];
  const timing = {
    scenario,
    coldMs: Math.round(cold.ms),
    avgWarmMs: Math.round(
      warm.reduce((sum, sample) => sum + sample.ms, 0) / Math.max(1, warm.length),
    ),
    peakHeapDeltaMb: Number(Math.max(...samples.map((sample) => sample.heapDeltaMb)).toFixed(1)),
    responseBytes: samples.at(-1)?.responseBytes ?? 0,
    rows: samples.at(-1)?.out.changeRequests.length ?? 0,
  };
  console.log(
    `  ${scenario.padEnd(42)} cold=${String(timing.coldMs).padStart(6)}ms warm=${String(timing.avgWarmMs).padStart(6)}ms heap+=${String(timing.peakHeapDeltaMb).padStart(6)}MB bytes=${String(timing.responseBytes).padStart(9)} rows=${timing.rows}`,
  );
  return timing;
};

const resetPostgres = () => {
  const url = new URL(PG_URL);
  const dbName = url.pathname.replace(/^\//, "");
  const adminUrl = new URL(PG_URL);
  adminUrl.pathname = "/postgres";
  const psql = (statement: string) =>
    execFileSync("psql", [adminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-c", statement], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  psql(`CREATE DATABASE "${dbName}"`);
  execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: MIGRATIONS_CWD,
    env: { ...process.env, PG_DATABASE_URL: PG_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const main = async () => {
  const originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-inbox-storage-"));
  let ephemeral = "";
  if (ENGINE === "pglite") {
    const dataDir = REUSE_DIR
      ? path.resolve(REUSE_DIR)
      : await mkdtemp(path.join(os.tmpdir(), "busabase-bench-inbox-db-"));
    if (!REUSE_DIR) ephemeral = dataDir;
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  } else {
    if (!SKIP_SEED) resetPostgres();
    process.env.PG_DATABASE_URL = PG_URL;
  }
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  const [{ busabaseRouter }, { runWithBusabaseContext }] = await Promise.all([
    import("../src/router"),
    import("../src/context"),
  ]);
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const client: Client = createRouterClient(busabaseRouter);
  const fixtures: Fixture[] = [
    { name: "small", spaceId: "bench-inbox-small", body: "small payload" },
    { name: "large", spaceId: "bench-inbox-large", body: "x".repeat(LARGE_PAYLOAD_BYTES) },
  ];
  const runIn = <T>(fixture: Fixture, managerPath: boolean, fn: () => Promise<T>) =>
    runWithBusabaseContext(
      {
        spaceId: fixture.spaceId,
        actorId: "bench-reviewer",
        isSpaceManager: managerPath,
        permissionLevel: managerPath ? "manage" : "read",
      },
      fn,
    );

  const seed = (fixture: Fixture) =>
    runIn(fixture, true, async () => {
      const existing = (await client.bases.list({} as never)).find(
        (base) => base.slug === `inbox-bench-${fixture.name}`,
      );
      if (SKIP_SEED && existing) return;
      const base = await client.bases.create({
        slug: `inbox-bench-${fixture.name}`,
        name: `Inbox Bench ${fixture.name}`,
        fields: [
          { slug: "name", name: "Name", type: "text", required: true, options: {} },
          { slug: "note", name: "Note", type: "longtext", options: {} },
        ],
        autoMerge: true,
      });
      // The request context is authoritative for authorship; merely passing a
      // different `submittedBy` value is intentionally ignored by production
      // logic. Seed each proposal under its real actor so the `mine` benchmark
      // measures the intended minority slice instead of every fixture row.
      const propose = (label: string, submittedBy = "bench-producer") =>
        runWithBusabaseContext(
          {
            spaceId: fixture.spaceId,
            actorId: submittedBy,
            isSpaceManager: true,
            permissionLevel: "manage",
          },
          () =>
            client.bases.createChangeRequest({
              baseId: base.id,
              fields: { name: label, note: fixture.body },
              submittedBy,
              autoMerge: false,
            }),
        );
      for (let index = 0; index < TARGET.merged; index++) {
        const cr = await propose(
          `Merged ${index}`,
          index < TARGET.mine ? "bench-reviewer" : "bench-producer",
        );
        await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
        await client.changeRequests.merge({ changeRequestIds: [cr.id] });
      }
      for (let index = 0; index < TARGET.inReview; index++) await propose(`Pending ${index}`);
      for (let index = 0; index < TARGET.approved; index++) {
        const cr = await propose(`Approved ${index}`);
        await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      }
      for (let index = 0; index < TARGET.closed; index++) {
        const cr = await propose(`Closed ${index}`);
        await client.changeRequests.close({ changeRequestId: cr.id } as never);
      }
    });

  try {
    console.log(
      `\n=== Inbox snapshot benchmark engine=${ENGINE} scale=${SCALE} large=${LARGE_PAYLOAD_BYTES}B ===`,
    );
    if (!SKIP_SEED) {
      for (const fixture of fixtures) {
        console.log(`[seed] ${fixture.name}`);
        await seed(fixture);
      }
    }
    const results: Timing[] = [];
    for (const fixture of fixtures) {
      for (const managerPath of [true, false]) {
        const actor = managerPath ? "manager" : "member";
        for (const input of [
          { label: "review", status: ["in_review"] },
          { label: "created", mine: true },
          { label: "merged", status: ["merged"] },
        ]) {
          results.push(
            await benchmark(`${fixture.name}/${actor}/${input.label}`, () =>
              runIn(fixture, managerPath, () =>
                client.changeRequests.inboxSnapshot({ ...input, page: 1, pageSize: 50 } as never),
              ),
            ),
          );
        }
      }
    }
    console.table(results);
  } finally {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(storageDir, { recursive: true, force: true });
    if (ephemeral) await rm(ephemeral, { recursive: true, force: true });
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
