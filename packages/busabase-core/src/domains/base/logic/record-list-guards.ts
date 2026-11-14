/**
 * Limits that keep one record read bounded however large a Base grows. Every
 * Base view reads through `records.listPage`, `records.count` and
 * `records.groupBy`, so these are the places a 100M-record Base would
 * otherwise turn one request into minutes of work or an out-of-memory server.
 *
 * - Each SQL scope whose cost grows with the Base runs under a statement
 *   timeout, and a timeout reaches the reader as "too many records, add a
 *   filter" instead of a request that never returns.
 * - A page's `total` is counted exactly up to EXACT_COUNT_LIMIT and reported
 *   as a lower bound past it.
 * - Numbered pages reach PAGE_DEPTH_LIMIT records; deeper ones need a filter
 *   or a sort.
 * - Filters and sorts SQL cannot decide are evaluated in process over at most
 *   EVALUATION_LIMIT rows.
 */
import { ORPCError } from "@orpc/server";
import {
  RECORD_EXACT_COUNT_LIMIT,
  RECORD_PAGE_DEPTH_LIMIT,
} from "busabase-contract/domains/base/contract/record-schemas";
import { and, count, type SQL, sql } from "drizzle-orm";
import { runWithSearchDatabase } from "../../../context";
import type { getDb } from "../../../db";
import { busabaseRecords } from "../../../db/schema";
import { isStatementTimeout } from "../../../logic/search-execution";

type Db = Awaited<ReturnType<typeof getDb>>;

export const EXACT_COUNT_LIMIT = RECORD_EXACT_COUNT_LIMIT;
export const PAGE_DEPTH_LIMIT = RECORD_PAGE_DEPTH_LIMIT;
export const EVALUATION_LIMIT = 1_000_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

// Thrown as TIMEOUT or BAD_REQUEST; localized by this exact text in
// i18n/localize-error.ts.
export const VIEW_TOO_LARGE_MESSAGE =
  "This view has too many records to work through. Add a filter to narrow it, then try again.";

/**
 * The statement-timeout error keeps its TIMEOUT code but not oRPC's default
 * HTTP status for it, 408: browsers replay a 408 on their own, so one page view
 * ran the 15 s query twice (31 s to show the message), and React Query's
 * retries made it six. Retrying cannot help — the view is just too large — so
 * 422: well-formed, but not something this request can be answered within.
 */
const viewTooLargeTimeout = () =>
  new ORPCError("TIMEOUT", { status: 422, message: VIEW_TOO_LARGE_MESSAGE });

const statementTimeoutMs = () => {
  const configured = Number(process.env.BUSABASE_RECORD_LIST_STATEMENT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_STATEMENT_TIMEOUT_MS;
};

/**
 * Run SQL under a statement timeout, in one transaction so the setting cannot
 * leak to the pool. Pass the request's deadline (see `createStatementBudget`)
 * so every scope of one request shares one budget. A query the planner gets wrong then stops and frees its
 * connection: a board's `NOT IN` count once ran on for over 12 minutes, one
 * more per visit, until the pool was gone.
 *
 * Only SQL belongs here. Hydration can call host resolvers that need a
 * connection of their own, which a single-connection pool would deadlock on.
 * `getDb()` inside resolves to the transaction. Embedded PGlite ignores
 * `statement_timeout`, so there this bounds nothing.
 */
export const withStatementBudget = async <T>(
  db: Db,
  run: (tx: Db) => Promise<T>,
  deadline = Date.now() + statementTimeoutMs(),
): Promise<T> => {
  const remainingMs = Math.floor(deadline - Date.now());
  if (remainingMs <= 0) {
    throw viewTooLargeTimeout();
  }
  try {
    return await db.transaction(async (tx) => {
      const scoped = tx as unknown as Db;
      await scoped.execute(
        sql`select set_config('statement_timeout', ${String(remainingMs)}, true)`,
      );
      return runWithSearchDatabase(scoped, () => run(scoped));
    });
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw viewTooLargeTimeout();
    }
    throw error;
  }
};

/**
 * One request's database budget: each scope it runs gets only what is left of
 * one deadline, so a request of several steps still stops within the limit.
 */
export const createStatementBudget = () => {
  const deadline = Date.now() + statementTimeoutMs();
  return <T>(db: Db, run: (tx: Db) => Promise<T>) => withStatementBudget(db, run, deadline);
};

export type StatementBudget = ReturnType<typeof createStatementBudget>;

/** `count(*)` that stops at `limit`: its cost never grows past that. */
export const boundedRecordCount = async (db: Db, where: SQL[], limit = EXACT_COUNT_LIMIT) => {
  const limited = db
    .select({ one: sql`1` })
    .from(busabaseRecords)
    .where(and(...where))
    .limit(limit + 1)
    .as("limited");
  const [row] = await db.select({ value: count() }).from(limited);
  const value = row?.value ?? 0;
  return value > limit ? { total: limit, totalCapped: true } : { total: value, totalCapped: false };
};

export type CountedTotal = Awaited<ReturnType<typeof boundedRecordCount>>;

/** The page actually served, never deeper than PAGE_DEPTH_LIMIT records. */
export const pageWindow = (requestedPage: number, pageSize: number, total: number) => {
  const totalPages = Math.ceil(Math.min(total, PAGE_DEPTH_LIMIT) / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  return { page, totalPages, offset: (page - 1) * pageSize, pagesCapped: total > PAGE_DEPTH_LIMIT };
};

export type PageWindow = ReturnType<typeof pageWindow>;

/** The listPage response, flagging a capped total or capped depth only when it happens. */
export const pageResponse = <R>(
  records: R[],
  counted: CountedTotal,
  window: PageWindow,
  pageSize: number,
) => ({
  records,
  total: counted.total,
  totalPages: window.totalPages,
  page: window.page,
  pageSize,
  ...(counted.totalCapped ? { totalCapped: true as const } : {}),
  ...(window.pagesCapped ? { pagesCapped: true as const } : {}),
});

/**
 * Candidate reads ask for one row past EVALUATION_LIMIT; getting it means the
 * view cannot be evaluated in process, and it is refused rather than loaded.
 */
export const EVALUATION_READ_LIMIT = EVALUATION_LIMIT + 1;
export const assertEvaluable = (rows: readonly unknown[]) => {
  if (rows.length > EVALUATION_LIMIT) {
    throw new ORPCError("BAD_REQUEST", { message: VIEW_TOO_LARGE_MESSAGE });
  }
};
