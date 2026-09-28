import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { RecordVO, ViewConfigVO } from "busabase-contract/types";
import { applyViewConfigToRecords } from "busabase-core/domains/base/utils/view-records";
import { isMissingRouteError } from "~/api/mobile-api-compat";

export const RECORDS_PAGE_SIZE = 50;

export interface RecordsPage {
  records: RecordVO[];
  nextCursor: string | null;
}

export const scopeRecordsPageToBase = (
  page: RecordsPage | RecordVO[],
  baseId: string,
): RecordsPage | RecordVO[] =>
  Array.isArray(page)
    ? page.filter((record) => record.baseId === baseId)
    : { ...page, records: page.records.filter((record) => record.baseId === baseId) };

const legacyOffset = (pageParam?: string) => {
  if (!pageParam?.startsWith("legacy:")) return 0;
  const offset = Number.parseInt(pageParam.slice("legacy:".length), 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
};

const sliceLegacyPage = (records: RecordVO[], pageParam?: string): RecordsPage => {
  const offset = legacyOffset(pageParam);
  const nextOffset = offset + RECORDS_PAGE_SIZE;
  return {
    records: records.slice(offset, nextOffset),
    nextCursor: nextOffset < records.length ? `legacy:${nextOffset}` : null,
  };
};

/** Keep mobile bounded when talking to older or demo servers that return the full collection. */
export const normalizeRecordsPage = (
  page: RecordsPage | RecordVO[],
  pageParam?: string,
): RecordsPage => {
  if (Array.isArray(page)) return sliceLegacyPage(page, pageParam);
  if (page.records.length > RECORDS_PAGE_SIZE && page.nextCursor === null) {
    return sliceLegacyPage(page.records, pageParam);
  }
  return page;
};

/** The two record listings this screen can use, narrowed off the real client. */
export interface RecordPagingClient {
  listPage: (input: {
    baseId: string;
    viewId?: string;
    page: number;
    pageSize: number;
  }) => Promise<{ records: RecordVO[]; total: number; totalPages: number; page: number }>;
  list: (input: {
    baseId: string;
    cursor?: string;
    limit: number;
  }) => Promise<RecordsPage | RecordVO[]>;
}

/**
 * The real client must satisfy that shape — same guard as `inbox-paging`.
 */
type RealRecordClient = BusabaseORPCClient["records"];
type _RecordClientMatchesContract = RealRecordClient extends RecordPagingClient ? true : never;
const _recordClientMatchesContract: _RecordClientMatchesContract = true;

export type RecordPageParam = { kind: "page"; page: number } | { kind: "cursor"; cursor?: string };

export const FIRST_RECORD_PAGE: RecordPageParam = { kind: "page", page: 1 };

export type RecordPage =
  | { mode: "view"; records: RecordVO[]; page: number; totalPages: number; total: number }
  | { mode: "legacy"; records: RecordVO[]; nextCursor: string | null };

/**
 * One page of a Base's records, filtered and sorted by the SERVER when a saved
 * View is active.
 *
 * The bug this replaces: the screen fetched an unfiltered cursor page and then
 * applied the View on this side. `records.list` is explicit that its `filters`
 * are "a best-effort SUPERSET" and that a caller "must NOT trust `limit`
 * alongside them" — and the screen sent no filters at all, so the server had no
 * idea a View was in play. A View matching a handful of older records therefore
 * had its matches sitting outside the first page, and narrowing that page on
 * the client produced an EMPTY screen.
 *
 * Measured against a running server: a Base of 95 records with a View matching
 * 5 of them returned 50 rows for page 1, of which the client kept 0. Asked with
 * `viewId`, the server answered `total: 5` and returned all five.
 *
 * `listPage` is the authoritative surface — its own description says the View
 * is "authoritatively filtered and sorted before total and page slicing are
 * calculated" — so with a View active it is the only correct call.
 */
export const fetchRecordPage = async (
  client: RecordPagingClient,
  baseId: string,
  viewId: string | null,
  pageParam: RecordPageParam,
): Promise<RecordPage> => {
  if (pageParam.kind === "page") {
    try {
      const page = await client.listPage({
        baseId,
        ...(viewId ? { viewId } : {}),
        page: pageParam.page,
        pageSize: RECORDS_PAGE_SIZE,
      });
      return {
        mode: "view",
        records: page.records,
        page: page.page,
        totalPages: page.totalPages,
        total: page.total,
      };
    } catch (caught) {
      // `listPage` takes a baseId, so a NOT_FOUND from it is ambiguous between
      // "no such Base" and "this server predates the route" — the same
      // ambiguity `getAgentPrompts` has. Both want the same thing here: fall
      // back to the listing every server has. A genuinely missing Base fails
      // again on the next call and surfaces then.
      if (!isMissingRouteError(caught)) throw caught;
    }
  }

  const cursor = pageParam.kind === "cursor" ? pageParam.cursor : undefined;
  const raw = await client.list({
    baseId,
    ...(cursor ? { cursor } : {}),
    limit: RECORDS_PAGE_SIZE,
  });
  // Same normalisation the cursor path has always needed: an older or demo
  // server can answer with the WHOLE collection and no cursor, and this screen
  // must stay bounded either way.
  const page = normalizeRecordsPage(raw, cursor);
  return { mode: "legacy", records: page.records, nextCursor: page.nextCursor };
};

export const nextRecordPageParam = (lastPage: RecordPage): RecordPageParam | undefined => {
  if (lastPage.mode === "view") {
    return lastPage.page < lastPage.totalPages
      ? { kind: "page", page: lastPage.page + 1 }
      : undefined;
  }
  return lastPage.nextCursor ? { kind: "cursor", cursor: lastPage.nextCursor } : undefined;
};

/**
 * The records to render.
 *
 * On the authoritative path the server already applied the View, so re-running
 * the client matcher would at best be a no-op and at worst disagree with the
 * paging the server just computed. Only the legacy path — an older server that
 * cannot filter by View — still narrows here, which is exactly what this screen
 * used to do for every server.
 *
 * That narrowing is the SERVER's own function, not a copy of it. The copy this
 * replaced compared raw stored values and so never matched a select field: a
 * record stores the choice id ("d") while a View filters by the choice name
 * ("Won"). The server resolves both sides through the field's choices first;
 * reusing its function is the only way the two cannot drift apart again.
 */
export const recordsForDisplay = (
  pages: RecordPage[],
  viewConfig: ViewConfigVO | null | undefined,
): RecordVO[] => {
  const records = pages.flatMap((page) => page.records);
  const anyLegacy = pages.some((page) => page.mode === "legacy");
  return anyLegacy ? applyViewConfigToRecords(records, viewConfig ?? undefined) : records;
};

/**
 * How many records the Base (or the active View) actually holds, or `null` when
 * this server cannot say.
 *
 * The header used to caption itself with `records.length` — the number LOADED.
 * On a Base of 95 that reads "RECORDS 50", which is not a page indicator, it is
 * a wrong answer to "how big is this table". `listPage` returns the real total
 * alongside the page, so on the authoritative path there is no need to guess.
 *
 * The legacy path genuinely does not know: a cursor listing reports no total.
 * It returns `null` so the caller can say nothing rather than say something
 * false.
 */
export const recordTotalFromPages = (pages: RecordPage[]): number | null => {
  const last = pages.at(-1);
  return last?.mode === "view" ? last.total : null;
};

/**
 * "5" once everything is on screen, "50 of 95" while more is still coming.
 *
 * Never a bare loaded-count: on a Base of 95 that reads "RECORDS 50", which
 * answers "how big is this table" with the page size.
 */
export const recordCountCaption = (loaded: number, total?: number | null): string => {
  if (typeof total !== "number") return `${loaded}`;
  return loaded < total ? `${loaded} of ${total}` : `${total}`;
};
