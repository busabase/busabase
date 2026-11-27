import { isRecordPageSize, type RecordPageSize } from "./record-pagination-url";

/**
 * The last rows-per-page choice for one Base, in this browser.
 *
 * The URL (`recordPageSize`) is still what a link and the Back button use.
 * This remembers the choice after that query is gone — opening the Base from
 * the sidebar would otherwise snap back to 50. It is local to the workspace
 * and the signed-in person, the same split the collection state already uses,
 * so two people on one browser do not share a setting.
 *
 * `localStorage`, not the saved View: a page size is how this person is
 * reading, and changing it should not open a change request or rewrite the
 * view for everyone else.
 */
const KEY_PREFIX = "busabase.base.recordPageSize.v1";

export const recordPageSizePreferenceKey = (scope: string, baseId: string): string =>
  `${KEY_PREFIX}:${scope}:${baseId}`;

export const readRememberedRecordPageSize = (
  scope: string,
  baseId: string,
): RecordPageSize | null => {
  try {
    const raw = window.localStorage.getItem(recordPageSizePreferenceKey(scope, baseId));
    if (!raw || !/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return isRecordPageSize(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const rememberRecordPageSize = (
  scope: string,
  baseId: string,
  pageSize: RecordPageSize,
): void => {
  try {
    window.localStorage.setItem(recordPageSizePreferenceKey(scope, baseId), String(pageSize));
  } catch {
    // The URL still carries the choice for this visit. Only the next visit
    // without a query parameter loses it.
  }
};
