/**
 * `--all`: follow the cursor to the end instead of making the caller loop.
 *
 * Every listing in this CLI is bounded — that is the point of the `limit` work —
 * but "bounded" moves the burden onto the caller, who now has to notice
 * `nextCursor`, thread it back in, and know when to stop. An agent that misses
 * that reports a truncated answer as the whole answer, which is the failure the
 * `record_query` task guidance warns about in prose. This does it in code.
 *
 * Rows stream out as NDJSON — one JSON object per line — rather than
 * accumulating into one array, so memory stays flat and a consumer can start
 * work on page 1 while page 9 is still in flight. That is why `--all` overrides
 * `--output`: a 40,000-row table is not a thing anyone wanted.
 */

import { asEnvelope } from "./format.js";

/** Where one page's rows live, and how to ask for the next one. */
export interface Page {
  rows: unknown[];
  /** Cursor for the following page, or null at the end. */
  nextCursor: string | null;
}

/**
 * Read a page out of whatever the command returned.
 *
 * Two protocols exist and both are honoured. Most paginated endpoints return
 * `{ rows, nextCursor }`. `GET /assets` returns a bare array and pages by the
 * last row's `id`, with a short page meaning the end — a shape chosen there to
 * keep the response backwards compatible for the web and mobile clients.
 */
export function readPage(result: unknown, limit: number | undefined): Page | undefined {
  const envelope = asEnvelope(result);
  if (envelope) {
    const cursor = envelope.meta.find(([key]) => key === "nextCursor")?.[1];
    if (cursor === undefined) return undefined;
    return { rows: envelope.rows, nextCursor: typeof cursor === "string" ? cursor : null };
  }
  if (!Array.isArray(result)) return undefined;
  // Bare array: only pageable when the caller asked for a bounded page, and
  // only continues while pages come back full.
  if (limit === undefined || result.length < limit) return { rows: result, nextCursor: null };
  const last = result[result.length - 1];
  const id = (last as { id?: unknown })?.id;
  return { rows: result, nextCursor: typeof id === "string" ? id : null };
}

export interface PaginateOptions {
  /** Runs one page with the given cursor (undefined for the first). */
  fetchPage: (cursor: string | undefined) => Promise<unknown>;
  limit: number | undefined;
  maxItems: number | undefined;
  write: (line: string) => void;
  notify: (message: string) => void;
}

/** Stops a broken server or a cursor that never advances from looping forever. */
const MAX_PAGES = 10_000;

/**
 * Stream every page as NDJSON. Returns the number of rows written.
 *
 * A cap that truncates is always announced on stderr: a silently short answer
 * that looks complete is the exact failure this is meant to prevent.
 */
export async function paginateAll(options: PaginateOptions): Promise<number> {
  const { fetchPage, limit, maxItems, write, notify } = options;
  let cursor: string | undefined;
  let written = 0;
  let seen = 0;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const result = await fetchPage(cursor);
    const page = readPage(result, limit);
    if (!page) {
      // Not a paginated shape at all — emit it once and stop, rather than
      // pretending `--all` did something.
      write(JSON.stringify(result));
      return 1;
    }
    seen += page.rows.length;
    for (const row of page.rows) {
      if (maxItems !== undefined && written >= maxItems) {
        notify(
          `[busabase-cli] --max-items ${maxItems} reached; stopped early with more rows available.`,
        );
        return written;
      }
      write(JSON.stringify(row));
      written += 1;
    }
    if (!page.nextCursor) return written;
    if (page.nextCursor === cursor) {
      notify("[busabase-cli] the server returned the same cursor twice; stopping to avoid a loop.");
      return written;
    }
    cursor = page.nextCursor;
  }
  notify(`[busabase-cli] stopped after ${MAX_PAGES} pages (${seen} rows scanned).`);
  return written;
}
