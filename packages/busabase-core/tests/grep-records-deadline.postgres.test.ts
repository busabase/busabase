/**
 * Real-PostgreSQL check that a records grep's prefiltered batch cannot
 * outlive the request.
 *
 * grep shares the app's connection pool. A batch statement still running in
 * Postgres after grep answered would keep holding a pooled connection — the
 * shape of the 2026-10-30 outage, where a dry pool queued sign-in forever.
 * Here another session holds a lock on `busabase_commits`, so the batch can
 * only finish if its statement timeout cancels it: grep must answer near its
 * deadline, report the batch as not reached, and leave nothing running.
 *
 * PGlite has one connection and no lock waits, so this needs a real server:
 * set GREP_RECORDS_PG_TEST_URL to an admin URL whose user may create
 * databases; a throwaway database is created and dropped.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits } from "../src/db/schema";
import { busabaseRecords } from "../src/domains/base/schema";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const adminUrl = process.env.GREP_RECORDS_PG_TEST_URL?.trim();
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const RECORDS = 3_000;
const TIMEOUT_MS = 500;
/** Statement deadline slack in `logic/grep.ts`, plus room for a loaded machine. */
const ANSWER_WITHIN_MS = TIMEOUT_MS + 200 + 1_500;
/** Released after this long whatever happens, so a regression fails instead of hanging. */
const LOCK_HELD_MS = 8_000;

describe.skipIf(!adminUrl)("grep — a prefiltered records batch stops at the deadline", () => {
  const dbName = `busabase_grep_deadline_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let observer: ReturnType<typeof postgres>;
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    if (!adminUrl) throw new Error("GREP_RECORDS_PG_TEST_URL is not configured");
    admin = postgres(adminUrl, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    observer = postgres(url.toString(), { max: 2, prepare: false });

    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-deadline-storage-"));
    process.env.PG_DATABASE_URL = url.toString();
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const db = await getDb();
    await migrate(db as Parameters<typeof migrate>[0], {
      migrationsFolder: path.resolve(MIGRATIONS_CWD, "src/db/migrations"),
    });
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "grep-deadline",
      name: "Deadline",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const ids = Array.from({ length: RECORDS }, (_, i) => i);
    await db.insert(busabaseCommits).values(
      ids.map((i) => ({
        id: `cmt_deadline_${i}`,
        baseId,
        payload: { title: `deadline record ${i}` },
        author: "test",
        createdAt,
      })),
    );
    await db.insert(busabaseRecords).values(
      ids.map((i) => ({
        id: `rec_deadline_${i}`,
        baseId,
        headCommitId: `cmt_deadline_${i}`,
        createdBy: "test",
        createdAt,
        updatedAt: createdAt,
      })),
    );
    process.env.BUSABASE_GREP_TIMEOUT_MS = String(TIMEOUT_MS);
  }, 120_000);

  afterAll(async () => {
    delete process.env.BUSABASE_GREP_TIMEOUT_MS;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    await observer?.end();
    // FORCE also closes the app pool's connections to it.
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin?.end();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("answers near the deadline and leaves no batch statement running", async () => {
    // Before taking the lock: everything grep reads besides commits is warm.
    const control = await client.grep({
      pattern: "deadline record 7",
      sources: ["records"],
      scope: { records: { baseIds: [baseId] } },
    });
    expect(control.matches.length).toBeGreaterThan(0);

    const lock = await observer.reserve();
    await lock`begin`;
    await lock`lock table busabase_commits in access exclusive mode`;
    const release = setTimeout(() => void lock`rollback`, LOCK_HELD_MS);
    try {
      const startedAt = Date.now();
      const result = await client.grep({
        pattern: "NoSuchWordAnywhere",
        sources: ["records"],
        scope: { records: { baseIds: [baseId] } },
      });
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeLessThan(ANSWER_WITHIN_MS);
      // The cancelled batch was never examined.
      expect(result.coverage.records).toEqual({ scanned: 0, errored: [], notReached: RECORDS });
      expect(result.truncated).toBe(true);

      const running = await observer`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and state <> 'idle'
          and query ilike '%strpos%'`;
      expect(running[0]?.count).toBe(0);
    } finally {
      clearTimeout(release);
      await lock`rollback`;
      lock.release();
    }
  }, 30_000);
});
