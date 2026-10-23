import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getContextDb, getContextSpaceId, runWithBusabaseContext } from "../src/context";
import { getSearchExecutionOutcome, withSearchExecution } from "../src/logic/search-execution";

afterEach(() => vi.unstubAllEnvs());

describe("search execution with real PGLite", () => {
  it("scopes tenant context only to SQL and commits self-healing writes outside it", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    try {
      await db.execute(sql`create table search_probe (id integer)`);
      await runWithBusabaseContext({ spaceId: "search-probe-space", db }, () =>
        withSearchExecution(db, "full", undefined, async (requestDb, execution) => {
          expect(requestDb).toBe(db);
          expect(getContextDb()).toBe(db);
          expect(getContextSpaceId()).toBe("search-probe-space");
          await execution.beforeQuery();
          await requestDb.execute(sql`insert into search_probe values (1)`);
          await execution.query(async (tx) => {
            expect(getContextDb()).toBe(tx);
            expect(getContextSpaceId()).toBe("search-probe-space");
            await tx.execute(sql`select 1`);
          });
          expect(getContextDb()).toBe(db);
        }),
      );
      expect((await client.query("select * from search_probe")).rows).toEqual([{ id: 1 }]);
    } finally {
      await client.close();
    }
  });

  it("rolls back and stops the next phase when the request is canceled", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    const controller = new AbortController();
    try {
      await db.execute(sql`create table search_probe (id integer)`);
      await expect(
        withSearchExecution(db, "quick", controller.signal, async (_db, execution) =>
          execution.query(async (tx) => {
            await tx.execute(sql`insert into search_probe values (1)`);
            controller.abort();
            execution.checkpoint();
            await tx.execute(sql`insert into search_probe values (2)`);
          }),
        ),
      ).rejects.toMatchObject({ code: "CLIENT_CLOSED_REQUEST" });
      expect((await client.query("select * from search_probe")).rows).toEqual([]);
      expect((await client.query("show statement_timeout")).rows).toEqual([
        { statement_timeout: "0" },
      ]);
    } finally {
      await client.close();
    }
  });

  it("releases each SQL transaction before a host resolver uses its captured outer database", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    // Cloud's resolveUsers closes over its host database instead of consulting
    // getContextDb. The embedded client serializes all access on one connection.
    const resolveUsers = async () => {
      expect(getContextDb()).toBe(db);
      await db.execute(sql`select 2`);
      return "resolved";
    };
    try {
      const results = await runWithBusabaseContext({ db }, () =>
        Promise.all(
          Array.from({ length: 3 }, () =>
            withSearchExecution(db, "full", undefined, async (_db, execution) => {
              await execution.query(async (tx) => {
                await tx.execute(sql`select 1`);
              });
              return resolveUsers();
            }),
          ),
        ),
      );
      expect(results).toEqual(["resolved", "resolved", "resolved"]);
    } finally {
      await client.close();
    }
  });

  it("rejects an expired request without racing its unfinished transaction", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    vi.stubEnv("BUSABASE_SEARCH_QUICK_REQUEST_TIMEOUT_MS", "10");
    try {
      await expect(
        withSearchExecution(db, "quick", undefined, async (_tx, execution) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          execution.checkpoint();
        }),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      expect((await client.query("select 1 as alive")).rows).toEqual([{ alive: 1 }]);
    } finally {
      await client.close();
    }
  });

  it("keeps a real SQL error instead of reporting it as a timeout past the deadline", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    vi.stubEnv("BUSABASE_SEARCH_QUICK_REQUEST_TIMEOUT_MS", "30");
    try {
      const error = await withSearchExecution(db, "quick", undefined, async (_db, execution) =>
        execution.read(async (readDb) => {
          // Cross the deadline while the statement is in flight, then fail.
          await new Promise((resolve) => setTimeout(resolve, 50));
          await readDb.execute(sql`select 1 / 0`);
        }),
      ).catch((caught: unknown) => caught);
      expect(getSearchExecutionOutcome(error)).toBe("failed");
      expect(error).toMatchObject({ cause: { code: "22012" } });
    } finally {
      await client.close();
    }
  });

  it("runs bounded reads on the original database without a budgeted transaction", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    try {
      const result = await runWithBusabaseContext({ db }, () =>
        withSearchExecution(db, "quick", undefined, async (_db, execution) =>
          execution.read(async (readDb) => {
            expect(readDb).toBe(db);
            const rows = await readDb.execute<{ statement_timeout: string }>(
              sql`show statement_timeout`,
            );
            return rows.rows[0]?.statement_timeout;
          }),
        ),
      );
      // A budgeted scope would have SET LOCAL statement_timeout to <= 1000ms.
      expect(result).toBe("0");
    } finally {
      await client.close();
    }
  });

  it("shares one budgeted transaction across sequential statements in a scope", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    try {
      const txids = await withSearchExecution(db, "quick", undefined, async (_db, execution) =>
        execution.query(async (tx) => {
          const first = await tx.execute<{ id: string }>(sql`select txid_current()::text as id`);
          execution.checkpoint();
          const second = await tx.execute<{ id: string }>(sql`select txid_current()::text as id`);
          return [first.rows[0]?.id, second.rows[0]?.id];
        }),
      );
      expect(txids[0]).toBeDefined();
      expect(txids[0]).toBe(txids[1]);
    } finally {
      await client.close();
    }
  });

  it("does not start a bounded read after the request is canceled", async () => {
    const client = await PGlite.create();
    const db = pgliteDrizzle(client);
    const controller = new AbortController();
    let ran = false;
    try {
      controller.abort();
      const error = await withSearchExecution(
        db,
        "quick",
        controller.signal,
        async (_db, execution) =>
          execution.read(async () => {
            ran = true;
          }),
      ).catch((caught: unknown) => caught);
      expect(getSearchExecutionOutcome(error)).toBe("canceled");
      expect(ran).toBe(false);
    } finally {
      await client.close();
    }
  });
});

const pgUrl = process.env.BUSABASE_SEARCH_TEST_DATABASE_URL ?? "";
describe.skipIf(!pgUrl)("search execution with real PostgreSQL", () => {
  it("drains an active sibling transaction before returning the primary SQL error", async () => {
    const client = postgres(pgUrl, { max: 2, prepare: false });
    const observer = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    let siblingPid = 0;
    let siblingFinished = false;
    let startSibling: () => void = () => undefined;
    const siblingStarted = new Promise<void>((resolve) => {
      startSibling = resolve;
    });
    try {
      const error = await withSearchExecution(db, "full", undefined, async (_db, execution) =>
        Promise.all([
          execution.query(async (tx) => {
            await siblingStarted;
            await tx.execute(sql`select 1 / 0`);
          }),
          execution.query(async (tx) => {
            const rows = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
            siblingPid = Number(rows[0]?.pid);
            startSibling();
            await tx.execute(sql`select pg_sleep(0.12)`);
            siblingFinished = true;
          }),
        ]),
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ cause: { code: "22012" } });
      expect(siblingFinished).toBe(true);
      expect(
        (await observer`select state from pg_stat_activity where pid = ${siblingPid}`)[0]?.state,
      ).toBe("idle");
    } finally {
      await Promise.all([client.end(), observer.end()]);
    }
  });

  it("rejects a queued sibling before running its SQL after the parent request fails", async () => {
    const client = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    let siblingRan = false;
    try {
      const error = await withSearchExecution(db, "full", undefined, async (_db, execution) =>
        Promise.all([
          execution.query(async (tx) => {
            await tx.execute(sql`select 1 / 0`);
          }),
          execution.query(async (tx) => {
            siblingRan = true;
            await tx.execute(sql`select pg_sleep(0.12)`);
          }),
        ]),
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ cause: { code: "22012" } });
      expect(siblingRan).toBe(false);
      expect((await client`show statement_timeout`)[0]?.statement_timeout).toBe("0");
      expect((await client`select 1 as alive`)[0]?.alive).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("stops an active statement and restores the reused connection's timeout", async () => {
    const client = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    vi.stubEnv("BUSABASE_SEARCH_QUICK_STATEMENT_TIMEOUT_MS", "60");
    try {
      await expect(
        withSearchExecution(db, "quick", undefined, async (_db, execution) =>
          execution.query(async (tx) => {
            await tx.execute(sql`select pg_sleep(2)`);
          }),
        ),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      expect((await client`show statement_timeout`)[0]).toEqual({ statement_timeout: "0" });
      await client`select pg_sleep(0.12)`;
      expect((await client`select 1 as alive`)[0]?.alive).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("bounds in-flight canceled work and never sends the next query", async () => {
    const client = postgres(pgUrl, { max: 1, prepare: false });
    const observer = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    const controller = new AbortController();
    vi.stubEnv("BUSABASE_SEARCH_QUICK_STATEMENT_TIMEOUT_MS", "100");
    let nextQuery = false;
    let abort: ReturnType<typeof setTimeout> | undefined;
    try {
      const [{ pid }] = await client<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const startedAt = Date.now();
      const error = await withSearchExecution(
        db,
        "quick",
        controller.signal,
        async (_db, execution) => {
          await execution.query(async (tx) => {
            abort = setTimeout(() => controller.abort(), 30);
            await tx.execute(sql`select pg_sleep(2)`);
          });
          await execution.beforeQuery();
          await execution.query(async (tx) => {
            nextQuery = true;
            await tx.execute(sql`select 1`);
          });
        },
      ).catch((caught: unknown) => caught);
      expect(getSearchExecutionOutcome(error)).toBe("canceled");
      expect(nextQuery).toBe(false);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(
        (await observer`select state from pg_stat_activity where pid = ${pid}`)[0]?.state,
      ).toBe("idle");
      await client`select pg_sleep(0.15)`;
      expect((await client`show statement_timeout`)[0]?.statement_timeout).toBe("0");
    } finally {
      clearTimeout(abort);
      await Promise.all([client.end(), observer.end()]);
    }
  });

  it("caps a phase at the remaining whole-request budget", async () => {
    const client = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    vi.stubEnv("BUSABASE_SEARCH_QUICK_STATEMENT_TIMEOUT_MS", "1000");
    vi.stubEnv("BUSABASE_SEARCH_QUICK_REQUEST_TIMEOUT_MS", "150");
    try {
      await expect(
        withSearchExecution(db, "quick", undefined, async (_db, execution) => {
          await execution.query(async (tx) => {
            await tx.execute(sql`select pg_sleep(0.08)`);
          });
          await execution.beforeQuery();
          await execution.query(async (tx) => {
            await tx.execute(sql`select pg_sleep(0.5)`);
          });
        }),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      expect((await client`select 1 as alive`)[0]?.alive).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("releases saturated max-one pools before host resolvers use their captured database", async () => {
    const client = postgres(pgUrl, { max: 1, prepare: false });
    const db = postgresDrizzle(client);
    const resolveUsers = async () => {
      expect(getContextDb()).toBe(db);
      await db.execute(sql`select 2`);
      return "resolved";
    };
    try {
      const results = await runWithBusabaseContext({ db }, () =>
        Promise.all(
          Array.from({ length: 3 }, () =>
            withSearchExecution(db, "full", undefined, async (_db, execution) => {
              await execution.query(async (tx) => {
                await tx.execute(sql`select pg_sleep(0.01)`);
              });
              return resolveUsers();
            }),
          ),
        ),
      );
      expect(results).toEqual(["resolved", "resolved", "resolved"]);
      expect((await client`show statement_timeout`)[0]?.statement_timeout).toBe("0");
    } finally {
      await client.end();
    }
  });
});
