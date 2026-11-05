import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresJsDatabaseWithReadReplica, type PostgresTimeoutConfig } from "./replicas";

/**
 * Reproduces the 2026-10-30 busabase.com outage mechanism against a real
 * PostgreSQL server, and proves the guard that ends it.
 *
 * Shape of the outage: an upload path held a `spaces` row lock while awaiting
 * network I/O, every later statement queued behind that lock, each of those
 * queue-waiters held one pooled connection, the pool (10 per pod) ran out, and
 * from then on *every* query — including a sign-in user lookup — waited forever
 * with no error logged anywhere.
 *
 * The two scenarios below only differ in the server-side timeout each client is
 * configured with; the blocked statement, the lock holder and the pool size are
 * identical. Without the guard the lock-waiting statements never return.
 */
const primaryUrl = process.env.PG_TIMEOUT_TEST_URL?.trim();
const skipIntegration = !primaryUrl;

const LOCK_HOLD_MS = 4_000;
const GUARD_LOCK_TIMEOUT_MS = 1_000;

type CloseableClient = { end(options?: { timeout?: number }): Promise<void> };

/** Drizzle wraps driver errors, so the PostgreSQL SQLSTATE may sit on the cause. */
const pgErrorCode = (error: unknown): string | undefined => {
  let current = error as { code?: unknown; cause?: unknown } | null;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = (current.cause ?? null) as { code?: unknown; cause?: unknown } | null;
  }
  return undefined;
};

describe.skipIf(skipIntegration)("PostgreSQL statement guards", () => {
  let url: string;
  let holder: ReturnType<typeof postgres> | undefined;
  const clients: CloseableClient[] = [];

  beforeAll(async () => {
    if (!primaryUrl) throw new Error("PG_TIMEOUT_TEST_URL is not configured.");
    url = primaryUrl;
    // The row everybody fights over. A dedicated table keeps the test from
    // touching application data on a shared local database.
    holder = postgres(url, { max: 1, prepare: false });
    await holder`
      CREATE TABLE IF NOT EXISTS openlib_lock_probe (
        id integer PRIMARY KEY,
        note text NOT NULL
      )
    `;
    await holder`
      INSERT INTO openlib_lock_probe (id, note) VALUES (1, 'probe')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await holder?.unsafe("DROP TABLE IF EXISTS openlib_lock_probe");
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    await holder?.end({ timeout: 5 });
  });

  const createGuardedClient = (timeouts: PostgresTimeoutConfig, poolMax: number) => {
    const databases = createPostgresJsDatabaseWithReadReplica(
      {},
      {
        mode: "postgres",
        primaryUrl: url,
        primaryPoolMax: poolMax,
        timeouts,
      },
    );
    clients.push(databases.db.$client as unknown as CloseableClient);
    return databases.db;
  };

  /** Hold the probe row for a while on its own connection, like a stuck upload. */
  const holdProbeRow = async () => {
    if (!holder) throw new Error("holder client is not ready");
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx.unsafe("SELECT id FROM openlib_lock_probe WHERE id = 1 FOR UPDATE");
      await released;
    });
    // Give the transaction time to actually take the lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      done: holding.finally(() => {
        release();
        return undefined;
      }),
      release: () => {
        release();
      },
    };
  };

  it("applies the guards to the live session", async () => {
    const db = createGuardedClient(
      {
        statementTimeoutMs: 60_000,
        lockTimeoutMs: GUARD_LOCK_TIMEOUT_MS,
        idleInTransactionTimeoutMs: 0,
      },
      1,
    );
    const [row] = await db.execute<{
      statement_timeout: string;
      lock_timeout: string;
      idle_in_transaction_session_timeout: string;
    }>(sql`SELECT current_setting('statement_timeout') AS statement_timeout,
                  current_setting('lock_timeout') AS lock_timeout,
                  current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout`);
    expect(row).toEqual({
      statement_timeout: "1min",
      lock_timeout: "1s",
      idle_in_transaction_session_timeout: "0",
    });
  });

  it("fails a blocked statement fast instead of parking a pooled connection", async () => {
    const db = createGuardedClient(
      {
        statementTimeoutMs: 60_000,
        lockTimeoutMs: GUARD_LOCK_TIMEOUT_MS,
        idleInTransactionTimeoutMs: 0,
      },
      1,
    );
    const lock = await holdProbeRow();
    const startedAt = Date.now();
    let failure: unknown;
    try {
      await db.execute(sql`SELECT id FROM openlib_lock_probe WHERE id = 1 FOR UPDATE`);
    } catch (error) {
      failure = error;
    } finally {
      lock.release();
      await lock.done;
    }

    const elapsedMs = Date.now() - startedAt;
    expect(failure, "the blocked statement should have been cancelled").toBeInstanceOf(Error);
    // 55P03 = lock_not_available, raised by lock_timeout.
    expect(pgErrorCode(failure)).toBe("55P03");
    expect(elapsedMs).toBeLessThan(LOCK_HOLD_MS);
    expect(elapsedMs).toBeGreaterThanOrEqual(GUARD_LOCK_TIMEOUT_MS - 100);

    // The point of the guard: the single pool slot is free again immediately.
    const [probe] = await db.execute<{ one: number }>(sql`SELECT 1 AS one`);
    expect(probe).toEqual({ one: 1 });
  });

  it("starves the pool when the guard is disabled — the outage, reproduced", async () => {
    // Guard disabled, exactly the production configuration that wedged.
    const db = createGuardedClient(
      { statementTimeoutMs: 0, lockTimeoutMs: 0, idleInTransactionTimeoutMs: 0 },
      1,
    );
    const lock = await holdProbeRow();
    const startedAt = Date.now();
    try {
      // Stand-in for "the app needs one more connection to answer sign-in".
      const blocked = db
        .execute(sql`SELECT id FROM openlib_lock_probe WHERE id = 1 FOR UPDATE`)
        .then(() => "completed" as const)
        .catch(() => "failed" as const);
      const outcome = await Promise.race([
        blocked,
        new Promise<"still-waiting">((resolve) =>
          setTimeout(() => resolve("still-waiting"), LOCK_HOLD_MS / 2),
        ),
      ]);

      // Unbounded wait: no result, no error, connection stuck — silent hang.
      expect(outcome).toBe("still-waiting");
      expect(Date.now() - startedAt).toBeLessThan(LOCK_HOLD_MS);

      // And because the pool's only slot is taken, an unrelated query cannot run.
      const unrelated = await Promise.race([
        db
          .execute(sql`SELECT 1 AS one`)
          .then(() => "completed" as const)
          .catch(() => "failed" as const),
        new Promise<"queued">((resolve) => setTimeout(() => resolve("queued"), 500)),
      ]);
      expect(unrelated).toBe("queued");
    } finally {
      lock.release();
      await lock.done;
    }
  });
});
