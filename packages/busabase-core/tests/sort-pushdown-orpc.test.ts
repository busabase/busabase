import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Server-side SORT push-down keyset correctness. `records.listPaged` with a
 * number sort must page through the WHOLE base in the right order without
 * dropping or repeating a row across page boundaries — including the boundary
 * into the trailing NULL bucket (records with no value for the sort field) and
 * across duplicate values (id tiebreak). This is the safety net for the
 * NULL-aware keyset predicate.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Sort push-down keyset — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  const WITH_SCORE = 60;
  const NO_SCORE = 15;
  const TOTAL = WITH_SCORE + NO_SCORE;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-sort-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-sort-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "scored",
      name: "Scored",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    // Heavy duplication (values 0..14) to stress the id tiebreak, plus records
    // with NO score field at all (→ NULL in the join → trailing bucket).
    const records = [
      ...Array.from({ length: WITH_SCORE }, (_, i) => ({ name: `R${i}`, score: (i * 13) % 15 })),
      ...Array.from({ length: NO_SCORE }, (_, i) => ({ name: `N${i}` })),
    ];
    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "sort seed",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const scoreOf = (record: { headCommit: { fields: Record<string, unknown> } }): number | null => {
    const value = record.headCommit.fields.score;
    return value === undefined || value === null ? null : Number(value);
  };

  const pageAll = async (direction: "asc" | "desc") => {
    const collected: Awaited<ReturnType<Client["records"]["listPaged"]>>["records"] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await client.records.listPaged({
        baseId,
        limit: 10,
        sort: { fieldSlug: "score", fieldType: "number", direction },
        cursor,
      });
      collected.push(...page.records);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return collected;
  };

  const assertKeysetInvariants = (
    rows: Awaited<ReturnType<typeof pageAll>>,
    direction: "asc" | "desc",
  ) => {
    // 1. Complete + no dup/drop across page boundaries.
    expect(rows.length).toBe(TOTAL);
    expect(new Set(rows.map((r) => r.id)).size).toBe(TOTAL);

    const scores = rows.map(scoreOf);
    const firstNull = scores.indexOf(null);
    const nonNull = firstNull === -1 ? scores : scores.slice(0, firstNull);
    const nullPart = firstNull === -1 ? [] : scores.slice(firstNull);

    // 2. All NULL-score rows sort LAST (both directions).
    expect(nullPart.length).toBe(NO_SCORE);
    expect(nullPart.every((s) => s === null)).toBe(true);

    // 3. Non-null scores are monotonic in the sort direction.
    for (let i = 1; i < nonNull.length; i++) {
      const prev = nonNull[i - 1] as number;
      const curr = nonNull[i] as number;
      if (direction === "asc") {
        expect(curr).toBeGreaterThanOrEqual(prev);
      } else {
        expect(curr).toBeLessThanOrEqual(prev);
      }
    }
  };

  it("pages an ascending number sort with nulls last, no dup/drop", async () => {
    assertKeysetInvariants(await pageAll("asc"), "asc");
  });

  it("pages a descending number sort with nulls last, no dup/drop", async () => {
    assertKeysetInvariants(await pageAll("desc"), "desc");
  });

  it("non-pushable sort (text) falls back to createdAt keyset (still complete)", async () => {
    // A text sort isn't pushed; the server returns the default order but must
    // still page through every record without loss.
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await client.records.listPaged({
        baseId,
        limit: 10,
        sort: { fieldSlug: "name", fieldType: "text", direction: "asc" },
        cursor,
      });
      for (const r of page.records) collected.push(r.id);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(collected.length).toBe(TOTAL);
    expect(new Set(collected).size).toBe(TOTAL);
  });
});
