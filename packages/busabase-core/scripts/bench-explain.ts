/**
 * EXPLAIN ANALYZE probe for the record read paths, against a fixture already
 * seeded by `bench-records.ts` (`BENCH_DATA_DIR=... pnpm bench:records`).
 *
 * This exists because a slow benchmark row only tells you THAT a query is slow.
 * Whether the fix is an index, a query rewrite, or simply missing planner
 * statistics is a question only the plan can answer.
 *
 * Usage:
 *   BENCH_DATA_DIR=/tmp/bench-fixture-10k pnpm --filter busabase-core bench:explain
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const DATA_DIR = process.env.BENCH_DATA_DIR;
const PG_URL = process.env.BENCH_PG_URL;
const RUN_ANALYZE = process.env.BENCH_RUN_ANALYZE === "1";

if (!DATA_DIR && !PG_URL) {
  throw new Error("Set BENCH_DATA_DIR (PGLite fixture) or BENCH_PG_URL (Postgres)");
}

async function main() {
  process.chdir(MIGRATIONS_CWD);
  process.env.PG_DATABASE_URL = PG_URL ?? `pglite://${path.resolve(DATA_DIR as string)}`;
  const { getDb } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();

  // drizzle's `execute` returns a bare array on postgres-js but `{ rows }` on
  // PGLite — normalise so the same probe works against both engines.
  const rowsOf = (result: unknown): Array<Record<string, unknown>> =>
    Array.isArray(result)
      ? (result as Array<Record<string, unknown>>)
      : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  const [baseRow] = rowsOf(
    await db.execute(sql`select id from busabase_bases where slug = 'bench-contacts' limit 1`),
  );
  const baseId = (baseRow as { id: string } | undefined)?.id;
  if (!baseId) throw new Error("Fixture base 'bench-contacts' not found — seed it first");

  if (RUN_ANALYZE) {
    console.log("Running ANALYZE...");
    await db.execute(sql`analyze`);
  }

  const queries: { label: string; query: ReturnType<typeof sql> }[] = [
    {
      label: "keyset page 1, default (createdAt desc)",
      query: sql`
        select * from busabase_records
        where base_id = ${baseId} and status = 'active'
        order by created_at desc, id desc
        limit 51`,
    },
    {
      label: "keyset page 1, sorted by number field (LEFT JOIN field_values)",
      query: sql`
        select r.*, fv.value_number from busabase_records r
        left join busabase_field_values fv
          on fv.record_id = r.id and fv.field_slug = 'score' and fv.deleted_at is null
        where r.base_id = ${baseId} and r.status = 'active'
        order by fv.value_number asc nulls last, r.id asc
        limit 51`,
    },
    {
      label: "sorted page 1 — join correlated on r.base_id (column, not constant)",
      query: sql`
        select r.*, fv.value_number from busabase_records r
        left join busabase_field_values fv
          on fv.base_id = r.base_id and fv.record_id = r.id
             and fv.field_slug = 'score' and fv.deleted_at is null
        where r.base_id = ${baseId} and r.status = 'active'
        order by fv.value_number asc nulls last, r.id asc
        limit 51`,
    },
    {
      label: "sorted page 1 — join pinned to the literal base id",
      query: sql`
        select r.*, fv.value_number from busabase_records r
        left join busabase_field_values fv
          on fv.base_id = ${baseId} and fv.record_id = r.id
             and fv.field_slug = 'score' and fv.deleted_at is null
        where r.base_id = ${baseId} and r.status = 'active'
        order by fv.value_number asc nulls last, r.id asc
        limit 51`,
    },
    {
      label: "count(*) whole base",
      query: sql`select count(*)::int from busabase_records where base_id = ${baseId} and status = 'active'`,
    },
    {
      label: "full candidate scan (what a filtered saved view does)",
      query: sql`
        select * from busabase_records
        where base_id = ${baseId} and status = 'active'
        order by created_at desc, id desc`,
    },
  ];

  for (const { label, query } of queries) {
    console.log(`\n──── ${label} ────`);
    const plan = rowsOf(await db.execute(sql`explain (analyze, buffers) ${query}`));
    for (const row of plan) {
      console.log("  ", Object.values(row)[0]);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
