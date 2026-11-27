export const DEFAULT_RECORD_PAGE = 1;
export const DEFAULT_RECORD_PAGE_SIZE = 50;
/** Choices shown on a Base table or gallery. The last one is the API maximum. */
export const RECORD_PAGE_SIZES = [25, 50, 100, 200, 500, 1000] as const;
export type RecordPageSize = (typeof RECORD_PAGE_SIZES)[number];

export interface RecordPaginationUrlState {
  page: number;
  pageSize: RecordPageSize;
}

export const isRecordPageSize = (value: number): value is RecordPageSize =>
  (RECORD_PAGE_SIZES as readonly number[]).includes(value);

const parsePositiveInteger = (value: string | null): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

/** A supported `recordPageSize` query value, or null when the URL does not set one. */
export const explicitRecordPageSize = (search: string): RecordPageSize | null => {
  const requested = parsePositiveInteger(new URLSearchParams(search).get("recordPageSize"));
  return requested !== null && isRecordPageSize(requested) ? requested : null;
};

export const readRecordPagination = (search: string): RecordPaginationUrlState => {
  const page =
    parsePositiveInteger(new URLSearchParams(search).get("recordPage")) ?? DEFAULT_RECORD_PAGE;
  return { page, pageSize: explicitRecordPageSize(search) ?? DEFAULT_RECORD_PAGE_SIZE };
};

/**
 * URL wins when it names a supported size. Otherwise the size this Base last
 * used in this browser is kept. An unsupported query value does not wipe that
 * memory; it falls through to it, then to the default.
 */
export const resolveRecordPagination = (
  search: string,
  rememberedPageSize: RecordPageSize | null,
): RecordPaginationUrlState => {
  const fromUrl = readRecordPagination(search);
  return {
    page: fromUrl.page,
    pageSize: explicitRecordPageSize(search) ?? rememberedPageSize ?? DEFAULT_RECORD_PAGE_SIZE,
  };
};

export const writeRecordPagination = (search: string, state: RecordPaginationUrlState): string => {
  const params = new URLSearchParams(search);
  params.set("recordPage", String(Math.max(DEFAULT_RECORD_PAGE, Math.trunc(state.page))));
  params.set("recordPageSize", String(state.pageSize));
  return params.toString();
};
