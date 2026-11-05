/**
 * Opt-in PostgreSQL benchmark. Requires an already migrated, isolated database:
 * NODE_OPTIONS=--conditions=react-server BENCH_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/busabase_formula_acceptance_20261030 pnpm --filter busabase-core exec tsx scripts/bench-formula-delete.ts
 *
 * Never reads an app .env, migrates, drops, or clears a database. Every run owns
 * unique fixture IDs in org_formula_delete_bench and keeps its fixtures/results.
 * SQL bulk seeding clones a real router-created record and its projections.
 * Times have no CI threshold: deletion's projection UPDATE can remain O(n).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { BaseFieldVO } from "busabase-contract/types";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const databaseName = "busabase_formula_acceptance_20261030";
const databaseUrl = process.env.BENCH_DATABASE_URL;
assert(databaseUrl, "Set BENCH_DATABASE_URL explicitly; no app database fallback is allowed");
const target = new URL(databaseUrl);
assert(
  ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    target.pathname === `/${databaseName}` &&
    !target.search &&
    !target.hash,
  `Only an explicit loopback PostgreSQL URL for ${databaseName}, without query overrides, is allowed`,
);
process.env.PG_DATABASE_URL = databaseUrl;

const spaceId = "org_formula_delete_bench";
const actorId = "usr_formula_delete_bench";
const runId = randomUUID().replaceAll("-", "");
const sizes = [0, 10_000, 100_000];
const samples = 21;
const catalogBaseCount = 24;
const outputDir = await mkdtemp(path.join(os.tmpdir(), "busabase-formula-delete-bench-"));
const pg = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  connection: { statement_timeout: 120_000, application_name: "formula-delete-benchmark" },
});
type ObservedQuery = { sql: string; params: unknown[] };
let observed: ObservedQuery[] | null = null;
const fixtures: Array<{ baseId: string; nodeId: string; slug: string; spaceId: string }> = [];
const report: Record<string, unknown> = {
  runId,
  spaceId,
  actorId,
  sizes,
  samples,
  database: { host: target.hostname, name: databaseName },
  startedAt: new Date().toISOString(),
  notes: [
    "Metadata checks use actual assertFieldDeletable SQL, without record hydration/count.",
    "p50/p95 describe repeated metadata checks; each dataset has one real autoMerge deletion (no misleading merge percentiles).",
    "Projection soft deletion is a set-based UPDATE and can be O(n); fixed SQL trips do not imply constant wall time.",
    "Bulk fixtures clone one valid record_create commit, record and projection via SQL; they do not simulate 100k separate reviews or notifications.",
    "Fixtures and historical payloads are retained for inspection. No automatic cleanup or app database writes.",
    "Repeated runs retain earlier catalogs; each profile records actual active tenant catalog counts.",
  ],
};

const save = async () => {
  await writeFile(path.join(outputDir, "results.json"), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(outputDir, "fixtures.json"),
    JSON.stringify({ runId, spaceId, fixtures }, null, 2),
  );
};
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? 0;

async function main() {
  const [{ runWithBusabaseContext }, schema, { busabaseRouter }, { assertFieldDeletable }] =
    await Promise.all([
      import("../src/context"),
      import("../src/db/schema"),
      import("../src/router"),
      import("../src/domains/base/logic/field-deletion"),
    ]);
  const [{ current_database: actualDatabase }] = await pg`select current_database()`;
  assert.equal(
    actualDatabase,
    databaseName,
    "Connected database must match the explicit whitelist",
  );
  const [{ locked }] =
    await pg`select pg_try_advisory_lock(hashtext('busabase_formula_delete_benchmark')) as locked`;
  assert(locked, "Another formula deletion benchmark is running; do not overlap measurements");
  const db = drizzle({
    client: pg,
    schema,
    logger: {
      logQuery(query, params) {
        observed?.push({ sql: query, params: [...params] });
      },
    },
  });
  const context = {
    db,
    actorId,
    spaceId,
    isSpaceManager: true,
    permissionLevel: "manage" as const,
  };
  const scoped = <T>(run: () => Promise<T>) => runWithBusabaseContext(context, run);
  const client = createRouterClient(busabaseRouter);
  const createBase = async (
    label: string,
    benchmarkSpace = spaceId,
    catalog = false,
    sourceBaseId?: string,
  ) => {
    const base = await runWithBusabaseContext({ ...context, spaceId: benchmarkSpace }, () =>
      client.bases.create({
        name: `Formula deletion benchmark ${label}`,
        slug: `fdbench-${label}-${runId}`,
        autoMerge: true,
        fields: [
          { slug: "title", name: "Title", type: "text" },
          { slug: "quantity", name: "Quantity", type: "number" },
          {
            slug: "total",
            name: "Total",
            type: "formula",
            options: { formula: { expression: "{quantity} * 10" } },
          },
          ...(catalog
            ? Array.from({ length: 16 }, (_, index) => ({
                slug: `formula_${index}`,
                name: `Unrelated formula ${index}`,
                type: "formula" as const,
                options: { formula: { expression: `{quantity} + ${index}` } },
              }))
            : []),
          ...(sourceBaseId
            ? [
                {
                  slug: "source",
                  name: "Unrelated source",
                  type: "relation" as const,
                  options: { targetBaseId: sourceBaseId },
                },
                {
                  slug: "source_quantity",
                  name: "Unrelated lookup",
                  type: "lookup" as const,
                  options: {
                    lookup: {
                      relationFieldSlug: "source",
                      targetFieldSlug: "quantity",
                      rollup: "values" as const,
                    },
                  },
                },
              ]
            : []),
        ],
      }),
    );
    assert("fields" in base, "Expected a materialized Base from the real autoMerge router");
    fixtures.push({
      baseId: base.id,
      nodeId: base.nodeId,
      slug: base.slug,
      spaceId: benchmarkSpace,
    });
    await save();
    return base;
  };
  const datasets: Array<{
    base: Awaited<ReturnType<typeof createBase>>;
    formula: BaseFieldVO;
    records: number;
    seedMs: number;
  }> = [];
  console.log(`Results and retained-fixture manifest: ${outputDir}`);
  for (const records of sizes) {
    const started = performance.now();
    const base = await createBase(`records-${records}`);
    const formula = base.fields.find((field) => field.slug === "total");
    assert(formula);
    if (records > 0) {
      const seed = await scoped(() =>
        client.bases.createChangeRequest({
          baseId: base.id,
          fields: { title: "Synthetic benchmark record", quantity: 2 },
          autoMerge: true,
        }),
      );
      assert(seed.materialized);
      const [{ count }] = await pg`
        select count(*)::int as count from busabase_field_values
        where record_id = ${seed.id} and field_id = ${formula.id}
          and change_request_id is null and deleted_at is null and value_number = 20`;
      assert.equal(count, 1, "Real router seed must have a valid formula projection");
      const prefix = `fdbench_${runId}_${records}_`;
      // Three set-based statements per batch. No per-row hydration or application loop.
      for (let offset = 1; offset < records; offset += 5_000) {
        const last = Math.min(records - 1, offset + 4_999);
        await pg.begin(async (tx) => {
          // postgres' TransactionSql Omit type loses Sql's tagged-call signature.
          const batch = tx as unknown as postgres.Sql;
          await batch`
            insert into busabase_commits
              (id, space_id, base_id, target_type, node_id, operation_id, parent_commit_id, payload, operation, message, author, created_at)
            select ${prefix} || 'commit_' || n, c.space_id, c.base_id, c.target_type, c.node_id,
              null, null, c.payload, c.operation, 'Synthetic benchmark clone', c.author, c.created_at
            from busabase_commits c cross join generate_series(${offset}::int, ${last}::int) n
            where c.id = ${seed.headCommit.id}`;
          await batch`
            insert into busabase_records
              (id, space_id, base_id, head_commit_id, parent_record_id, parent_commit_id, status, created_by, archived_at, created_at, updated_at)
            select ${prefix} || 'record_' || n, r.space_id, r.base_id, ${prefix} || 'commit_' || n,
              null, null, r.status, r.created_by, r.archived_at, r.created_at, r.updated_at
            from busabase_records r cross join generate_series(${offset}::int, ${last}::int) n
            where r.id = ${seed.id}`;
          await batch`
            insert into busabase_field_values
              (id, space_id, base_id, record_id, change_request_id, operation_id, commit_id,
               field_id, field_slug, field_type, value_text, value_number, value_bool, value_date,
               value_json, value_hash, deleted_at, created_at, updated_at)
            select ${prefix} || fv.field_slug || '_' || n, fv.space_id, fv.base_id,
              ${prefix} || 'record_' || n, null, null, ${prefix} || 'commit_' || n,
              fv.field_id, fv.field_slug, fv.field_type, fv.value_text, fv.value_number, fv.value_bool,
              fv.value_date, fv.value_json, fv.value_hash, fv.deleted_at, fv.created_at, fv.updated_at
            from busabase_field_values fv cross join generate_series(${offset}::int, ${last}::int) n
            where fv.record_id = ${seed.id} and fv.change_request_id is null`;
        });
      }
    }
    const [{ count }] =
      await pg`select count(*)::int as count from busabase_records where base_id = ${base.id} and space_id = ${spaceId}`;
    assert.equal(count, records);
    datasets.push({ base, formula, records, seedMs: performance.now() - started });
    console.log(`Seeded ${records} records in ${(performance.now() - started).toFixed(1)}ms`);
  }
  await pg`analyze busabase_base_fields`;
  await pg`analyze busabase_bases`;
  await pg`analyze busabase_field_values`;
  const metadata: unknown[] = [];
  report.metadata = metadata;
  const measureMetadata = async (catalog: string) => {
    const [catalogSize] = await pg`
      select (select count(*)::int from busabase_bases where space_id = ${spaceId}
        and archived_at is null and deleted_at is null) as active_bases,
        count(*)::int as active_fields, count(*) filter (where type = 'formula')::int as active_formula_fields
      from busabase_base_fields where space_id = ${spaceId} and deleted_at is null`;
    for (const dataset of datasets) {
      const times: number[] = [];
      let example: ObservedQuery[] = [];
      // One warmup, then 21 measured round-trips through the actual guard.
      await scoped(() => assertFieldDeletable(db, { ...dataset.formula, baseId: dataset.base.id }));
      for (let sample = 0; sample < samples; sample++) {
        const queries: ObservedQuery[] = [];
        observed = queries;
        const started = performance.now();
        try {
          await scoped(() =>
            assertFieldDeletable(db, { ...dataset.formula, baseId: dataset.base.id }),
          );
        } finally {
          observed = null;
        }
        times.push(performance.now() - started);
        assert.equal(
          queries.length,
          2,
          "Formula deletability must use exactly two metadata SQL statements",
        );
        assert(
          queries.every(
            ({ sql }) =>
              !/busabase_records|busabase_commits|busabase_field_values|\bcount\s*\(/i.test(sql),
          ),
          "Metadata guard must not read record data",
        );
        example = queries;
      }
      const row = {
        catalog,
        catalogSize,
        records: dataset.records,
        samples,
        p50Ms: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
        sqlTripsPerCheck: 2,
        timesMs: times,
      };
      metadata.push(row);
      console.log(JSON.stringify(row));
      for (const [index, query] of example.entries()) {
        const plan = await pg.unsafe(
          `explain (analyze, buffers, format json) ${query.sql}`,
          query.params as never[],
        );
        await writeFile(
          path.join(outputDir, `explain-${catalog}-${dataset.records}-${index + 1}.json`),
          JSON.stringify({ query, plan }, null, 2),
        );
      }
    }
    await save();
  };
  await measureMetadata("before-catalog");
  for (let index = 0; index < catalogBaseCount; index++)
    await createBase(`catalog-${index}`, spaceId, true, datasets[0]?.base.id);
  // Construct adversarial metadata only in our own foreign-tenant fixture:
  // even a relation pointing across tenants must not leak/block this tenant.
  const foreignSpace = `${spaceId}_foreign_${runId}`;
  const foreignTarget = await createBase("foreign-target", foreignSpace);
  const foreign = await createBase("foreign", foreignSpace, false, foreignTarget.id);
  await pg`update busabase_base_fields set options = jsonb_set(options, '{targetBaseId}', to_jsonb(${datasets[0]?.base.id}::text)) where base_id = ${foreign.id} and slug = 'source' and space_id = ${foreignSpace}`;
  await pg`update busabase_base_fields set options = jsonb_set(options, '{lookup,targetFieldSlug}', '"total"'::jsonb) where base_id = ${foreign.id} and slug = 'source_quantity' and space_id = ${foreignSpace}`;
  await pg`analyze busabase_base_fields`;
  await pg`analyze busabase_bases`;
  report.catalog = {
    newOwnBases: catalogBaseCount + datasets.length,
    newForeignBases: 2,
    foreignLookupTargetsOwnFormula: true,
    additionalFormulaFieldsPerBase: 16,
  };
  await measureMetadata("after-catalog");

  const fingerprint = async (baseId: string) => {
    const [records] = await pg`
      select count(*)::int as records, coalesce(sum((c.payload->>'quantity')::numeric), 0)::text as quantity_sum,
        coalesce(sum((c.payload->>'total')::numeric), 0)::text as formula_sum,
        coalesce(sum(hashtextextended(r.id || r.head_commit_id || c.payload::text, 0)::numeric), 0)::text as payload_hash
      from busabase_records r join busabase_commits c on c.id = r.head_commit_id
      where r.base_id = ${baseId} and r.space_id = ${spaceId}`;
    const [commits] =
      await pg`select count(*)::int as count from busabase_commits where base_id = ${baseId} and space_id = ${spaceId} and operation in ('record_create','record_update')`;
    const [inputs] = await pg`
      select count(*)::int as count, coalesce(sum(hashtextextended(id || coalesce(value_json::text,'') || coalesce(value_number::text,'') || coalesce(value_text,''),0)::numeric),0)::text as hash
      from busabase_field_values where base_id = ${baseId} and space_id = ${spaceId} and field_slug <> 'total' and deleted_at is null`;
    return { records, commits, inputs };
  };
  const deletions: unknown[] = [];
  report.deletions = deletions;
  for (const dataset of datasets) {
    const before = await fingerprint(dataset.base.id);
    assert.equal(before.records.records, dataset.records);
    assert.equal(before.records.quantity_sum, String(dataset.records * 2));
    const queries: ObservedQuery[] = [];
    observed = queries;
    const started = performance.now();
    let deletion: Awaited<ReturnType<typeof client.bases.fieldChangeRequest>>;
    try {
      deletion = await scoped(() =>
        client.bases.fieldChangeRequest({
          operation: "delete",
          baseId: dataset.base.id,
          fieldId: dataset.formula.id,
          autoMerge: true,
        }),
      );
    } finally {
      observed = null;
    }
    const elapsedMs = performance.now() - started;
    assert.equal(deletion.status, "merged", "Must measure a completed real merge");
    assert(
      !queries.some(({ sql }) =>
        /^\s*select\b[\s\S]*\b(?:from|join)\s+"?busabase_records"?\b/i.test(sql),
      ),
      "Deletion must not hydrate records for backfill",
    );
    assert(
      !queries.some(({ sql }) => /^\s*(?:update|insert into)\s+"?busabase_records"?\b/i.test(sql)),
      "Formula deletion must not rewrite records",
    );
    assert.deepEqual(
      await fingerprint(dataset.base.id),
      before,
      "Inputs, record heads, historical formula payloads, and record commit count must remain unchanged",
    );
    const [{ total, active }] = await pg`
      select count(*)::int as total, count(*) filter (where deleted_at is null)::int as active
      from busabase_field_values where base_id = ${dataset.base.id} and field_id = ${dataset.formula.id} and change_request_id is null`;
    assert.equal(total, dataset.records);
    assert.equal(active, 0);
    const row = {
      records: dataset.records,
      seedMs: dataset.seedMs,
      elapsedMs,
      sqlTrips: queries.length,
      changeRequestId: deletion.id,
      fingerprint: before,
      projectionRowsSoftDeleted: total,
    };
    deletions.push(row);
    await writeFile(
      path.join(outputDir, `delete-${dataset.records}-sql.json`),
      JSON.stringify(queries, null, 2),
    );
    console.log(JSON.stringify(row));
    await save();
  }
  // Restore through the ordinary router on a small fixture, avoiding a 100k
  // restoration backfill that would measure a different feature and dominate runtime.
  const restoreBase = await createBase("restore");
  const record = await scoped(() =>
    client.bases.createChangeRequest({
      baseId: restoreBase.id,
      fields: { title: "Restore sample", quantity: 2 },
      autoMerge: true,
    }),
  );
  const restoreField = restoreBase.fields.find((field) => field.slug === "total");
  assert(restoreField);
  await scoped(() =>
    client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: restoreBase.id,
      fieldId: restoreField.id,
      autoMerge: true,
    }),
  );
  const restored = await scoped(() =>
    client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: restoreBase.id,
      fieldId: restoreField.id,
      autoMerge: true,
    }),
  );
  assert.equal(restored.status, "merged");
  const afterRestore = await scoped(() => client.records.get({ recordId: record.id }));
  assert.equal(afterRestore.headCommit.payload.total, 20);
  report.restore = {
    fieldId: restoreField.id,
    recordId: record.id,
    status: restored.status,
    formulaValue: afterRestore.headCommit.payload.total,
  };
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(`Completed. Retained fixtures and results: ${outputDir}`);
}

try {
  await main();
} catch (error) {
  report.failure =
    error instanceof Error ? { name: error.name, message: error.message } : String(error);
  await save();
  console.error(`Benchmark failed; retained results/fixtures: ${outputDir}`);
  throw error;
} finally {
  await pg.end({ timeout: 5 });
}
