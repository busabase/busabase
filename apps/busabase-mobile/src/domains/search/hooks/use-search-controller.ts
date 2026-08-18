import { skipToken, useQuery } from "@tanstack/react-query";
import { NODE_TYPES, type NodeType } from "busabase-contract/domains";
import type { SearchResultVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useKnownNodeCache } from "~/domains/workspace/hooks/use-known-node-cache";
import {
  findKnownNodeByTypeAndSlug,
  type KnownNode,
  nodeSearchResultToKnownNode,
} from "~/domains/workspace/utils/known-node-cache";
import { getMobileNodeDestination } from "~/domains/workspace/utils/node-navigation";
import type { SearchTab } from "../types/search";
import {
  filterSearchResults,
  getSearchTabOptions,
  normalizeSearchText,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PAGE_SIZE,
} from "../utils/search-results";
import { useRecentNodeResults } from "./use-recent-node-results";

export const useSearchController = () => {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("recent");
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = normalizeSearchText(query);
  const hasQuery = normalizedQuery.length > 0;
  const normalizedDebouncedQuery = normalizeSearchText(debouncedQuery);
  const isDebouncedQueryCurrent = normalizedDebouncedQuery === normalizedQuery;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setLimit(SEARCH_PAGE_SIZE);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery(
    buda
      ? {
          ...buda.orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
          enabled: tab !== "recent" && normalizedDebouncedQuery.length > 0,
        }
      : { queryKey: ["no-connection", "search"], queryFn: skipToken },
  );
  const recent = useRecentNodeResults({
    buda,
    debouncedQuery,
    hasQuery,
    isDebouncedQueryCurrent,
    nodeCache,
    normalizedDebouncedQuery,
    query,
    selected: tab === "recent",
  });
  const allResults = searchQuery.data?.results ?? [];
  const contentResults = useMemo(() => filterSearchResults(allResults, tab), [allResults, tab]);
  const tabOptions = useMemo(
    () => getSearchTabOptions(allResults, recent.results.length),
    [allResults, recent.results.length],
  );

  const openKnownNode = useCallback(
    async (node: KnownNode) => {
      const destination = getMobileNodeDestination(node);
      if (destination.status === "unsupported") {
        setError(destination.message);
        return;
      }
      await nodeCache?.merge([node]);
      await nodeCache?.markVisited(node.id);
      router.push({ pathname: destination.pathname, params: destination.params } as never);
    },
    [nodeCache, router],
  );
  const resolveKnownNode = useCallback(
    async (type: NodeType, slug: string): Promise<KnownNode | undefined> => {
      const cachedNode = nodeCache
        ? findKnownNodeByTypeAndSlug(await nodeCache.list(), type, slug)
        : undefined;
      if (cachedNode || !buda) return cachedNode;
      try {
        const matches = await buda.client.nodes.searchByName({
          query: slug,
          limit: SEARCH_PAGE_SIZE,
        });
        const match = matches.find((node) => node.type === type && node.slug === slug);
        return match ? nodeSearchResultToKnownNode(match) : undefined;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Couldn't resolve this node.");
        return undefined;
      }
    },
    [buda, nodeCache],
  );
  const openResult = useCallback(
    async (result: SearchResultVO) => {
      if (result.kind === "record") {
        router.push({ pathname: "/records/[id]", params: { id: result.id } });
      } else if (result.kind === "change_request") {
        router.push({ pathname: "/change-requests/[id]", params: { id: result.id } });
      } else if (result.kind === "base") {
        const slug = result.href.split("/").filter(Boolean).pop() ?? result.id;
        const node = await resolveKnownNode("base", slug);
        if (node) await openKnownNode(node);
        else router.push({ pathname: "/base/[slug]", params: { slug } });
      } else {
        const [kind, slug] = result.href.split("/").filter(Boolean);
        const nodeType = NODE_TYPES.find((type) => type === kind);
        if (nodeType && slug) {
          const node = await resolveKnownNode(nodeType, slug);
          if (node) await openKnownNode(node);
          else setError("This search result's node is no longer available.");
        } else if (kind === "assets" && slug) {
          router.push({ pathname: "/asset/[id]", params: { id: slug } });
        } else {
          router.push("/drawer/assets");
        }
      }
    },
    [openKnownNode, resolveKnownNode, router],
  );

  const activeQueryError = tab === "recent" ? recent.error : searchQuery.error;
  const searchErrorMessage = activeQueryError
    ? activeQueryError instanceof Error
      ? activeQueryError.message
      : "Search failed"
    : null;
  const displayedError = error ?? searchErrorMessage;
  const resetError = useCallback(() => {
    setError(null);
    if (!searchErrorMessage) return;
    if (tab === "recent") void recent.refetch();
    else void searchQuery.refetch();
  }, [recent.refetch, searchErrorMessage, searchQuery.refetch, tab]);
  const searching = tab === "recent" ? recent.searching : searchQuery.isFetching;

  return {
    contentResults,
    displayedError,
    hasMore: searchQuery.data?.hasMore ?? false,
    hasQuery,
    query,
    recentResults: recent.results,
    searching,
    tab,
    tabOptions,
    loadMore: () => setLimit((current) => current + SEARCH_PAGE_SIZE),
    openKnownNode,
    openResult,
    resetError,
    setQuery,
    setTab,
  };
};

export type SearchController = ReturnType<typeof useSearchController>;
