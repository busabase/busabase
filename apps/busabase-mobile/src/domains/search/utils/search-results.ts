import type { SearchResultVO } from "busabase-contract/types";
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

export const filterSearchResults = (
  results: readonly SearchResultVO[],
  tab: SearchTab,
): SearchResultVO[] => {
  if (tab === "all") return results.filter((result) => result.kind !== "change_request");
  const kind = SEARCH_TABS.find((definition) => definition.value === tab)?.kind;
  return kind ? results.filter((result) => result.kind === kind) : [...results];
};

export const getSearchTabOptions = (
  results: readonly SearchResultVO[],
  recentCount: number,
): SearchTabOption[] =>
  SEARCH_TABS.map(({ value, label, kind }) => {
    const count =
      value === "recent"
        ? recentCount
        : value === "all"
          ? results.filter((result) => result.kind !== "change_request").length
          : kind
            ? results.filter((result) => result.kind === kind).length
            : 0;
    return { value, label, meta: count > 0 ? count : undefined };
  });
