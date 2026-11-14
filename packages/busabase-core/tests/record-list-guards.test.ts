import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseRecords } from "../src/db/schema";
import {
  boundedRecordCount,
  createStatementBudget,
  VIEW_TOO_LARGE_MESSAGE,
  withStatementBudget,
} from "../src/domains/base/logic/record-list-guards";
import { busabaseRouter } from "../src/router";

/**
 * The limits that keep one record read bounded on a very large Base, on a real
 * PGlite database. PGlite ignores `statement_timeout` itself, so the timeout
 * is simulated; what is real is the scoping and the connection the budget runs
 * on — a single-connection pool deadlocks if anything inside reaches past it.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("record list guards (real PGLite)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-list-guards-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-list-guards-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "tasks",
      name: "Tasks",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
    await client.bases.createBulkChangeRequest({
      baseId,
      records: Array.from({ length: 5 }, (_, i) => ({ title: `Task ${i + 1}` })),
      autoMerge: true,
    });
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("counts exactly up to the limit and reports a lower bound past it", async () => {
    const db = await getDb();
    const where = [eq(busabaseRecords.baseId, baseId), eq(busabaseRecords.status, "active")];
    expect(await boundedRecordCount(db, where, 10)).toEqual({ total: 5, totalCapped: false });
    expect(await boundedRecordCount(db, where, 5)).toEqual({ total: 5, totalCapped: false });
    expect(await boundedRecordCount(db, where, 3)).toEqual({ total: 3, totalCapped: true });
  });

  it("keeps an ordinary page's response unchanged", async () => {
    const page = await client.records.listPage({ baseId, page: 1, pageSize: 2 });
    expect(page).toMatchObject({ total: 5, totalPages: 3, page: 1, pageSize: 2 });
    expect(page).not.toHaveProperty("totalCapped");
    expect(page).not.toHaveProperty("pagesCapped");
  });

  it("counts only as far as a caller asks, which is all a Kanban column needs", async () => {
    // Five records, two per page: page 1 asks whether there is a page 2.
    const first = await client.records.listPage({ baseId, page: 1, pageSize: 2, totalLimit: 3 });
    expect(first).toMatchObject({ total: 3, totalCapped: true, totalPages: 2, page: 1 });
    expect(first.records).toHaveLength(2);
    const second = await client.records.listPage({ baseId, page: 2, pageSize: 2, totalLimit: 5 });
    expect(second).toMatchObject({ total: 5, totalPages: 3, page: 2 });
    expect(second).not.toHaveProperty("totalCapped");
    // A limit at or past the real count changes nothing.
    expect(
      await client.records.listPage({ baseId, page: 1, pageSize: 2, totalLimit: 100 }),
    ).toMatchObject({ total: 5, totalPages: 3 });
    await expect(
      client.records.listPage({ baseId, page: 1, pageSize: 2, totalLimit: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("scopes the timeout to its transaction and runs getDb() on it", async () => {
    const db = await getDb();
    const inside = await withStatementBudget(db, async () => {
      // `getDb()` here must be the transaction: on PGlite's single connection a
      // read through the outer handle would wait for this scope forever.
      const inner = await getDb();
      return inner.execute(sql`select current_setting('statement_timeout') as value`);
    });
    const after = await db.execute(sql`select current_setting('statement_timeout') as value`);
    const value = (result: unknown) =>
      ((result as { rows?: Array<{ value: string }> }).rows ??
        (result as Array<{ value: string }>))[0]?.value;
    // The budget counts down from the moment it was made, so a millisecond may
    // already be gone: Postgres reports "15s" or "14999ms".
    const insideValue = value(inside) ?? "";
    const insideMs = insideValue.endsWith("ms")
      ? Number.parseInt(insideValue, 10)
      : Number.parseInt(insideValue, 10) * 1000;
    expect(insideMs).toBeGreaterThan(14_000);
    expect(insideMs).toBeLessThanOrEqual(15_000);
    expect(value(after)).toBe("0");
  });

  it("gives one request's later steps only what is left of its budget", async () => {
    const db = await getDb();
    process.env.BUSABASE_RECORD_LIST_STATEMENT_TIMEOUT_MS = "1000";
    try {
      const budgeted = createStatementBudget();
      await budgeted(db, () => new Promise((resolve) => setTimeout(resolve, 600)));
      const second = await budgeted(db, (tx) =>
        tx.execute(sql`select current_setting('statement_timeout') as value`),
      );
      const rows = (second as { rows?: Array<{ value: string }> }).rows ?? [];
      const ms = Number.parseInt(rows[0]?.value ?? "", 10);
      expect(rows[0]?.value).toMatch(/^\d+ms$/);
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(400);

      await new Promise((resolve) => setTimeout(resolve, 450));
      let ran = false;
      await expect(
        budgeted(db, async () => {
          ran = true;
        }),
      ).rejects.toMatchObject({ code: "TIMEOUT", message: VIEW_TOO_LARGE_MESSAGE });
      expect(ran).toBe(false);
    } finally {
      delete process.env.BUSABASE_RECORD_LIST_STATEMENT_TIMEOUT_MS;
    }
  });

  it("turns a statement timeout into 'too many records, add a filter'", async () => {
    const db = await getDb();
    await expect(
      withStatementBudget(db, async () => {
        throw Object.assign(new Error("canceling statement due to statement timeout"), {
          code: "57014",
        });
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", message: VIEW_TOO_LARGE_MESSAGE });
  });

  it("answers 422, not 408: a browser replays a 408 by itself", async () => {
    const db = await getDb();
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });
    // Both ways it can time out: the statement itself, and a deadline already gone.
    await expect(
      withStatementBudget(db, async () => {
        throw timeout;
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", status: 422 });
    await expect(withStatementBudget(db, async () => {}, Date.now() - 1)).rejects.toMatchObject({
      code: "TIMEOUT",
      status: 422,
    });
  });
});
