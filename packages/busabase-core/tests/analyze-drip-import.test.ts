import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseRouter } from "../src/router";

/**
 * Post-import planner statistics must also be refreshed for a DRIP import.
 *
 * `refreshRecordQueryStatistics` exists because a freshly loaded table has no
 * statistics until autovacuum gets to it — which on the local-first PGLite
 * deployment can be never — and the planner then picks a plan that is orders of
 * magnitude slower (measured 7,874ms vs 40ms for one sorted page of a 10k Base).
 *
 * The first version only refreshed when a SINGLE merge crossed the threshold,
 * which missed the shape an agent or script actually produces: 100 records at a
 * time, repeatedly, until the Base is huge — no individual merge is ever "bulk",
 * so statistics were never refreshed at all. This pins the accumulating
 * behaviour, because the failure mode is invisible (correct results, just slow).
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const CHUNK = 60; // deliberately well below the 200 threshold
const CHUNKS = 5; // 300 total → crosses it only by accumulating

describe("planner statistics after a drip-feed import", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drip-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drip-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "drip",
      name: "Drip",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** What the planner believes busabase_records holds. -1 / 0 = never analysed. */
  const plannerRowEstimate = async (): Promise<number> => {
    const db = await getDb();
    const result = await db.execute(
      sql`select reltuples::bigint as r from pg_class where relname = 'busabase_records'`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) as Array<{
      r: number | string;
    }>;
    return Number(rows[0]?.r ?? -1);
  };

  it("accumulates small merges until statistics are refreshed", async () => {
    for (let chunk = 0; chunk < CHUNKS; chunk++) {
      const cr = await client.bases.createBulkChangeRequest({
        baseId,
        records: Array.from({ length: CHUNK }, (_, i) => ({
          name: `Drip ${chunk * CHUNK + i}`,
        })),
        message: `drip ${chunk}`,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    }

    const { total } = await client.records.count({ baseId });
    expect(total).toBe(CHUNK * CHUNKS);

    // No single merge was ≥200, so the old per-merge check would leave this at
    // the "never analysed" value.
    const estimate = await plannerRowEstimate();
    expect(estimate).toBeGreaterThan(0);
  }, 300_000);
});
