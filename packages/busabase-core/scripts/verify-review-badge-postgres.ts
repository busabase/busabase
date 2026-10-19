/**
 * Compare the old full-count badge path with reviewCount against disposable PG16.
 * Apply Cloud migrations to the isolated database before running this script.
 * NODE_OPTIONS=--conditions=react-server pnpm --filter busabase-core exec tsx scripts/verify-review-badge-postgres.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runWithBusabaseContext } from "../src/context";
import * as schema from "../src/db/schema";
import { clearChangeRequestScopeCache } from "../src/logic/change-request-scope-cache";
import { busabaseRouter } from "../src/router";

const url = new URL(process.env.PG_DATABASE_URL ?? "");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.equal(url.hostname, "127.0.0.1", "Only the dedicated loopback PostgreSQL is allowed");
assert.equal(url.port, "55439");
assert.equal(url.pathname, "/review_badge_cloud_verify");
assert.ok(!process.env.PG_DATABASE_READ_URL?.trim(), "Read replicas are forbidden in this harness");

const HISTORICAL_ROWS = 30_000;
const PENDING_ROWS = 20;
const SAMPLES = 20;
const spaceId = `review-badge-bench-${randomUUID()}`;
const actorId = "synthetic-reviewer";
let capture: string[] | null = null;
const pg = postgres(url.toString(), {
  max: 1,
  prepare: false,
  debug: (_connection, query) => capture?.push(query),
});
const db = drizzle({ client: pg, schema });
const client = createRouterClient(busabaseRouter);
const inSpace = <T>(manager: boolean, fn: () => Promise<T>) =>
  runWithBusabaseContext(
    { db, spaceId, actorId, isSpaceManager: manager, permissionLevel: manager ? "manage" : "read" },
    fn,
  );
const rounded = (n: number) => Number(n.toFixed(3));
const summary = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: samples.length,
    meanMs: rounded(samples.reduce((sum, n) => sum + n, 0) / samples.length),
    medianMs: rounded(sorted[Math.floor(sorted.length / 2)]!),
    p95Ms: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]!),
  };
};
const timed = async <T>(fn: () => Promise<T>) => {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
};
const oldSql =
  'select "id", "status", "submitted_by", "updated_at" from "busabase_change_requests" where "space_id" = $1';
const newSql =
  'select "id" from "busabase_change_requests" where "space_id" = $1 and "status" = $2';

try {
  const base = await inSpace(true, () =>
    client.bases.create({ slug: "benchmark", name: "Synthetic benchmark", autoMerge: true }),
  );
  await pg`
    insert into busabase_change_requests (id, space_id, base_id, status, submitted_by, updated_at)
    select ${spaceId} || '-cr-' || g, ${spaceId}, ${base.id},
      case when g <= ${HISTORICAL_ROWS} then 'merged'::busabase_change_request_status
           else 'in_review'::busabase_change_request_status end,
      'synthetic-producer', now() - interval '1 day'
    from generate_series(1, ${HISTORICAL_ROWS + PENDING_ROWS}) g
  `;
  await pg`
    insert into busabase_commits (id, space_id, base_id, operation_id, payload, operation, author)
    select ${spaceId} || '-cmt-' || g, ${spaceId}, ${base.id},
      ${spaceId} || '-op-' || g, '{}'::jsonb, 'record_create', 'synthetic-producer'
    from generate_series(1, ${HISTORICAL_ROWS + PENDING_ROWS}) g
  `;
  await pg`
    insert into busabase_operations (id, space_id, change_request_id, base_id, operation, head_commit_id)
    select ${spaceId} || '-op-' || g, ${spaceId}, ${spaceId} || '-cr-' || g,
      ${base.id}, 'record_create', ${spaceId} || '-cmt-' || g
    from generate_series(1, ${HISTORICAL_ROWS + PENDING_ROWS}) g
  `;
  await pg`analyze busabase_change_requests`;
  await pg`analyze busabase_operations`;

  const oldRows = await pg.unsafe(oldSql, [spaceId]);
  const newRows = await pg.unsafe(newSql, [spaceId, "in_review"]);
  assert.equal(oldRows.length, HISTORICAL_ROWS + PENDING_ROWS + 1);
  assert.equal(newRows.length, PENDING_ROWS);

  clearChangeRequestScopeCache();
  const oldCold = await timed(() => inSpace(false, () => client.changeRequests.counts()));
  clearChangeRequestScopeCache();
  capture = [];
  const newCold = await timed(() => inSpace(false, () => client.changeRequests.reviewCount()));
  const newQueries = capture;
  capture = null;
  assert.equal(oldCold.result.review, PENDING_ROWS);
  assert.deepEqual(newCold.result, { review: PENDING_ROWS });
  const candidateQueries = newQueries.filter((query) =>
    /^select .* from "busabase_change_requests" where /i.test(query),
  );
  assert.equal(candidateQueries.length, 1);
  assert.match(candidateQueries[0]!, /^select "id" from /);
  assert.match(candidateQueries[0]!, /"status" = \$2/);

  // Warm terminal-scope caches before alternating samples. This compares the
  // optimized badge with the old path's best steady-state behavior as well.
  for (let i = 0; i < 3; i++) {
    await inSpace(false, () => client.changeRequests.counts());
    await inSpace(false, () => client.changeRequests.reviewCount());
  }
  const oldSqlMs: number[] = [];
  const newSqlMs: number[] = [];
  const oldRouteMs: number[] = [];
  const newRouteMs: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (const kind of i % 2 === 0 ? ["old", "new"] : ["new", "old"]) {
      if (kind === "old") {
        oldSqlMs.push((await timed(() => pg.unsafe(oldSql, [spaceId]))).ms);
        const sample = await timed(() => inSpace(false, () => client.changeRequests.counts()));
        assert.equal(sample.result.review, PENDING_ROWS);
        oldRouteMs.push(sample.ms);
      } else {
        newSqlMs.push((await timed(() => pg.unsafe(newSql, [spaceId, "in_review"]))).ms);
        const sample = await timed(() => inSpace(false, () => client.changeRequests.reviewCount()));
        assert.deepEqual(sample.result, { review: PENDING_ROWS });
        newRouteMs.push(sample.ms);
      }
    }
  }
  const manager = await inSpace(true, () => client.changeRequests.reviewCount());
  assert.deepEqual(manager, { review: PENDING_ROWS });
  const oldPlan = await pg.unsafe(`explain (analyze, buffers, format json) ${oldSql}`, [spaceId]);
  const newPlan = await pg.unsafe(`explain (analyze, buffers, format json) ${newSql}`, [
    spaceId,
    "in_review",
  ]);
  const report = {
    environment: {
      postgresVersion: (await pg`select version() as version`)[0]!.version,
      endpoint: "127.0.0.1:55439/review_badge_cloud_verify",
      productionAccessed: false,
      historicalRows: HISTORICAL_ROWS,
      pendingRows: PENDING_ROWS,
      cache: "terminal scopes warmed; alternating old/new samples; no HTTP/UI timing included",
    },
    correctness: { nonManagerReviewCount: PENDING_ROWS, managerReviewCount: manager.review },
    candidates: {
      before: { rows: oldRows.length, jsonBytes: Buffer.byteLength(JSON.stringify(oldRows)) },
      after: { rows: newRows.length, jsonBytes: Buffer.byteLength(JSON.stringify(newRows)) },
    },
    scopeCacheCold: { beforeMs: rounded(oldCold.ms), afterMs: rounded(newCold.ms) },
    sqlRoundTrip: { before: summary(oldSqlMs), after: summary(newSqlMs) },
    routerWithAcl: { before: summary(oldRouteMs), after: summary(newRouteMs) },
    newCandidateSql: candidateQueries[0],
    explain: { before: oldPlan[0]!["QUERY PLAN"], after: newPlan[0]!["QUERY PLAN"] },
    limitation:
      "Local synthetic PostgreSQL timings are not production latency or a production SLA.",
  };
  await writeFile(
    "/tmp/review-badge-postgres-results.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({ ...report, explain: "See /tmp/review-badge-postgres-results.json" }, null, 2),
  );
} finally {
  // Delete only this invocation's synthetic fixture, never any other space.
  await pg`delete from busabase_operations where space_id = ${spaceId}`;
  await pg`delete from busabase_commits where space_id = ${spaceId}`;
  await pg`delete from busabase_change_requests where space_id = ${spaceId}`;
  await pg`delete from busabase_nodes where space_id = ${spaceId}`;
  await pg.end();
}
