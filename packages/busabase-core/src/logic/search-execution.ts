import "server-only";

import { ORPCError } from "@orpc/server";
import { sql } from "drizzle-orm";
import { runWithSearchDatabase } from "../context";
import type { DbInstance } from "../db";

type SearchStop = "timeout" | "canceled";

function budget(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function stopped(reason: SearchStop) {
  return reason === "canceled"
    ? new ORPCError("CLIENT_CLOSED_REQUEST", { message: "Search canceled." })
    : new ORPCError("TIMEOUT", {
        message: "Search took too long. Narrow the search to a Base or folder and try again.",
      });
}

function isStatementTimeout(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "57014") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function getSearchExecutionOutcome(error: unknown): "timeout" | "canceled" | "failed" {
  if (error instanceof ORPCError) {
    if (error.code === "TIMEOUT") return "timeout";
    if (error.code === "CLIENT_CLOSED_REQUEST") return "canceled";
  }
  return "failed";
}

export interface SearchExecution {
  checkpoint(): void;
  beforeQuery(): Promise<void>;
  /**
   * Budgeted SQL scope: one transaction with a `statement_timeout`. Use for
   * candidate scans whose cost grows with the data. Several sequential
   * statements may share one scope; call `checkpoint()` between them so a
   * later statement never starts past the request deadline.
   * Only database work belongs here; release the connection before host
   * callbacks or file I/O.
   */
  query<T>(callback: (db: DbInstance) => Promise<T>): Promise<T>;
  /**
   * Unbudgeted read on the original database, without a transaction. Only for
   * bounded primary-key / id-list lookups whose cost does not grow with the
   * space, so they do not pay BEGIN + set_config + COMMIT round trips.
   */
  read<T>(callback: (db: DbInstance) => Promise<T>): Promise<T>;
}

/**
 * Search-only budgets, with a transaction reserved only for each explicit SQL
 * scope. Hydration and host callbacks may use the original database, including
 * a single-connection pool, so they must run after that transaction releases.
 * Always await rollback: never race an unfinished query against pool reuse.
 */
export async function withSearchExecution<T>(
  db: DbInstance,
  mode: "quick" | "full",
  signal: AbortSignal | undefined,
  callback: (db: DbInstance, execution: SearchExecution) => Promise<T>,
): Promise<T> {
  const prefix = `BUSABASE_SEARCH_${mode.toUpperCase()}`;
  const statementMs = budget(`${prefix}_STATEMENT_TIMEOUT_MS`, mode === "quick" ? 1_000 : 3_000);
  const requestMs = budget(`${prefix}_REQUEST_TIMEOUT_MS`, mode === "quick" ? 2_000 : 5_000);
  const deadline = Date.now() + requestMs;
  const activeQueries = new Set<Promise<unknown>>();
  let closed = false;
  const checkpoint = () => {
    if (closed) throw stopped("canceled");
    if (signal?.aborted) throw stopped("canceled");
    if (Date.now() >= deadline) throw stopped("timeout");
  };
  const mapError = (error: unknown): never => {
    // Our own checkpoint errors already carry the right code.
    if (error instanceof ORPCError) throw error;
    if (signal?.aborted) throw stopped("canceled");
    // Only a real statement timeout becomes TIMEOUT. Any other failure keeps
    // its original error even past the deadline, so real DB faults are not
    // reported as "search took too long".
    if (isStatementTimeout(error)) throw stopped("timeout");
    throw error;
  };
  const track = async <R>(pending: Promise<R>): Promise<R> => {
    activeQueries.add(pending);
    try {
      return await pending;
    } catch (error) {
      return mapError(error);
    } finally {
      activeQueries.delete(pending);
    }
  };
  const execution: SearchExecution = {
    checkpoint,
    async beforeQuery() {
      checkpoint();
    },
    async query(runQuery) {
      checkpoint();
      const pending = db.transaction(async (tx) => {
        checkpoint();
        // SET LOCAL affects only this SQL scope and cannot leak to the pool.
        const remaining = Math.max(1, Math.min(statementMs, deadline - Date.now()));
        await tx.execute(sql`select set_config('statement_timeout', ${String(remaining)}, true)`);
        checkpoint();
        const result = await runWithSearchDatabase(tx, () => runQuery(tx as unknown as DbInstance));
        // PGLite safely observes cancellation between synchronous statements.
        checkpoint();
        return result;
      });
      return track(pending);
    },
    async read(runQuery) {
      checkpoint();
      const result = await track(runQuery(db));
      checkpoint();
      return result;
    },
  };
  try {
    checkpoint();
    const result = await callback(db, execution);
    checkpoint();
    return result;
  } catch (error) {
    return mapError(error);
  } finally {
    // Promise.all can reject while sibling scopes still run or wait for a
    // connection. Close admission, then await all rollback/commit operations
    // without replacing the request's primary error with sibling cancellation.
    closed = true;
    while (activeQueries.size > 0) {
      await Promise.allSettled([...activeQueries]);
    }
  }
}
