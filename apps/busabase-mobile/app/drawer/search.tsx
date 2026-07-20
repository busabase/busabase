import { skipToken, useQuery } from "@tanstack/react-query";
import { getNodeType, NODE_TYPES, type NodeType } from "busabase-contract/domains";
import type { NodeSearchResultVO, SearchResultKind, SearchResultVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import {
  AppWindow,
  Bot,
  File,
  FileText,
  Folder,
  GitPullRequest,
  HardDrive,
  Search,
  Sparkles,
  Table2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeChipList,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import {
  findKnownNodeByTypeAndSlug,
  type KnownNode,
  type KnownNodeCache,
  nodeSearchResultToKnownNode,
} from "~/search/known-node-cache";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const kindMeta: Record<SearchResultVO["kind"], { label: string; icon: typeof FileText }> = {
  record: { label: "Record", icon: FileText },
  change_request: { label: "Change request", icon: GitPullRequest },
  base: { label: "Base", icon: Table2 },
  file: { label: "File", icon: File },
};

const filePrefixMeta: Record<string, { label: string; icon: typeof FileText }> = {
  doc: { label: "Doc", icon: FileText },
  airapp: { label: "AirApp", icon: AppWindow },
};

const nodeIcons: Record<string, typeof FileText> = {
  folder: Folder,
  base: Table2,
  skill: Sparkles,
  drive: HardDrive,
  airapp: AppWindow,
  file: File,
  doc: FileText,
  bot: Bot,
};

const getResultMeta = (result: SearchResultVO) => {
  if (result.kind === "file") {
    const prefix = result.href.split("/").filter(Boolean)[0];
    const override = prefix ? filePrefixMeta[prefix] : undefined;
    if (override) return override;
  }
  return kindMeta[result.kind];
};

const DEBOUNCE_MS = 180;
const PAGE_SIZE = 20;

type SearchTab = "recent" | "all" | "records" | "files" | "change_requests";
const SEARCH_TABS: { value: SearchTab; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "all", label: "All" },
  { value: "records", label: "Records" },
  { value: "files", label: "Files" },
  { value: "change_requests", label: "Change requests" },
];
const TAB_KIND: Record<SearchTab, SearchResultKind | null> = {
  recent: null,
  all: null,
  records: "record",
  files: "file",
  change_requests: "change_request",
};

const normalizeSearchText = (value: string) => value.trim().toLowerCase();

interface RecentLocalState {
  cache: KnownNodeCache | null;
  ready: boolean;
  results: KnownNode[];
}

function SearchContent() {
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("recent");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [recentLocalState, setRecentLocalState] = useState<RecentLocalState>({
    cache: null,
    ready: false,
    results: [],
  });

  const normalizedQuery = normalizeSearchText(query);
  const hasQuery = normalizedQuery.length > 0;
  const normalizedDebouncedQuery = normalizeSearchText(debouncedQuery);
  const isDebouncedQueryCurrent = normalizedDebouncedQuery === normalizedQuery;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setLimit(PAGE_SIZE);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    let readVersion = 0;
    setRecentLocalState({ cache: nodeCache, ready: false, results: [] });
    if (!nodeCache) {
      setRecentLocalState({ cache: null, ready: true, results: [] });
      return;
    }
    const read = () => {
      const currentRead = ++readVersion;
      const result = hasQuery ? nodeCache.fuzzyMatch(query) : nodeCache.listVisited();
      void result.then((results) => {
        if (cancelled || currentRead !== readVersion) return;
        setRecentLocalState({ cache: nodeCache, ready: true, results });
      });
    };
    read();
    const unsubscribe = nodeCache.subscribe(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hasQuery, nodeCache, query]);

  const recentCacheIsCurrent = recentLocalState.cache === nodeCache;
  const recentCacheReady = recentCacheIsCurrent && recentLocalState.ready;
  const recentLocalResults = recentCacheIsCurrent ? recentLocalState.results : [];

  const searchQuery = useQuery(
    buda
      ? {
          ...buda.orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
          enabled: tab !== "recent" && normalizedDebouncedQuery.length > 0,
        }
      : { queryKey: ["no-connection", "search"], queryFn: skipToken },
  );

  const recentUsesNetworkFallback =
    tab === "recent" && hasQuery && recentCacheReady && recentLocalResults.length === 0;
  const nodeSearchQuery = useQuery(
    buda
      ? {
          ...buda.orpc.nodes.searchByName.queryOptions({
            input: { query: debouncedQuery, limit: PAGE_SIZE },
          }),
          enabled:
            recentUsesNetworkFallback &&
            normalizedDebouncedQuery.length > 0 &&
            isDebouncedQueryCurrent,
        }
      : { queryKey: ["no-connection", "node-search"], queryFn: skipToken },
  );

  const recentNetworkResults: NodeSearchResultVO[] = isDebouncedQueryCurrent
    ? (nodeSearchQuery.data ?? [])
    : [];

  useEffect(() => {
    if (!nodeCache || recentNetworkResults.length === 0) return;
    void nodeCache.merge(recentNetworkResults.map(nodeSearchResultToKnownNode));
  }, [nodeCache, recentNetworkResults]);

  const allResults = searchQuery.data?.results ?? [];
  const hasMore = searchQuery.data?.hasMore ?? false;
  const contentResults = useMemo(() => {
    if (tab === "all") return allResults.filter((result) => result.kind !== "change_request");
    const kind = TAB_KIND[tab];
    return kind ? allResults.filter((result) => result.kind === kind) : allResults;
  }, [allResults, tab]);
  const recentResults = recentUsesNetworkFallback
    ? recentNetworkResults.map(nodeSearchResultToKnownNode)
    : recentLocalResults;
  const searching =
    tab === "recent"
      ? !recentCacheReady ||
        (recentUsesNetworkFallback && (!isDebouncedQueryCurrent || nodeSearchQuery.isFetching))
      : searchQuery.isFetching;

  const tabOptions = useMemo(
    () =>
      SEARCH_TABS.map(({ value, label }) => {
        const kind = TAB_KIND[value];
        const count =
          value === "recent"
            ? recentResults.length
            : value === "all"
              ? allResults.filter((result) => result.kind !== "change_request").length
              : kind
                ? allResults.filter((result) => result.kind === kind).length
                : 0;
        return { value, label, meta: count > 0 ? count : undefined };
      }),
    [allResults, recentResults.length],
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
        const matches = await buda.client.nodes.searchByName({ query: slug, limit: PAGE_SIZE });
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
          const resolvedNode = await resolveKnownNode(nodeType, slug);
          if (resolvedNode) {
            await openKnownNode(resolvedNode);
          } else {
            setError("This search result's node is no longer available.");
          }
        } else if (kind === "assets" && slug) {
          router.push({ pathname: "/assets/[id]", params: { id: slug } });
        } else {
          router.push("/drawer/assets");
        }
      }
    },
    [openKnownNode, resolveKnownNode, router],
  );

  const activeQueryError = tab === "recent" ? nodeSearchQuery.error : searchQuery.error;
  const searchErrorMessage = activeQueryError
    ? activeQueryError instanceof Error
      ? activeQueryError.message
      : "Search failed"
    : null;
  const displayedError = error ?? searchErrorMessage;
  const resetError = useCallback(() => {
    setError(null);
    if (!searchErrorMessage) return;
    if (tab === "recent") void nodeSearchQuery.refetch();
    else void searchQuery.refetch();
  }, [nodeSearchQuery.refetch, searchErrorMessage, searchQuery.refetch, tab]);

  const resultCount = tab === "recent" ? recentResults.length : contentResults.length;

  return (
    <DrawerScaffold title="Search" subtitle="Recent nodes and workspace content">
      <View style={styles.searchBox}>
        <TextInput
          label="Search"
          value={query}
          autoFocus
          placeholder="Search nodes, records, change requests, and files"
          returnKeyType="search"
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.tabsWrap}>
        <NativeChipList value={tab} options={tabOptions} onChange={setTab} />
      </View>

      {displayedError ? (
        <View style={styles.message}>
          <NativeInlineError message={displayedError} onReset={resetError} />
        </View>
      ) : null}

      <NativeSection title={tab === "recent" ? "Recent" : hasQuery ? "Results" : "Search"}>
        {searching && resultCount === 0 ? (
          <NativeRow
            title="Searching"
            subtitle={
              tab === "recent"
                ? "Looking for nodes by name."
                : "Looking across records, change requests, Bases, and files."
            }
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {!searching && resultCount === 0 && !displayedError ? (
          <NativeRow
            title={tab === "recent" && !hasQuery ? "No recent nodes" : "No matches"}
            subtitle={
              tab === "recent" && !hasQuery
                ? "Nodes you open will appear here."
                : tab === "recent"
                  ? "Try another node name or switch tabs for full-text search."
                  : hasQuery
                    ? "Try a title, field value, or another tab."
                    : "Enter a query to search workspace content."
            }
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {tab === "recent"
          ? recentResults.map((node, index) => {
              const definition = getNodeType(node.type);
              const Icon = nodeIcons[node.type] ?? FileText;
              const unsupported = node.type === "file";
              return (
                <NativeRow
                  key={node.id}
                  title={node.name}
                  subtitle={unsupported ? "Not viewable on mobile yet" : node.slug}
                  meta={definition?.label ?? node.type}
                  leading={<Icon size={18} color={tokens.mutedForeground} />}
                  onPress={() => void openKnownNode(node)}
                  last={index === recentResults.length - 1}
                />
              );
            })
          : contentResults.map((result, index) => {
              const meta = getResultMeta(result);
              const Icon = meta.icon;
              return (
                <NativeRow
                  key={`${result.kind}-${result.id}`}
                  title={result.title}
                  subtitle={result.body || result.eyebrow || meta.label}
                  meta={meta.label}
                  leading={<Icon size={18} color={tokens.mutedForeground} />}
                  onPress={() => void openResult(result)}
                  last={index === contentResults.length - 1}
                >
                  {result.eyebrow && result.body ? (
                    <Text
                      numberOfLines={1}
                      style={[typography.caption, { color: tokens.mutedForeground }]}
                    >
                      {result.eyebrow}
                    </Text>
                  ) : null}
                </NativeRow>
              );
            })}
      </NativeSection>

      {hasQuery && hasMore && tab !== "recent" && tab !== "change_requests" ? (
        <View style={styles.loadMore}>
          <NativeActionBar>
            <Button
              label={searching ? "Loading…" : "Load more"}
              variant="secondary"
              disabled={searching}
              onPress={() => setLimit((current) => current + PAGE_SIZE)}
            />
          </NativeActionBar>
        </View>
      ) : null}
    </DrawerScaffold>
  );
}

export default function SearchScreen() {
  return (
    <ConnectionGuard>
      <SearchContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  searchBox: { marginHorizontal: 20, marginBottom: 8 },
  tabsWrap: { marginBottom: 8 },
  message: { marginHorizontal: 20, marginBottom: 8 },
  loadMore: { marginHorizontal: 20, marginTop: 4 },
});
