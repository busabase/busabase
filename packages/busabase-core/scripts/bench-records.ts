/**
 * Core record-data performance benchmark.
 *
 * Answers the question the grep benchmark does not: what happens to the
 * *record* data path — listing, counting, paging, saved views, lookup
 * hydration, and bulk merge — when a single local Base holds tens of
 * thousands of rows? Specifically, which of those paths degrades gracefully
 * and which one falls over (OOM / multi-second stalls) on a laptop.
 *
 * Like `bench-grep.ts` this drives the REAL oRPC router
 * (`createRouterClient(busabaseRouter)`) over a real database, so the numbers
 * include validation, hydration, VO mapping and the commit graph — not just a
 * hand-written SQL query.
 *
 * Both storage engines are measured with the same script, because the local-first
 * product ships PGLite while the hosted one runs Postgres, and they do NOT
 * degrade the same way:
 *
 *   BENCH_ENGINE=pglite    (default) embedded WASM Postgres, in a temp dir
 *   BENCH_ENGINE=postgres  a real server; the bench database is dropped and
 *                          re-migrated from scratch on every run
 *
 * Usage:
 *   pnpm --filter busabase-core bench:records
 *   BENCH_RECORD_COUNT=20000 pnpm --filter busabase-core bench:records
 *   BENCH_ENGINE=postgres pnpm --filter busabase-core bench:records
 *   BENCH_ENGINE=postgres BENCH_PG_URL=postgres://u:p@host:5432/db pnpm --filter busabase-core bench:records
 *
 * Run node with `--expose-gc` for stable peak-heap numbers (the `bench:records`
 * package script already does).
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
const RECORD_COUNT = Number(process.env.BENCH_RECORD_COUNT ?? 5000);
const BATCH_SIZE = Number(process.env.BENCH_BATCH_SIZE ?? 500);
const PAGE_SIZE = Number(process.env.BENCH_PAGE_SIZE ?? 50);
const WARM_RUNS = Number(process.env.BENCH_WARM_RUNS ?? 3);
const DEFAULT_PG_URL = "postgres://bika:bikabika@localhost:5432/busabase_bench";
const PG_URL = process.env.BENCH_PG_URL ?? DEFAULT_PG_URL;
/** Keep the database between runs so a seeded fixture can be re-measured. */
const REUSE_DIR = process.env.BENCH_DATA_DIR ?? "";
/** Skip the write phase and measure reads against an already-seeded fixture. */
const SKIP_SEED = process.env.BENCH_SKIP_SEED === "1";
/** Records in the second Base that the lookup Base links into. */
const LINK_TARGET_COUNT = Math.min(RECORD_COUNT, 500);
/** Bulk change requests are capped by the contract; see BULK_MAX below. */

if (ENGINE !== "pglite" && ENGINE !== "postgres") {
  throw new Error(`BENCH_ENGINE must be "pglite" or "postgres" (got ${ENGINE})`);
}
/** `createBulkChangeRequest` accepts at most 1000 records per change request. */
const BULK_MAX = 1000;
if (BATCH_SIZE > BULK_MAX) {
  throw new Error(`BENCH_BATCH_SIZE must be <= ${BULK_MAX} (got ${BATCH_SIZE})`);
}

// ── Measurement helpers ───────────────────────────────────────────────────

interface Timing {
  scenario: string;
  coldMs: number;
  avgWarmMs: number;
  maxWarmMs: number;
  peakHeapMb: number;
  note: string;
}

const heapMb = () => process.memoryUsage().heapUsed / 1024 / 1024;

/**
 * Peak heap across a call. `heapUsed` is only sampled at await boundaries by a
 * timer, so this is a floor on the true peak — good enough to tell "streams a
 * page" apart from "materialises the whole Base", which is the distinction the
 * OOM question actually turns on.
 */
async function measure<T>(fn: () => Promise<T>): Promise<{ ms: number; peakMb: number; out: T }> {
  global.gc?.();
  let peak = heapMb();
  const sampler = setInterval(() => {
    const now = heapMb();
    if (now > peak) peak = now;
  }, 5);
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = performance.now() - t0;
    const after = heapMb();
    if (after > peak) peak = after;
    return { ms, peakMb: peak, out };
  } finally {
    clearInterval(sampler);
  }
}

/** Cold run + WARM_RUNS warm runs of the same call, reported as one row. */
async function benchmark<T>(
  scenario: string,
  fn: () => Promise<T>,
  describe: (out: T) => string = () => "",
): Promise<Timing> {
  const cold = await measure(fn);
  let peakHeapMb = cold.peakMb;
  const warm: number[] = [];
  let last = cold.out;
  for (let run = 0; run < WARM_RUNS; run++) {
    const result = await measure(fn);
    warm.push(result.ms);
    if (result.peakMb > peakHeapMb) peakHeapMb = result.peakMb;
    last = result.out;
  }
  const avgWarmMs = warm.reduce((a, b) => a + b, 0) / (warm.length || 1);
  const timing: Timing = {
    scenario,
    coldMs: Math.round(cold.ms),
    avgWarmMs: Math.round(avgWarmMs),
    maxWarmMs: Math.round(Math.max(...warm, 0)),
    peakHeapMb: Math.round(peakHeapMb),
    note: describe(last),
  };
  console.log(
    `  ${scenario.padEnd(46)} cold=${String(timing.coldMs).padStart(6)}ms  warm=${String(timing.avgWarmMs).padStart(6)}ms  heap=${String(timing.peakHeapMb).padStart(4)}MB  ${timing.note}`,
  );
  return timing;
}

// ── Engine setup ──────────────────────────────────────────────────────────

/**
 * Recreate the bench database and run migrations. Dropping first is what makes
 * two runs comparable — a leftover 50k-row table would otherwise sit in every
 * space-wide query's way.
 */
function resetPostgres() {
  const url = new URL(PG_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error(`BENCH_PG_URL has no database name: ${PG_URL}`);
  const adminUrl = new URL(PG_URL);
  adminUrl.pathname = "/postgres";
  const psql = (sql: string) =>
    execFileSync("psql", [adminUrl.toString(), "-v", "ON_ERROR_STOP=1", "-c", sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  console.log(`Resetting Postgres database "${dbName}"...`);
  psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  psql(`CREATE DATABASE "${dbName}"`);
  console.log("Running migrations (drizzle-kit migrate)...");
  execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: MIGRATIONS_CWD,
    env: { ...process.env, PG_DATABASE_URL: PG_URL },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ── Seed data shape ───────────────────────────────────────────────────────

const STATUSES = ["draft", "review", "approved", "archived"];
// Long enough that the field-value text projection and the commit JSON are
// realistic rather than trivially small, without dominating the run.
const NOTES = "busabase benchmark note body ".repeat(8);

const buildRecord = (index: number) => ({
  name: `Contact ${index}`,
  score: index % 1000,
  status: STATUSES[index % STATUSES.length],
  notes: `${NOTES}#${index}`,
});

async function main() {
  const originalCwd = process.cwd();
  process.chdir(MIGRATIONS_CWD);
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-records-storage-"));
  let dataDir = "";
  let ephemeralDataDir = "";

  if (ENGINE === "pglite") {
    // A persistent BENCH_DATA_DIR lets a seeded fixture be reused across runs
    // (`BENCH_SKIP_SEED=1`), which is what makes an honest before/after A/B of a
    // read optimisation possible — otherwise every comparison also re-rolls the
    // data, and a 10k-record seed costs minutes.
    if (REUSE_DIR) {
      dataDir = path.resolve(REUSE_DIR);
    } else {
      dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bench-records-db-"));
      ephemeralDataDir = dataDir;
    }
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  } else {
    if (!SKIP_SEED) resetPostgres();
    process.env.PG_DATABASE_URL = PG_URL;
  }
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/bench/storage`;

  // Imported after the env vars are set — db/router read config lazily.
  const { busabaseRouter } = await import("../src/router");
  type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const client: Client = createRouterClient(busabaseRouter);

  const writeTimings: Timing[] = [];
  const readTimings: Timing[] = [];

  try {
    console.log(
      `\n=== Busabase record benchmark — engine=${ENGINE}, records=${RECORD_COUNT}, batch=${BATCH_SIZE}, pageSize=${PAGE_SIZE} ===\n`,
    );

    // ── Bases ────────────────────────────────────────────────────────────
    // Reuse by slug when re-measuring a persisted fixture, create otherwise.
    const ensureBase = async (
      slug: string,
      name: string,
      fields: Parameters<Client["bases"]["create"]>[0]["fields"],
    ) => {
      if (SKIP_SEED) {
        const existing = (await client.bases.list({} as never)).find((base) => base.slug === slug);
        if (existing) return existing;
      }
      return client.bases.create({ slug, name, fields, autoMerge: true });
    };

    const mainBase = await ensureBase("bench-contacts", "Bench Contacts", [
      { slug: "name", name: "Name", type: "text", required: true, options: {} },
      { slug: "score", name: "Score", type: "number", options: {} },
      { slug: "status", name: "Status", type: "text", options: {} },
      { slug: "notes", name: "Notes", type: "longtext", options: {} },
    ]);

    // ── WRITE: bulk change-request create → review → merge ────────────────
    console.log(SKIP_SEED ? "[write] skipped (BENCH_SKIP_SEED=1)" : "[write] bulk import");
    const batches = SKIP_SEED ? 0 : Math.ceil(RECORD_COUNT / BATCH_SIZE);
    let createMs = 0;
    let reviewMs = 0;
    let mergeMs = 0;
    let peakWriteHeap = 0;
    const writeT0 = performance.now();
    for (let batch = 0; batch < batches; batch++) {
      const from = batch * BATCH_SIZE;
      const size = Math.min(BATCH_SIZE, RECORD_COUNT - from);
      const records = Array.from({ length: size }, (_, i) => buildRecord(from + i));
      const created = await measure(() =>
        client.bases.createBulkChangeRequest({
          baseId: mainBase.id,
          records,
          message: `Bench import batch ${batch + 1}`,
        }),
      );
      createMs += created.ms;
      const reviewed = await measure(() =>
        client.changeRequests.review({
          changeRequestIds: [created.out.id],
          verdict: "approved",
        }),
      );
      reviewMs += reviewed.ms;
      const merged = await measure(() =>
        client.changeRequests.merge({ changeRequestIds: [created.out.id] }),
      );
      mergeMs += merged.ms;
      peakWriteHeap = Math.max(peakWriteHeap, created.peakMb, reviewed.peakMb, merged.peakMb);
      process.stdout.write(
        `\r  batch ${batch + 1}/${batches}  create=${Math.round(created.ms)}ms review=${Math.round(reviewed.ms)}ms merge=${Math.round(merged.ms)}ms   `,
      );
    }
    const writeTotalMs = performance.now() - writeT0;
    if (batches > 0) {
      console.log(
        `\n  total=${(writeTotalMs / 1000).toFixed(1)}s  ${Math.round(RECORD_COUNT / (writeTotalMs / 1000))} records/s  peakHeap=${Math.round(peakWriteHeap)}MB`,
      );
    }
    for (const [label, ms] of (batches === 0
      ? []
      : [
          ["createBulkChangeRequest", createMs],
          ["changeRequests.review", reviewMs],
          ["changeRequests.merge", mergeMs],
        ]) as ReadonlyArray<readonly [string, number]>) {
      writeTimings.push({
        scenario: `${label} (${batches} batches × ${BATCH_SIZE})`,
        coldMs: Math.round(ms),
        avgWarmMs: Math.round(ms / batches),
        maxWarmMs: 0,
        peakHeapMb: Math.round(peakWriteHeap),
        note: `${Math.round(RECORD_COUNT / (ms / 1000))} rec/s`,
      });
    }

    // ── Views ────────────────────────────────────────────────────────────
    // `plain` has no filters/sorts, so listPage can use SQL random access.
    // `filtered` and `sorted` force the exact-evaluation path.
    const existingViewSlugs = new Set(
      (await client.bases.listViews({ baseId: mainBase.id })).map((view) => view.slug),
    );
    const makeView = async (
      slug: string,
      name: string,
      config: { filters?: unknown[]; sorts?: unknown[] },
    ) => {
      if (existingViewSlugs.has(slug)) return;
      await client.views.changeRequest({
        operation: "create",
        baseId: mainBase.id,
        slug,
        name,
        config: { filters: [], sorts: [], ...config } as never,
        autoMerge: true,
      });
    };
    await makeView("bench-plain", "Plain", {});
    await makeView("bench-filtered", "Filtered", {
      filters: [{ fieldSlug: "status", operator: "equals", value: "approved" }],
    });
    await makeView("bench-sorted", "Sorted", {
      sorts: [{ fieldSlug: "score", direction: "asc" }],
    });
    const views = await client.bases.listViews({ baseId: mainBase.id });
    const viewIdBySlug = new Map(views.map((view) => [view.slug, view.id]));
    const plainViewId = viewIdBySlug.get("bench-plain");
    const filteredViewId = viewIdBySlug.get("bench-filtered");
    const sortedViewId = viewIdBySlug.get("bench-sorted");

    // ── READ ─────────────────────────────────────────────────────────────
    console.log("\n[read] record listing");
    readTimings.push(
      await benchmark(
        "records.count (whole base)",
        () => client.records.count({ baseId: mainBase.id }),
        (out) => `total=${out.total}`,
      ),
    );
    readTimings.push(
      await benchmark(
        "records.list keyset page 1",
        () => client.records.list({ baseId: mainBase.id, limit: PAGE_SIZE }),
        (out) => `rows=${out.records.length}`,
      ),
    );
    readTimings.push(
      await benchmark(
        "records.list keyset sorted by score, page 1",
        () =>
          client.records.list({
            baseId: mainBase.id,
            limit: PAGE_SIZE,
            sort: { fieldSlug: "score", fieldType: "number", direction: "asc" },
          } as never),
        (out) => `rows=${out.records.length}`,
      ),
    );

    // Walking every page is the honest "scroll to the bottom of a big Base"
    // cost, and the one place a per-page regression compounds.
    readTimings.push(
      await benchmark(
        `records.list walk ALL pages (${PAGE_SIZE}/page)`,
        async () => {
          let cursor: string | undefined;
          let pages = 0;
          let rows = 0;
          for (;;) {
            const page: { records: unknown[]; nextCursor: string | null } =
              await client.records.list({
                baseId: mainBase.id,
                limit: PAGE_SIZE,
                cursor,
              });
            pages++;
            rows += page.records.length;
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
          }
          return { pages, rows };
        },
        (out) => `pages=${out.pages} rows=${out.rows}`,
      ),
    );

    const lastPage = Math.max(1, Math.ceil(RECORD_COUNT / PAGE_SIZE));
    readTimings.push(
      await benchmark(
        "records.listPage page 1 (no view)",
        () => client.records.listPage({ baseId: mainBase.id, page: 1, pageSize: PAGE_SIZE }),
        (out) => `total=${out.total}`,
      ),
    );
    readTimings.push(
      await benchmark(
        `records.listPage page ${lastPage} (no view, deep OFFSET)`,
        () => client.records.listPage({ baseId: mainBase.id, page: lastPage, pageSize: PAGE_SIZE }),
        (out) => `rows=${out.records.length}`,
      ),
    );
    if (plainViewId) {
      readTimings.push(
        await benchmark(
          "records.listPage page 1 (plain view)",
          () =>
            client.records.listPage({
              baseId: mainBase.id,
              viewId: plainViewId,
              page: 1,
              pageSize: PAGE_SIZE,
            }),
          (out) => `total=${out.total}`,
        ),
      );
    }
    // The two rows below are the suspected cliff: a saved view carrying a filter
    // or a sort takes the exact-evaluation path, which hydrates the WHOLE Base
    // before slicing one page out of it.
    if (filteredViewId) {
      readTimings.push(
        await benchmark(
          "records.listPage page 1 (FILTERED view)",
          () =>
            client.records.listPage({
              baseId: mainBase.id,
              viewId: filteredViewId,
              page: 1,
              pageSize: PAGE_SIZE,
            }),
          (out) => `total=${out.total}`,
        ),
      );
    }
    if (sortedViewId) {
      readTimings.push(
        await benchmark(
          "records.listPage page 1 (SORTED view)",
          () =>
            client.records.listPage({
              baseId: mainBase.id,
              viewId: sortedViewId,
              page: 1,
              pageSize: PAGE_SIZE,
            }),
          (out) => `total=${out.total}`,
        ),
      );
    }

    // ── Lookup hydration ─────────────────────────────────────────────────
    // A lookup is resolved on READ (it derives from other records), so it is the
    // one field type whose cost lands on every record list — worth its own row.
    console.log("\n[read] lookup hydration");
    const targetBase = await ensureBase("bench-companies", "Bench Companies", [
      { slug: "name", name: "Name", type: "text", required: true, options: {} },
      { slug: "revenue", name: "Revenue", type: "number", options: {} },
    ]);
    /** Import one bulk change request end-to-end (create → approve → merge). */
    const importBulk = async (baseId: string, records: unknown[], message: string) => {
      const cr = await client.bases.createBulkChangeRequest({
        baseId,
        records: records as never,
        message,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    };
    if (!SKIP_SEED) {
      await importBulk(
        targetBase.id,
        Array.from({ length: LINK_TARGET_COUNT }, (_, i) => ({
          name: `Company ${i}`,
          revenue: i * 10,
        })),
        "Bench link targets",
      );
    }
    // `pageSize` is capped at 100 by the contract, so collect the link targets
    // by walking the keyset cursor rather than asking for one giant page.
    const targetIds: string[] = [];
    let targetCursor: string | undefined;
    for (;;) {
      const page = await client.records.list({
        baseId: targetBase.id,
        limit: 100,
        cursor: targetCursor,
      });
      targetIds.push(...page.records.map((record) => record.id));
      if (!page.nextCursor) break;
      targetCursor = page.nextCursor;
    }

    const linkedBase = await ensureBase("bench-deals", "Bench Deals", [
      { slug: "name", name: "Name", type: "text", required: true, options: {} },
      {
        slug: "company",
        name: "Company",
        type: "relation",
        options: { targetBaseId: targetBase.id, multiple: true },
      },
      {
        slug: "company_revenue",
        name: "Company Revenue",
        type: "lookup",
        options: {
          lookup: {
            relationFieldSlug: "company",
            targetFieldSlug: "revenue",
            rollup: "sum",
            limit: "first",
          },
        },
      },
    ]);
    const linkedCount = Math.min(RECORD_COUNT, BULK_MAX);
    if (!SKIP_SEED) {
      await importBulk(
        linkedBase.id,
        Array.from({ length: linkedCount }, (_, i) => ({
          name: `Deal ${i}`,
          company: [targetIds[i % targetIds.length]].filter(Boolean),
        })),
        "Bench linked records",
      );
    }

    readTimings.push(
      await benchmark(
        `records.list page 1 WITH lookup field (${linkedCount} rows)`,
        () => client.records.list({ baseId: linkedBase.id, limit: PAGE_SIZE }),
        (out) => `rows=${out.records.length}`,
      ),
    );
    readTimings.push(
      await benchmark(
        "records.listPage max page (100) WITH lookup",
        () =>
          client.records.listPage({
            baseId: linkedBase.id,
            page: 1,
            pageSize: 100,
          }),
        (out) => `rows=${out.records.length}`,
      ),
    );

    // ── Change-request / activity surfaces ───────────────────────────────
    console.log("\n[read] review surfaces");
    readTimings.push(
      await benchmark(
        "changeRequests.list page 1",
        () => client.changeRequests.list({ limit: PAGE_SIZE } as never),
        (out) => `rows=${(out as { changeRequests?: unknown[] }).changeRequests?.length ?? "?"}`,
      ),
    );
    readTimings.push(
      await benchmark("changeRequests.counts", () => client.changeRequests.counts({} as never)),
    );

    // ── Summary ──────────────────────────────────────────────────────────
    console.log(`\n=== SUMMARY (engine=${ENGINE}, ${RECORD_COUNT} records) ===`);
    console.log("\nWRITE");
    console.table(
      writeTimings.map((timing) => ({
        scenario: timing.scenario,
        "total ms": timing.coldMs,
        "per batch ms": timing.avgWarmMs,
        "peak heap MB": timing.peakHeapMb,
        throughput: timing.note,
      })),
    );
    console.log("READ");
    console.table(
      readTimings.map((timing) => ({
        scenario: timing.scenario,
        "cold ms": timing.coldMs,
        "avg warm ms": timing.avgWarmMs,
        "max warm ms": timing.maxWarmMs,
        "peak heap MB": timing.peakHeapMb,
        result: timing.note,
      })),
    );
  } finally {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(storageDir, { recursive: true, force: true });
    // A BENCH_DATA_DIR fixture is deliberately kept so the next run can reuse it.
    if (ephemeralDataDir) await rm(ephemeralDataDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
