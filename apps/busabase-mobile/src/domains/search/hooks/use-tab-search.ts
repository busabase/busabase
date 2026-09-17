import { useQuery } from "@tanstack/react-query";
import type { BusabaseORPCClient } from "busabase-contract/api-client/react-query";
import type { SearchTab } from "../types/search";
import {
  mergeTabResults,
  type SearchGroupResponse,
  type SearchSource,
  sourceGroupsForTab,
  type TabResults,
} from "../utils/search-sources";

const EMPTY: TabResults = { results: [], hasMore: false, contentTruncated: false };

interface UseTabSearchOptions {
  client: BusabaseORPCClient | null;
  /** Scopes the cache key, so switching space cannot show the previous one's hits. */
  spaceScope: string | undefined;
  query: string;
  tab: SearchTab;
  limit: number;
  enabled: boolean;
}

/**
 * One tab's results, asked for per source group.
 *
 * Each group is its own request with its own `limit`, because `search()` gives
 * every source that limit and then slices the concatenation records-first — so
 * a single shared call returns records and nothing else in any workspace that
 * has plenty of them.
 */
export function useTabSearch({
  client,
  spaceScope,
  query,
  tab,
  limit,
  enabled,
}: UseTabSearchOptions) {
  const groups = sourceGroupsForTab(tab);

  const search = useQuery({
    queryKey: ["tab-search", spaceScope ?? "no-connection", tab, query, limit],
    enabled: enabled && !!client && groups.length > 0 && query.length > 0,
    queryFn: async (): Promise<TabResults> => {
      if (!client) throw new Error("Not connected");
      const responses = await Promise.all(
        groups.map(async (sources: SearchSource[]): Promise<SearchGroupResponse> => {
          const response = await client.search({ query, limit, offset: 0, sources });
          return {
            results: response.results,
            hasMore: response.hasMore,
            // Older servers omit it; the contract defaults it to false.
            contentTruncated: response.contentTruncated ?? false,
          };
        }),
      );
      return mergeTabResults(tab, responses);
    },
  });

  return {
    ...(search.data ?? EMPTY),
    error: search.error,
    refetch: () => void search.refetch(),
    searching: search.isFetching,
  };
}
