/**
 * The collection URL names the record open in its detail dialog
 * (`/base/crm/grid?record=rec_…`), so the address bar can be copied, refreshed
 * or sent to a colleague and reopen the same dialog over the same view.
 *
 * The param belongs to the page it was written on: it is listed in openlib's
 * `PAGE_LOCAL_SEARCH_PARAMS`, so `SPALink` and `mergeSearchIntoHref` drop it and
 * following any link never carries a dialog into another Base or view.
 */
export const RECORD_PREVIEW_PARAM = "record";

export function readRecordPreviewId(search: string): string | null {
  const recordId = new URLSearchParams(search).get(RECORD_PREVIEW_PARAM)?.trim();
  return recordId || null;
}

export function writeRecordPreviewId(search: string, recordId: string | null): string {
  const params = new URLSearchParams(search);
  if (recordId) params.set(RECORD_PREVIEW_PARAM, recordId);
  else params.delete(RECORD_PREVIEW_PARAM);
  return params.toString();
}
