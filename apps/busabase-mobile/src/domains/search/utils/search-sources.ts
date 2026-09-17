import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { SearchResultVO } from "busabase-contract/types";
import type { SearchTab } from "../types/search";

/**
 * The content sources `search()` can be scoped to.
 *
 * Declared here rather than imported: the contract's list is a local `const` in
 * `contract/schemas.ts` and is not exported. The assertion below pins it, so
 * renaming a source there fails this build instead of silently producing a
 * request the server ignores.
 */
export const SEARCH_SOURCES = ["records", "files", "names", "nodes"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

type ContractSearchInput = NonNullable<Parameters<BusabaseORPCClient["search"]>[0]>;
type _SourcesMatchContract = SearchSource[] extends NonNullable<ContractSearchInput["sources"]>
  ? true
  : never;
const _sourcesMatchContract: _SourcesMatchContract = true;

/**
 * What each tab ASKS THE SERVER FOR, as one request per group.
 *
 * The bug this replaces: every tab was served from a single unscoped call, and
 * `search()` applies its `limit` per source then slices the concatenation with
 * records FIRST. In a record-heavy workspace that returns 20 records and
 * nothing else — so the Files tab, which filtered that page down to
 * `kind === "file"`, rendered "nothing found" while the server had matching
 * files the whole time. Measured on a seeded space: the combined call returned
 * 10 records + 10 change requests, while `sources: ["files"]` returned a file
 * and `sources: ["names"]` returned a Base.
 *
 * `all` is two groups rather than one so that records — which always dominate a
 * shared budget — cannot crowd out Bases, files and Doc bodies. Each group gets
 * its own `limit`.
 */
const TAB_SOURCE_GROUPS: Record<Exclude<SearchTab, "recent">, SearchSource[][]> = {
  all: [["records"], ["names", "files", "nodes"]],
  records: [["records"]],
  files: [["files"]],
  // Change requests come back from the records source alongside the records
  // themselves; there is no separate source for them.
  change_requests: [["records"]],
};

export const sourceGroupsForTab = (tab: SearchTab): SearchSource[][] =>
  tab === "recent" ? [] : TAB_SOURCE_GROUPS[tab];

/**
 * The kinds a tab keeps once its own scoped results are in.
 *
 * Still needed after scoping because `sources: ["records"]` answers with both
 * `record` and `change_request` rows. `null` means "keep everything this tab's
 * sources returned".
 */
const TAB_KINDS: Record<Exclude<SearchTab, "recent">, SearchResultVO["kind"][] | null> = {
  // Unchanged from the tab version: "all" is every kind EXCEPT change requests,
  // which have their own tab.
  all: ["record", "base", "file", "node"],
  records: ["record"],
  files: ["file"],
  change_requests: ["change_request"],
};

export const keepKindsForTab = (
  tab: SearchTab,
  results: readonly SearchResultVO[],
): SearchResultVO[] => {
  if (tab === "recent") return [...results];
  const kinds = TAB_KINDS[tab];
  return kinds ? results.filter((result) => kinds.includes(result.kind)) : [...results];
};

export interface SearchGroupResponse {
  results: SearchResultVO[];
  hasMore: boolean;
  contentTruncated: boolean;
}

export interface TabResults {
  results: SearchResultVO[];
  /** Any group has another page — the tab's count is therefore a floor. */
  hasMore: boolean;
  /**
   * At least one node's content was indexed only up to the projection cap, so
   * this search could not see all of it.
   *
   * Surfaced rather than swallowed: the contract adds this precisely so that
   * "no results" can be told apart from "we did not look at all of it", and
   * says clients should show it.
   */
  contentTruncated: boolean;
}

/**
 * Merge a tab's groups, in group order.
 *
 * Deliberately NOT re-sorted across groups. `relevance` means "let each source
 * use the ranking it has" — a record's full-text rank and a file's recency are
 * not comparable numbers, so interleaving them by any shared key would invent
 * an ordering the server never claimed. Group order (records first, then the
 * rest) keeps each source's own ranking intact.
 */
export const mergeTabResults = (tab: SearchTab, groups: SearchGroupResponse[]): TabResults => {
  const seen = new Set<string>();
  const results: SearchResultVO[] = [];
  for (const group of groups) {
    for (const result of keepKindsForTab(tab, group.results)) {
      const key = `${result.kind}:${result.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    }
  }
  return {
    results,
    hasMore: groups.some((group) => group.hasMore),
    contentTruncated: groups.some((group) => group.contentTruncated),
  };
};

/**
 * The badge for the tab currently on screen.
 *
 * Only that tab has real numbers: each tab is now its own scoped request, so
 * the others have not been asked. Showing a number for them would mean going
 * back to deriving every count from one shared page — exactly the arithmetic
 * that reported "0 files" against a workspace that had them.
 *
 * `hasMore` turns the number into a floor ("20+"), because a full page is a
 * page size, not a total.
 */
export const tabBadge = ({
  count,
  hasMore,
}: {
  count: number;
  hasMore: boolean;
}): string | undefined => {
  if (count === 0) return undefined;
  return hasMore ? `${count}+` : `${count}`;
};
