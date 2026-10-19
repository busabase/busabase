/**
 * Opt-in real PostgreSQL acceptance; the caller creates/migrates an isolated DB.
 * NODE_OPTIONS=--conditions=react-server FORMULA_TEST_POSTGRES_URL=postgres://.../formula_acceptance pnpm exec tsx scripts/verify-formula-postgres.ts
 * Set FORMULA_EXISTING_BASE_ID to repeat the benchmark without seeding another 10k.
 * Creates fixture Bases only. Keeps them for inspection; never drops a database.
 */
import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

const scriptPath = fileURLToPath(import.meta.url);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const target = process.env.FORMULA_TEST_POSTGRES_URL;
assert(target, "Set FORMULA_TEST_POSTGRES_URL explicitly");
const url = new URL(target);
assert(
  ["postgres:", "postgresql:"].includes(url.protocol) &&
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.pathname.startsWith("/formula_acceptance"),
  "Only isolated local formula_acceptance databases are allowed",
);
process.env.PG_DATABASE_URL = target;
process.chdir(path.resolve(path.dirname(scriptPath), "../../../apps/busabase"));

async function closeAppDb() {
  const state = (
    globalThis as typeof globalThis & {
      __busabaseCoreDbState?: { client?: { end?: () => Promise<void> } };
    }
  ).__busabaseCoreDbState;
  await state?.client?.end?.();
}

async function main() {
  const [{ busabaseRouter }, { getDb }, tables] = await Promise.all([
    import("../src/router"),
    import("../src/db"),
    import("../src/db/schema"),
  ]);
  const client = createRouterClient(busabaseRouter);
  if (process.argv[2] === "worker") {
    const proposalId = process.argv[3];
    assert(proposalId);
    process.send?.({ ready: true, pid: process.pid });
    await new Promise<void>((resolve) => process.once("message", () => resolve()));
    const attempts: Array<{ ok: boolean; code?: string }> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = (await client.changeRequests.merge({ changeRequestIds: [proposalId] }))
        .results[0];
      assert(result);
      attempts.push({ ok: result.ok, code: result.ok ? undefined : result.code });
      if (result.ok) break;
      assert.equal(result.code, "CONFLICT");
    }
    assert(attempts.at(-1)?.ok, "Conflict retry must merge successfully");
    process.send?.({ done: true, pid: process.pid, attempts });
    await closeAppDb();
    process.disconnect?.();
    return;
  }

  const monitor = postgres(url.href, { max: 2, prepare: false });
  const db = await getDb();
  const stamp = Date.now();
  const createBase = async (slug: string) => {
    const base = await client.bases.create({
      slug: `${slug}-${stamp}`,
      name: slug,
      autoMerge: true,
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "price", name: "Price", type: "number" },
        { slug: "qty", name: "Quantity", type: "number" },
      ],
    });
    assert("fields" in base);
    return base;
  };
  const formula = (baseId: string, slug: string, expression: string) =>
    client.bases.fieldChangeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      type: "formula",
      options: { formula: { expression } },
      autoMerge: true,
    });
  const workers: ChildProcess[] = [];
  try {
    const base = await createBase("pg-formula-cross-process");
    const record = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Concurrent", price: 10, qty: 2 },
      autoMerge: true,
    });
    assert(record.materialized);
    await formula(base.id, "total", "{price} * {qty}");
    const def = (await client.bases.get({ baseId: base.id }))?.fields.find(
      (f) => f.slug === "total",
    );
    assert(def);
    const schemaProposal = await client.bases.fieldChangeRequest({
      operation: "update",
      baseId: base.id,
      fieldId: def.id,
      patch: { options: { formula: { expression: "{price} * {qty} * 3" } } },
      autoMerge: false,
    });
    const sourceProposal = await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { price: 11 },
      autoMerge: false,
    });
    await client.changeRequests.review({
      changeRequestIds: [schemaProposal.id, sourceProposal.id],
      verdict: "approved",
    });
    const launch = async (id: string) => {
      const child = fork(scriptPath, ["worker", id], { execArgv: process.execArgv });
      workers.push(child);
      const done = new Promise<{ pid: number; attempts: Array<{ ok: boolean; code?: string }> }>(
        (resolve, reject) => {
          child.on("message", (message) => {
            if ((message as { done?: boolean }).done) resolve(message as never);
          });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code) reject(new Error(`Worker exited ${code}`));
          });
        },
      );
      await new Promise<void>((resolve, reject) => {
        child.on("message", (message) => {
          if ((message as { ready?: boolean }).ready) resolve();
        });
        child.on("error", reject);
      });
      return { child, done };
    };
    const formulaWorker = await launch(schemaProposal.id);
    const sourceWorker = await launch(sourceProposal.id);
    const waitForBlocked = async (count: number) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const waiting =
          await monitor`select pid, wait_event_type, wait_event, query from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%busabase_bases%'`;
        if (waiting.length >= count) return waiting;
        await pause(25);
      }
      throw new Error(`Expected ${count} independent PostgreSQL lock waiters`);
    };
    await monitor.begin(async (tx) => {
      await tx`select id from busabase_bases where id = ${base.id} for update`;
      formulaWorker.child.send("merge");
      await waitForBlocked(1);
      sourceWorker.child.send("merge");
      const blocked = await waitForBlocked(2);
      console.log(JSON.stringify({ crossProcessLockEvidence: blocked }));
    });
    const outcomes = await Promise.all([formulaWorker.done, sourceWorker.done]);
    assert.notEqual(outcomes[0].pid, outcomes[1].pid);
    assert(
      outcomes[1].attempts.some((attempt) => attempt.code === "CONFLICT"),
      "Stale record head must cause CONFLICT then retry",
    );
    const current = await client.records.get({ recordId: record.id });
    assert.deepEqual(
      { price: current.headCommit.payload.price, total: current.headCommit.payload.total },
      { price: 11, total: 66 },
    );
    const projections =
      await monitor`select value_number from busabase_field_values where record_id = ${record.id} and field_slug = 'total' and change_request_id is null`;
    assert.equal(projections.length, 1);
    assert.equal(Number(projections[0].value_number), 66);
    console.log(JSON.stringify({ crossProcessResults: outcomes, final: { price: 11, total: 66 } }));

    const existingBaseId = process.env.FORMULA_EXISTING_BASE_ID;
    const large = existingBaseId
      ? await client.bases.get({ baseId: existingBaseId })
      : await createBase("pg-formula-ten-thousand");
    assert(large);
    for (let offset = 0; !existingBaseId && offset < 10_000; offset += 1_000) {
      const seeded = await client.bases.createBulkChangeRequest({
        baseId: large.id,
        autoMerge: true,
        records: Array.from({ length: 1_000 }, (_, index) => ({
          title: `Row ${offset + index}`,
          price: offset + index,
          qty: 2,
        })),
      });
      assert.equal(seeded.status, "merged");
      console.log(`Seeded ${offset + 1_000}/10000 via real bulk merge`);
    }
    const before = await db
      .select()
      .from(tables.busabaseRecords)
      .where(eq(tables.busabaseRecords.baseId, large.id));
    const measurements: Array<{
      operation: string;
      records: number;
      elapsedMs: number;
      peakHeapMiB: number;
    }> = [];
    const measure = async (operation: string, run: () => Promise<unknown>) => {
      let peakHeap = process.memoryUsage().heapUsed;
      const sampler = setInterval(() => {
        peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      }, 10);
      const started = performance.now();
      try {
        await run();
      } finally {
        clearInterval(sampler);
      }
      const result = {
        operation,
        records: 10_000,
        elapsedMs: Math.round(performance.now() - started),
        peakHeapMiB: Math.round(peakHeap / 1024 / 1024),
      };
      measurements.push(result);
      console.log(JSON.stringify(result));
    };
    if (!existingBaseId) {
      await measure("create total", () => formula(large.id, "total", "{price} * {qty}"));
      await measure("create downstream grand", () => formula(large.id, "grand", "{total} + 1"));
    }
    const totalDef = (await client.bases.get({ baseId: large.id }))?.fields.find(
      (f) => f.slug === "total",
    );
    assert(totalDef);
    const addition = totalDef.options?.formula?.expression === "{price} * {qty} + 10" ? 20 : 10;
    await measure("edit total + downstream grand", () =>
      client.bases.fieldChangeRequest({
        operation: "update",
        baseId: large.id,
        fieldId: totalDef.id,
        patch: { options: { formula: { expression: `{price} * {qty} + ${addition}` } } },
        autoMerge: true,
      }),
    );
    const invalid =
      await monitor`select count(*)::int as count from busabase_records r join busabase_commits c on c.id = r.head_commit_id where r.base_id = ${large.id} and ((c.payload->>'total')::numeric is distinct from (c.payload->>'price')::numeric * 2 + ${addition} or (c.payload->>'grand')::numeric is distinct from (c.payload->>'price')::numeric * 2 + ${addition + 1})`;
    assert.equal(invalid[0].count, 0);
    const projected =
      await monitor`select field_slug, count(*)::int as count, min(value_number) as minimum, max(value_number) as maximum from busabase_field_values where base_id = ${large.id} and change_request_id is null and field_slug in ('total', 'grand') group by field_slug order by field_slug`;
    assert.deepEqual(
      projected.map((row) => [row.field_slug, row.count, Number(row.minimum), Number(row.maximum)]),
      [
        ["grand", 10_000, addition + 1, 19998 + addition + 1],
        ["total", 10_000, addition, 19998 + addition],
      ],
    );
    const mismatchedProjection =
      await monitor`select count(*)::int as count from busabase_field_values f join busabase_records r on r.id = f.record_id join busabase_commits c on c.id = r.head_commit_id where r.base_id = ${large.id} and f.change_request_id is null and f.field_slug in ('total', 'grand') and f.value_number is distinct from (c.payload->>f.field_slug)::numeric`;
    assert.equal(mismatchedProjection[0].count, 0);
    const view = await client.views.changeRequest({
      operation: "create",
      baseId: large.id,
      slug: `pg-benchmark-view-${Date.now()}`,
      name: "Benchmark totals",
      type: "table",
      autoMerge: true,
      config: {
        filters: [{ fieldSlug: "total", operator: "not_empty" }],
        sorts: [{ fieldSlug: "total", direction: "desc" }],
      },
    });
    assert(view.materialized);
    const pages: number[][] = [];
    for (const page of [1, 2]) {
      const result = await client.records.listPage({
        baseId: large.id,
        viewId: view.id,
        page,
        pageSize: 2,
      });
      assert.equal(result.total, 10_000);
      pages.push(result.records.map((row) => Number(row.headCommit.payload.total)));
    }
    assert.deepEqual(pages, [
      [19998 + addition, 19996 + addition],
      [19994 + addition, 19992 + addition],
    ]);
    const filtered = await client.records.listPage({
      baseId: large.id,
      viewId: view.id,
      page: 1,
      pageSize: 2,
      filters: [{ fieldSlug: "total", operator: "equals", value: String(19998 + addition) }],
    });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.records[0]?.headCommit.payload.total, 19998 + addition);
    console.log(
      JSON.stringify({
        savedViewPages: pages,
        exactFilteredTotal: filtered.total,
        projectionMismatches: 0,
      }),
    );
    const after = await db
      .select()
      .from(tables.busabaseRecords)
      .where(eq(tables.busabaseRecords.baseId, large.id));
    const heads = new Map(after.map((row) => [row.id, row]));
    for (const old of before)
      assert.deepEqual(heads.get(old.id), {
        ...old,
        headCommitId: heads.get(old.id)?.headCommitId,
      });
    const oldCount = await db.execute(
      sql`select count(*)::int as count from ${tables.busabaseCommits} where id in (select parent_commit_id from ${tables.busabaseCommits} where base_id = ${large.id})`,
    );
    console.log(
      JSON.stringify({
        benchmark: measurements,
        projectionChecks: projected,
        auditRowsPreserved: before.length,
        historicalParents: oldCount,
        baseId: large.id,
      }),
    );
  } finally {
    for (const worker of workers) if (worker.connected) worker.kill();
    await closeAppDb();
    await monitor.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
