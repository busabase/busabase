import { skipToken, useQuery } from "@tanstack/react-query";
import type { NodeSearchResultVO } from "busabase-contract/types";
import { useEffect, useState } from "react";
import type { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import type { KnownNode, KnownNodeCache } from "~/domains/workspace/utils/known-node-cache";
import { nodeSearchResultToKnownNode } from "~/domains/workspace/utils/known-node-cache";
import { SEARCH_PAGE_SIZE } from "../utils/search-results";

interface RecentLocalState {
  cache: KnownNodeCache | null;
  ready: boolean;
  results: KnownNode[];
}

interface UseRecentNodeResultsOptions {
  buda: ReturnType<typeof useBusabaseOrpc>;
  debouncedQuery: string;
  hasQuery: boolean;
  isDebouncedQueryCurrent: boolean;
  nodeCache: KnownNodeCache | null;
  normalizedDebouncedQuery: string;
  query: string;
  selected: boolean;
}

export const useRecentNodeResults = ({
  buda,
  debouncedQuery,
  hasQuery,
  isDebouncedQueryCurrent,
  nodeCache,
  normalizedDebouncedQuery,
  query,
  selected,
}: UseRecentNodeResultsOptions) => {
  const [localState, setLocalState] = useState<RecentLocalState>({
    cache: null,
    ready: false,
    results: [],
  });

  useEffect(() => {
    let cancelled = false;
    let readVersion = 0;
    setLocalState({ cache: nodeCache, ready: false, results: [] });
    if (!nodeCache) {
      setLocalState({ cache: null, ready: true, results: [] });
      return;
    }
    const read = () => {
      const currentRead = ++readVersion;
      const result = hasQuery ? nodeCache.fuzzyMatch(query) : nodeCache.listVisited();
      void result.then((results) => {
        if (cancelled || currentRead !== readVersion) return;
        setLocalState({ cache: nodeCache, ready: true, results });
      });
    };
    read();
    const unsubscribe = nodeCache.subscribe(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hasQuery, nodeCache, query]);

  const cacheIsCurrent = localState.cache === nodeCache;
  const cacheReady = cacheIsCurrent && localState.ready;
  const localResults = cacheIsCurrent ? localState.results : [];
  const usesNetworkFallback = selected && hasQuery && cacheReady && localResults.length === 0;
  const networkQuery = useQuery(
    buda
      ? {
          ...buda.orpc.nodes.searchByName.queryOptions({
            input: { query: debouncedQuery, limit: SEARCH_PAGE_SIZE },
          }),
          enabled:
            usesNetworkFallback && normalizedDebouncedQuery.length > 0 && isDebouncedQueryCurrent,
        }
      : { queryKey: ["no-connection", "node-search"], queryFn: skipToken },
  );
  const networkResults: NodeSearchResultVO[] = isDebouncedQueryCurrent
    ? (networkQuery.data ?? [])
    : [];

  useEffect(() => {
    if (!nodeCache || networkResults.length === 0) return;
    void nodeCache.merge(networkResults.map(nodeSearchResultToKnownNode));
  }, [nodeCache, networkResults]);

  return {
    error: networkQuery.error,
    refetch: networkQuery.refetch,
    results: usesNetworkFallback ? networkResults.map(nodeSearchResultToKnownNode) : localResults,
    searching:
      !cacheReady || (usesNetworkFallback && (!isDebouncedQueryCurrent || networkQuery.isFetching)),
  };
};
