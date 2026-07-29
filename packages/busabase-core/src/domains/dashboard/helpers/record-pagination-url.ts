export const DEFAULT_RECORD_PAGE = 1;
export const DEFAULT_RECORD_PAGE_SIZE = 50;
export const RECORD_PAGE_SIZES = [25, 50, 100] as const;

export interface RecordPaginationUrlState {
  page: number;
  pageSize: (typeof RECORD_PAGE_SIZES)[number];
}

const parsePositiveInteger = (value: string | null): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const readRecordPagination = (search: string): RecordPaginationUrlState => {
  const params = new URLSearchParams(search);
  const page = parsePositiveInteger(params.get("recordPage")) ?? DEFAULT_RECORD_PAGE;
  const requestedPageSize = parsePositiveInteger(params.get("recordPageSize"));
  const pageSize = RECORD_PAGE_SIZES.includes(
    requestedPageSize as (typeof RECORD_PAGE_SIZES)[number],
  )
    ? (requestedPageSize as (typeof RECORD_PAGE_SIZES)[number])
    : DEFAULT_RECORD_PAGE_SIZE;
  return { page, pageSize };
};

export const writeRecordPagination = (search: string, state: RecordPaginationUrlState): string => {
  const params = new URLSearchParams(search);
  params.set("recordPage", String(Math.max(DEFAULT_RECORD_PAGE, Math.trunc(state.page))));
  params.set("recordPageSize", String(state.pageSize));
  return params.toString();
};
