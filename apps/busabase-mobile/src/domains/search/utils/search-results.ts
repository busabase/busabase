import type { SearchTab, SearchTabDefinition, SearchTabOption } from "../types/search";

export const SEARCH_DEBOUNCE_MS = 180;
export const SEARCH_PAGE_SIZE = 20;

export const SEARCH_TABS: readonly SearchTabDefinition[] = [
  { value: "recent", label: "Recent", kind: null },
  { value: "all", label: "All", kind: null },
  { value: "records", label: "Records", kind: "record" },
  { value: "files", label: "Files", kind: "file" },
  { value: "change_requests", label: "Change requests", kind: "change_request" },
];

export const normalizeSearchText = (value: string) => value.trim().toLowerCase();

/**
 * Tab badges.
 *
 * Only the ACTIVE tab carries a number, and only the number it actually
 * fetched. Every tab is its own scoped request now, so the others have not been
 * asked — and deriving their counts from the active tab's page is precisely the
 * arithmetic that used to report "0 files" against a workspace that had them.
 *
 * `hasMore` renders the number as a floor ("20+"): a full page is a page size,
 * not a total, and a badge is read as a total.
 *
 * Recent is exempt: it is the local visited-node cache, already complete.
 */
export const getSearchTabOptions = ({
  activeTab,
  count,
  hasMore,
  recentCount,
}: {
  activeTab: SearchTab;
  count: number;
  hasMore: boolean;
  recentCount: number;
}): SearchTabOption[] =>
  SEARCH_TABS.map(({ value, label }) => {
    if (value === "recent") {
      return { value, label, meta: recentCount > 0 ? recentCount : undefined };
    }
    if (value !== activeTab || count === 0) return { value, label };
    return { value, label, meta: hasMore ? `${count}+` : `${count}` };
  });
