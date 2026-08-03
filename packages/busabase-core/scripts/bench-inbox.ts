/**
 * Inbox / review-page benchmark.
 *
 * Reproduces the reported symptom: switching between the review tabs
 * (待评审 / 已请求修改 / 已创建 / 已批准 / 已合并 / 已关闭) is slow on a space that
 * has accumulated thousands of change requests. The reported space:
 * merged 2719, in_review 448, created(mine) 123, approved 3, closed 125.
 *
 * Every tab switch re-runs BOTH `changeRequests.counts` (the badge row) and
 * `changeRequests.list` (the rows), so both are measured separately — a tab
 * switch costs their sum.
 *
 * Like bench-records.ts this drives the real oRPC router over a real database,
 * and supports both engines, because the local-first (PGLite) and hosted
 * (Postgres) deployments do not degrade the same way.
 *
 * Usage:
 *   pnpm --filter busabase-core bench:inbox
 *   BENCH_ENGINE=postgres pnpm --filter busabase-core bench:inbox
 *   BENCH_SCALE=0.25 pnpm --filter busabase-core bench:inbox   # quarter-size, faster iteration
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
const SCALE = Number(process.env.BENCH_SCALE ?? 1);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 3);
const PG_URL =
  process.env.BENCH_PG_URL ?? "postgres://bika:bikabika@localhost:5432/busabase_bench_inbox";
const REUSE_DIR = process.env.BENCH_DATA_DIR ?? "";
const SKIP_SEED = process.env.BENCH_SKIP_SEED === "1";

/** The reported production space, scaled by BENCH_SCALE. */
const scaled = (n: number) => Math.max(1, Math.round(n * SCALE));
const TARGET = {
  merged: scaled(2719),
  in_review: scaled(448),
  approved: scaled(3),
  closed: scaled(125),
  /** Of the above, how many are submitted by the acting user ("已创建" tab). */
  mine: scaled(123),
};

const heapMb = () => process.memoryUsage().heapUsed / 1024 / 1024;

interface Timing {
  scenario: string;
  coldMs: number;
  avgWarmMs: number;
  peakHeapMb: number;
  note: string;
}

async function measure<T>(fn: () => Promise<T>) {
  global.gc?.();
  let peak = heapMb();
  const sampler = setInterval(() => {
    const now = heapMb();
    if (now > peak) peak = now;
  }, 5);
  const t0 = performance.now();
  try {
    const out = await fn();
    return { ms: performance.now() - t0, peakMb: Math.max(peak, heapMb()), out };
  } finally {
    clearInterval(sampler);
  }
}

async function benchmark<T>(
  scenario: string,
  fn: () => Promise<T>,
  describe: (out: T) => string = () => "",
): Promise<Timing> {
  const cold = await measure(fn);
  let peakHeapMb = cold.peakMb;
  const warm: number[] = [];
  let last = cold.out;
  for (let i = 0; i < WARM_RUNS; i++) {
    const r = await measure(fn);
    warm.push(r.ms);
    peakHeapMb = Math.max(peakHeapMb, r.peakMb);
    last = r.out;
  }
  const avgWarmMs = warm.reduce((a, b) => a + b, 0) / (warm.length || 1);
  const t: Timing = {
    scenario,
    coldMs: Math.round(cold.ms),
    avgWarmMs: Math.round(avgWarmMs),
    peakHeapMb: Math.round(peakHeapMb),
    note: describe(last),
  };
  console.log(
    `  ${scenario.padEnd(44)} cold=${String(t.coldMs).padStart(7)}ms  warm=${String(t.avgWarmMs).padStart(7)}ms  heap=${String(t.peakHeapMb).padStart(4)}MB  ${t.note}`,
  );
  return t;
}

function resetPostgres() {
  const url = new URL(PG_URL);
  const dbName = url.pathname.replace(/^\//, "");
  const adminUrl = new URL(PG_URL);
  adminUrl.pathname = "/postgres";
  const psql = (sql: string) =>
    execFileSync("psql", [adminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  console.log(`Resetting Postgres database "${dbName}"...`);
  psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  psql(`CREATE DATABASE "${dbName}"`);
  execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: MIGRATIONS_CWD,
    env: { ...process.env, PG_DATABASE_URL: PG_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function main() {
  const originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-inbox-storage-"));
  let dataDir = "";
  let ephemeral = "";
  if (ENGINE === "pglite") {
    if (REUSE_DIR) dataDir = path.resolve(REUSE_DIR);
    else {
      dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-inbox-db-"));
      ephemeral = dataDir;
    }
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  } else {
    if (!SKIP_SEED) resetPostgres();
    process.env.PG_DATABASE_URL = PG_URL;
  }
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  const { busabaseRouter } = await import("../src/router");
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const client: Client = createRouterClient(busabaseRouter);
  const results: Timing[] = [];

  try {
    const total = TARGET.merged + TARGET.in_review + TARGET.approved + TARGET.closed;
    console.log(
      `\n=== Busabase inbox benchmark — engine=${ENGINE}, ~${total} change requests ` +
        `(merged=${TARGET.merged} in_review=${TARGET.in_review} approved=${TARGET.approved} closed=${TARGET.closed} mine=${TARGET.mine}) ===\n`,
    );

    const base = SKIP_SEED
      ? (await client.bases.list({} as never)).find((b) => b.slug === "inbox-bench")
      : await client.bases.create({
          slug: "inbox-bench",
          name: "Inbox Bench",
          fields: [
            { slug: "name", name: "Name", type: "text", required: true, options: {} },
            { slug: "note", name: "Note", type: "longtext", options: {} },
          ],
          autoMerge: true,
        });
    if (!base) throw new Error("inbox-bench base not found — seed it first");

    if (!SKIP_SEED) {
      console.log("[seed] building change requests (this is the slow part)...");
      const t0 = performance.now();
      let done = 0;
      const tick = () => {
        done++;
        if (done % 100 === 0) process.stdout.write(`\r  ${done}/${total}   `);
      };

      // Merged CRs carry a real mergeSummary (recordIds array) — the jsonb column
      // that a `SELECT *` counting loop has to read and throw away.
      for (let i = 0; i < TARGET.merged; i++) {
        const cr = await client.bases.createChangeRequest({
          baseId: base.id,
          fields: { name: `Merged ${i}`, note: `merged body ${i}` },
          submittedBy: i < TARGET.mine ? "local-editor" : "local-producer",
          autoMerge: false,
        });
        await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
        await client.changeRequests.merge({ changeRequestIds: [cr.id] });
        tick();
      }
      // Left in_review — the default "待评审" tab.
      for (let i = 0; i < TARGET.in_review; i++) {
        await client.bases.createChangeRequest({
          baseId: base.id,
          fields: { name: `Pending ${i}`, note: `pending body ${i}` },
          submittedBy: "local-producer",
          autoMerge: false,
        });
        tick();
      }
      // Approved but not merged.
      for (let i = 0; i < TARGET.approved; i++) {
        const cr = await client.bases.createChangeRequest({
          baseId: base.id,
          fields: { name: `Approved ${i}`, note: `approved body ${i}` },
          submittedBy: "local-producer",
          autoMerge: false,
        });
        await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
        tick();
      }
      // Closed.
      for (let i = 0; i < TARGET.closed; i++) {
        const cr = await client.bases.createChangeRequest({
          baseId: base.id,
          fields: { name: `Closed ${i}`, note: `closed body ${i}` },
          submittedBy: "local-producer",
          autoMerge: false,
        });
        await client.changeRequests.close({ changeRequestId: cr.id } as never);
        tick();
      }
      console.log(`\n[seed] done in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
    }

    console.log("[read] one tab switch = counts + list");
    results.push(
      await benchmark(
        "changeRequests.counts (每次切 tab 都重跑)",
        () => client.changeRequests.counts({} as never),
        (out) => JSON.stringify(out),
      ),
    );

    const TABS: { label: string; status?: string[]; mine?: boolean }[] = [
      { label: "待评审", status: ["in_review"] },
      { label: "已请求修改", status: ["changes_requested"] },
      { label: "已创建 (mine)", mine: true },
      { label: "已批准", status: ["approved"] },
      { label: "已合并", status: ["merged"] },
      { label: "已关闭", status: ["rejected", "abandoned"] },
    ];
    for (const tab of TABS) {
      results.push(
        await benchmark(
          `changeRequests.list — ${tab.label}`,
          () =>
            client.changeRequests.list({
              limit: 20,
              ...(tab.status ? { status: tab.status } : {}),
              ...(tab.mine ? { mine: true } : {}),
            } as never),
          (out) => `rows=${(out as { changeRequests: unknown[] }).changeRequests.length}`,
        ),
      );
    }

    console.log(`\n=== SUMMARY (engine=${ENGINE}, ~${total} change requests) ===`);
    console.table(
      results.map((r) => ({
        scenario: r.scenario,
        "cold ms": r.coldMs,
        "avg warm ms": r.avgWarmMs,
        "peak heap MB": r.peakHeapMb,
        result: r.note.slice(0, 60),
      })),
    );
    const counts = results[0];
    const worstList = results.slice(1).reduce((a, b) => (a.avgWarmMs > b.avgWarmMs ? a : b));
    console.log(
      `\n一次切 tab ≈ counts(${counts.avgWarmMs}ms) + list(最慢 ${worstList.avgWarmMs}ms) = ${counts.avgWarmMs + worstList.avgWarmMs}ms`,
    );
  } finally {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(storageDir, { recursive: true, force: true });
    if (ephemeral) await rm(ephemeral, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
