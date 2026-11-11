/**
 * Real-PostgreSQL checks that running grep's two lanes side by side (files +
 * nodes, prompts + records — see `SOURCE_LANES` in `logic/grep.ts`) neither
 * leaves a statement running after the response nor holds more than two
 * pooled connections.
 *
 * grep shares the app's connection pool (10 connections, 5 with a read
 * replica). A statement still running after grep answered keeps a pooled
 * connection nobody waits for — the shape of the 2026-10-30 outage, where a dry
 * pool queued sign-in forever. Here another session holds a lock on
 * `busabase_commits`, so a records batch can only end through its statement
 * timeout.
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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits } from "../src/db/schema";
import { busabaseRecords } from "../src/domains/base/schema";
import { busabaseRouter } from "../src/router";

const files = vi.hoisted(() => ({ mode: "real" as "real" | "slice" | "throw" }));

vi.mock("../src/domains/assets/logic/asset-grep-logic", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/domains/assets/logic/asset-grep-logic")>();
  return {
    ...actual,
    grepAssets: async (
      input: Parameters<typeof actual.grepAssets>[0],
      options: Parameters<typeof actual.grepAssets>[1] = {},
    ) => {
      if (files.mode === "throw") {
        // Fails once records' batch is already waiting on the lock.
        await new Promise((resolve) => setTimeout(resolve, 300));
        throw new Error("storage is down");
      }
      if (files.mode === "slice") {
        // A files source that waits on storage for its whole slice.
        const deadline = options.deadline ?? Date.now();
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())));
        return {
          matches: [],
          filesScanned: 0,
          missing: [],
          stale: [],
          unsearchable: 0,
          errored: [],
          notReached: 1,
          truncated: true,
        };
      }
      return actual.grepAssets(input, options);
    },
  };
});

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const adminUrl = process.env.GREP_RECORDS_PG_TEST_URL?.trim();
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const APP_NAME = "busabase-grep-lanes-app";
const RECORDS = 3_000;
const TIMEOUT_MS = 800;
/** Statement deadline slack in `logic/grep.ts`, plus room for a loaded machine. */
const ANSWER_WITHIN_MS = TIMEOUT_MS + 200 + 1_500;
/** Released after this long whatever happens, so a regression fails instead of hanging. */
const LOCK_HELD_MS = 8_000;

type DbState = { db: unknown; client: unknown; initPromise: unknown };

/**
 * Close the app's pool and start a new one on next use. postgres.js opens a
 * connection only when every open one is busy, and keeps it for its idle
 * timeout (60 s), so the connections a fresh pool has after a call are the
 * most that call held at once.
 */
const freshAppPool = async () => {
  const g = globalThis as typeof globalThis & { __busabaseCoreDbState?: DbState };
  const client = g.__busabaseCoreDbState?.client as { end?: () => Promise<void> } | undefined;
  await client?.end?.();
  g.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
};

describe.skipIf(!adminUrl)("grep — two lanes on a real Postgres", () => {
  const dbName = `busabase_grep_lanes_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let observer: ReturnType<typeof postgres>;
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  const appConnections = async () => {
    const [row] = await observer`
      select count(*)::int as count from pg_stat_activity
      where datname = current_database() and application_name = ${APP_NAME}`;
    return row?.count ?? -1;
  };
  const busyAppConnections = async () => {
    const [row] = await observer`
      select count(*)::int as count from pg_stat_activity
      where datname = current_database()
        and application_name = ${APP_NAME}
        and state <> 'idle'`;
    return row?.count ?? -1;
  };
  const runningBatches = async () => {
    const [row] = await observer`
      select count(*)::int as count from pg_stat_activity
      where datname = current_database()
        and application_name = ${APP_NAME}
        and state <> 'idle'
        and query ilike '%strpos%'`;
    return row?.count ?? -1;
  };

  /** Hold an exclusive lock on `busabase_commits` while `fn` runs. */
  const withCommitsLocked = async <T>(fn: () => Promise<T>): Promise<T> => {
    const lock = await observer.reserve();
    await lock`begin`;
    await lock`lock table busabase_commits in access exclusive mode`;
    const release = setTimeout(() => void lock`rollback`, LOCK_HELD_MS);
    try {
      return await fn();
    } finally {
      clearTimeout(release);
      await lock`rollback`;
      lock.release();
    }
  };

  beforeAll(async () => {
    if (!adminUrl) throw new Error("GREP_RECORDS_PG_TEST_URL is not configured");
    admin = postgres(adminUrl, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    observer = postgres(url.toString(), { max: 3, prepare: false });
    url.searchParams.set("application_name", APP_NAME);

    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-lanes-storage-"));
    process.env.PG_DATABASE_URL = url.toString();
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const db = await getDb();
    await migrate(db as Parameters<typeof migrate>[0], {
      migrationsFolder: path.resolve(MIGRATIONS_CWD, "src/db/migrations"),
    });
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "grep-lanes",
      name: "Lanes",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    await client.docs.create({
      slug: "grep-lanes-doc",
      name: "Lanes Doc",
      body: "a doc the nodes source reads from storage",
      autoMerge: true,
    });
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const ids = Array.from({ length: RECORDS }, (_, i) => i);
    await db.insert(busabaseCommits).values(
      ids.map((i) => ({
        id: `cmt_lanes_${i}`,
        baseId,
        payload: { title: `lanes record ${i}` },
        author: "test",
        createdAt,
      })),
    );
    await db.insert(busabaseRecords).values(
      ids.map((i) => ({
        id: `rec_lanes_${i}`,
        baseId,
        headCommitId: `cmt_lanes_${i}`,
        createdBy: "test",
        createdAt,
        updatedAt: createdAt,
      })),
    );
    process.env.BUSABASE_GREP_TIMEOUT_MS = String(TIMEOUT_MS);
    // Warm everything grep reads besides commits, before any lock is taken.
    const control = await client.grep({ pattern: "lanes record 7" });
    expect(control.matches.length).toBeGreaterThan(0);
  }, 120_000);

  afterEach(() => {
    files.mode = "real";
  });

  afterAll(async () => {
    delete process.env.BUSABASE_GREP_TIMEOUT_MS;
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    await freshAppPool();
    await observer?.end();
    // FORCE also closes the app pool's connections to it.
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin?.end();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("an unscoped grep holds at most two connections and leaves none running", async () => {
    await freshAppPool();
    await vi.waitFor(async () => expect(await appConnections()).toBe(0));

    const result = await withCommitsLocked(async () => {
      const startedAt = Date.now();
      const answer = await client.grep({ pattern: "NoSuchWordAnywhere" });
      expect(Date.now() - startedAt).toBeLessThan(ANSWER_WITHIN_MS);
      // Checked before the lock is released: nothing is still waiting on it.
      expect(await runningBatches()).toBe(0);
      return answer;
    });

    // The records batch was cancelled at the deadline, never examined.
    expect(result.coverage.records).toEqual({ scanned: 0, errored: [], notReached: RECORDS });
    expect(result.truncated).toBe(true);
    // One connection per lane at most: storage lane (candidate listing) and
    // Postgres lane (prompts, then records' batches) — never more.
    expect(await appConnections()).toBeLessThanOrEqual(2);
  }, 30_000);

  it("a lane that fails does not answer while the other lane's statement is still running", async () => {
    files.mode = "throw";
    await withCommitsLocked(async () => {
      await expect(client.grep({ pattern: "NoSuchWordAnywhere" })).rejects.toThrow(
        "storage is down",
      );
      // The records batch blocked on the lock ended (statement timeout) before
      // the error was answered — it does not keep a pooled connection busy —
      // and no lane goes on to start another statement afterwards.
      expect(await runningBatches()).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await busyAppConnections()).toBe(0);
    });
  }, 30_000);
});
