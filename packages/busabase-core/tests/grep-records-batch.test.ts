import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits } from "../src/db/schema";
import { busabaseRecords } from "../src/domains/base/schema";
import { busabaseRouter } from "../src/router";

/**
 * Records grep in a space with more records than one statement can bind.
 *
 * The records adapter used to load every candidate's HEAD commit in a single
 * `inArray`. A space with 69,856 active records went past Postgres' 65,534
 * bind-parameter limit, so every grep that included records answered 500 —
 * including an unscoped grep, which is what an agent runs first.
 *
 * Pinned here: commits are loaded batch by batch as the scan reaches them, so
 * grep answers past the limit and the budget can stop it early.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const FILLER_RECORDS = 66_000;
const INSERT_CHUNK = 2_000;

describe("grep — records past the bind-parameter limit", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let needleRecordId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-records-batch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-records-batch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    // Room for a full scan of 66,001 records on PGLite; the default budget
    // would make the second test depend on machine speed.
    process.env.BUSABASE_GREP_TIMEOUT_MS = "100000";
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "grep-records-batch",
      name: "Many Records",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;

    // Filler rows go straight into the tables: 66,000 change requests through
    // the API would take minutes, and grep only reads records + commits.
    const db = await getDb();
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    for (let start = 0; start < FILLER_RECORDS; start += INSERT_CHUNK) {
      const ids = Array.from(
        { length: Math.min(INSERT_CHUNK, FILLER_RECORDS - start) },
        (_, i) => start + i,
      );
      await db.insert(busabaseCommits).values(
        ids.map((i) => ({
          id: `cmt_filler_${i}`,
          baseId,
          payload: { title: `filler ${i}` },
          author: "test",
          createdAt,
        })),
      );
      await db.insert(busabaseRecords).values(
        ids.map((i) => ({
          id: `rec_filler_${i}`,
          baseId,
          headCommitId: `cmt_filler_${i}`,
          createdBy: "test",
          createdAt,
          updatedAt: createdAt,
        })),
      );
    }

    // Created through the real write path, and updated last, so it is the
    // first record the scan reaches.
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "RECORDSNEEDLE quarterly plan" },
      submittedBy: "agent",
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    const [merged] = (await client.changeRequests.merge({ changeRequestIds: [cr.id] })).results;
    if (!merged?.record) throw new Error("expected a created record");
    needleRecordId = merged.record.id;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.BUSABASE_GREP_TIMEOUT_MS;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers an unscoped records grep instead of failing the whole call", async () => {
    const result = await client.grep({
      pattern: "RECORDSNEEDLE",
      sources: ["records"],
      maxMatches: 1,
    });
    const hits = result.matches.flatMap((match) =>
      match.source === "records" ? [match.recordId] : [],
    );
    expect(hits).toEqual([needleRecordId]);
    // The budget stopped the scan after the first record: every other
    // candidate is reported as not reached, none as errored.
    const { scanned, errored, notReached } = result.coverage.records;
    expect(errored).toEqual([]);
    expect(scanned + notReached).toBe(FILLER_RECORDS + 1);
    expect(notReached).toBeGreaterThan(0);
  }, 60_000);

  it("reaches matches spread across every batch of the scan", async () => {
    // `filler 999`, `filler 1999`, … `filler 65999`: 66 records spread over
    // the whole space, so every batch the scan loads has to be read.
    const result = await client.grep({
      pattern: "^filler \\d*999$",
      sources: ["records"],
      scope: { records: { baseIds: [baseId] } },
      maxMatches: 100,
    });
    const hits = result.matches.flatMap((match) =>
      match.source === "records" ? [match.recordId] : [],
    );
    expect(hits).toHaveLength(66);
    expect(new Set(hits)).toEqual(
      new Set(Array.from({ length: 66 }, (_, i) => `rec_filler_${i * 1000 + 999}`)),
    );
    expect(result.coverage.records).toEqual({
      scanned: FILLER_RECORDS + 1,
      errored: [],
      notReached: 0,
    });
  }, 120_000);
});
