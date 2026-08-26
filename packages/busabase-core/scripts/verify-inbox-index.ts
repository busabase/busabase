/**
 * Read-only production acceptance probe for the Inbox index/query plans.
 *
 * Required:
 *   INBOX_EXPLAIN_PG_URL=postgres://... INBOX_EXPLAIN_SPACE_ID=org_... \
 *     pnpm --filter busabase-core verify:inbox-index
 * Optional:
 *   INBOX_EXPLAIN_ACTOR_ID=user_... INBOX_EXPLAIN_REQUIRE_INDEX=1
 *
 * It prints EXPLAIN (ANALYZE, BUFFERS) for the three manager SQL shapes and
 * never prints row payloads or the supplied tenant/actor ids.
 */
import postgres from "postgres";

const pgUrl = process.env.INBOX_EXPLAIN_PG_URL;
const spaceId = process.env.INBOX_EXPLAIN_SPACE_ID;
const actorId = process.env.INBOX_EXPLAIN_ACTOR_ID ?? "index-probe-no-match";
const requireIndex = process.env.INBOX_EXPLAIN_REQUIRE_INDEX === "1";
const maxMs = process.env.INBOX_EXPLAIN_MAX_MS ? Number(process.env.INBOX_EXPLAIN_MAX_MS) : null;
const INDEX = "busabase_change_requests_space_created_id_idx";

if (!pgUrl || !spaceId) {
  throw new Error("Set INBOX_EXPLAIN_PG_URL and INBOX_EXPLAIN_SPACE_ID");
}

const client = postgres(pgUrl, { max: 1, prepare: false });

interface ExplainRoot {
  Plan: Record<string, unknown>;
  "Planning Time": number;
  "Execution Time": number;
}

const readPlan = (label: string, rows: Array<{ "QUERY PLAN": unknown }>) => {
  const value = rows[0]?.["QUERY PLAN"];
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as ExplainRoot[];
  const root = parsed[0];
  if (!root) throw new Error(`No EXPLAIN output for ${label}`);
  const rawText = JSON.stringify(root);
  const displayText = [spaceId, actorId].reduce(
    (text, secret) => text.split(secret).join("[redacted]"),
    JSON.stringify(root, null, 2),
  );
  console.log(`\n--- ${label} ---\n${displayText}`);
  return {
    text: rawText,
    executionMs: root["Execution Time"],
  };
};

try {
  await client.begin(async (sql) => {
    await sql`set transaction read only`;
    await sql`set local statement_timeout = '30s'`;
    const indexes = await sql<
      Array<{
        indexname: string;
        indisvalid: boolean;
        indisready: boolean;
        index_size: string;
      }>
    >`
      select
        index_class.relname as indexname,
        pg_index.indisvalid,
        pg_index.indisready,
        pg_size_pretty(pg_relation_size(pg_index.indexrelid)) as index_size
      from pg_index
      join pg_class table_class on table_class.oid = pg_index.indrelid
      join pg_class index_class on index_class.oid = pg_index.indexrelid
      join pg_namespace namespace on namespace.oid = table_class.relnamespace
      where namespace.nspname = current_schema()
        and table_class.relname = 'busabase_change_requests'
        and index_class.relname = ${INDEX}
    `;
    if (indexes.length !== 1) throw new Error(`Required index ${INDEX} is missing`);
    const index = indexes[0];
    if (!index?.indisvalid || !index.indisready) {
      throw new Error(`Index ${INDEX} exists but is not valid and ready`);
    }
    const [relation] = await sql<
      Array<{
        table_size: string;
        total_size: string;
        estimated_rows: number;
        inserts: number;
        updates: number;
        deletes: number;
        last_analyze: Date | null;
        last_autoanalyze: Date | null;
      }>
    >`
      select
        pg_size_pretty(pg_relation_size('busabase_change_requests')) as table_size,
        pg_size_pretty(pg_total_relation_size('busabase_change_requests')) as total_size,
        table_class.reltuples::bigint as estimated_rows,
        coalesce(stats.n_tup_ins, 0)::bigint as inserts,
        coalesce(stats.n_tup_upd, 0)::bigint as updates,
        coalesce(stats.n_tup_del, 0)::bigint as deletes,
        stats.last_analyze,
        stats.last_autoanalyze
      from pg_class table_class
      left join pg_stat_user_tables stats on stats.relid = table_class.oid
      where table_class.oid = 'busabase_change_requests'::regclass
    `;
    console.table([{ index: INDEX, indexSize: index.index_size, ...relation }]);

    const firstPage = readPlan(
      "first page",
      await sql<Array<{ "QUERY PLAN": unknown }>>`
        explain (analyze, buffers, format json)
        select id, status, submitted_by
        from busabase_change_requests
        where space_id = ${spaceId}
        order by created_at desc, id desc
        limit 50
      `,
    );
    const statusPage = readPlan(
      "status-filtered page",
      await sql<Array<{ "QUERY PLAN": unknown }>>`
        explain (analyze, buffers, format json)
        select id, status, submitted_by
        from busabase_change_requests
        where space_id = ${spaceId} and status = 'in_review'
        order by created_at desc, id desc
        limit 50
      `,
    );
    const minePage = readPlan(
      "created-by-me page",
      await sql<Array<{ "QUERY PLAN": unknown }>>`
        explain (analyze, buffers, format json)
        select id, status, submitted_by
        from busabase_change_requests
        where space_id = ${spaceId} and submitted_by = ${actorId}
        order by created_at desc, id desc
        limit 50
      `,
    );

    const hit = firstPage.text.includes(INDEX);
    console.log(`\nfirst-page plan uses target index: ${hit ? "yes" : "no"}`);
    if (!hit) {
      const message =
        "Planner did not choose the target index. Tiny spaces may legitimately use a seq scan; inspect buffers/rows before accepting production.";
      if (requireIndex) throw new Error(message);
      console.warn(message);
    }
    const timings = [firstPage, statusPage, minePage].map((plan) => plan.executionMs);
    console.log(`execution times (ms): ${timings.join(", ")}`);
    if (maxMs !== null && timings.some((timing) => timing > maxMs)) {
      throw new Error(`At least one Inbox plan exceeded INBOX_EXPLAIN_MAX_MS=${maxMs}`);
    }
  });
} finally {
  await client.end();
}
