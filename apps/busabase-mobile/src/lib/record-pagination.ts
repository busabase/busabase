import type { RecordVO } from "busabase-contract/types";

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
