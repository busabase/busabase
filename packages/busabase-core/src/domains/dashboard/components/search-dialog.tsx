import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeType } from "busabase-contract/domains";
import type {
  NodeSearchResultVO,
  NodeVO,
  SearchResultKind,
  SearchResultVO,
} from "busabase-contract/types";
import { Kbd } from "kui/kbd";
import { Tabs, TabsList, TabsTrigger } from "kui/tabs";
import { cn } from "kui/utils";
import { CornerDownLeft, Search, X } from "lucide-react";
import { useAddDemoParam } from "openlib/ui/dashboard";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useCoreI18n } from "../../../i18n";
import {
  fuzzyMatchKnownNodes,
  type KnownNode,
  type KnownNodeCache,
  nodeRoutePath,
} from "../helpers/known-node-cache";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { NodeAvatar } from "../helpers/node-icons";
import { filterNodeListByQuery } from "../helpers/node-list-search";
import { normalizeSearchText, searchKindIcon } from "../helpers/search";
import {
  isContentSearchTab,
  isNodeListTab,
  type NodeListTab,
  type SearchTab,
  searchTabsFor,
} from "../helpers/search-tabs";
import { useIsAnonymousVisitor } from "../visitor-context";
import { EmptyState } from "./primitives";

// "Recent" replaces the old static-tiles "Bases" landing tab — it's a
// keyboard-first quick-jump over every node the dashboard has ever shown the
// user, not a full-text-content search. It's selected by default whenever the
// dialog opens.
const TAB_KIND: Record<SearchTab, SearchResultKind | null> = {
  recent: null,
  all: null,
  records: "record",
  files: "file",
  skills: null,
  apps: null,
  change_requests: "change_request",
};

const NODE_TYPE_FOR_TAB: Record<NodeListTab, NodeType> = { skills: "skill", apps: "airapp" };

/**
 * One shared shape every result row renders from, regardless of which tab
 * produced it (a `SearchResultVO` from the heavier content-search tabs, or a
 * `KnownNode`/`NodeSearchResultVO` from the Recent tab's cache/quick-jump
 * lookup) — this is what lets `Enter` and mouse click resolve through the
 * exact same `select()` function for every tab, closing the keyboard/mouse
 * parity bug described in the spec.
 */
interface DisplayResult {
  /** React list key — unique across whatever's currently rendered. */
  key: string;
  /** Raw entity id used as the stable result identity. */
  id: string;
  href: string;
  title: string;
  body?: string;
  eyebrow?: string;
  icon: ReactNode;
  /**
   * Set only for results that are nodes — i.e. the Recent tab. Content results
   * (records, files, change requests) are things *inside* nodes and have no
   * node type of their own, which is exactly why a caller wanting to pin
   * something has to check this rather than assume every result is pinnable.
   */
  nodeType?: NodeType;
}

const searchResultToDisplay = (result: SearchResultVO): DisplayResult => ({
  key: `${result.kind}-${result.id}`,
  id: result.id,
  href: result.href,
  title: result.title,
  body: result.body || undefined,
  eyebrow: result.eyebrow || undefined,
  icon: searchKindIcon[result.kind],
});

const knownNodeToDisplay = (node: KnownNode): DisplayResult => ({
  key: node.id,
  id: node.id,
  href: node.path,
  title: node.name,
  eyebrow: node.slug,
  icon: <NodeAvatar node={node} />,
  nodeType: node.type,
});

const nodeVOToDisplay = (node: NodeVO): DisplayResult => ({
  key: node.id,
  id: node.id,
  href: nodeRoutePath(node.type, node.slug),
  title: node.name,
  body: node.description || undefined,
  eyebrow: node.slug,
  icon: <NodeAvatar node={node} />,
  nodeType: node.type,
});

const nodeVOToKnownNode = (node: NodeVO): KnownNode => ({
  id: node.id,
  type: node.type,
  name: node.name,
  slug: node.slug,
  path: nodeRoutePath(node.type, node.slug),
  icon: node.icon,
});

const nodeSearchResultToKnownNode = (result: NodeSearchResultVO): KnownNode => ({
  id: result.id,
  type: result.type,
  name: result.name,
  slug: result.slug,
  path: result.path,
  icon: result.icon,
});

export function SearchDialog({
  nodeCache,
  orpc,
  onClose,
  open,
  onSelect,
}: {
  nodeCache: KnownNodeCache;
  orpc: BusabaseQueryUtils;
  onClose: () => void;
  open: boolean;
  /**
   * Replaces navigation for this opening of the dialog. The side panel uses it
   * to pin the chosen result instead of going to it. Because the dialog is a
   * singleton, this is a *mode* the opener sets — whoever passes it is
   * responsible for clearing it when the dialog closes, or the next Cmd-K
   * would silently keep pinning.
   */
  onSelect?: (result: DisplayResult) => void;
}) {
  const messages = useCoreI18n();
  // Anonymous (public-link) visitors get a narrower tab set — see
  // `searchTabsFor`. Read from context, which defaults to "member", so every
  // host that never opts in is unaffected.
  const isAnonymousVisitor = useIsAnonymousVisitor();
  const visibleTabs = useMemo(() => searchTabsFor(isAnonymousVisitor), [isAnonymousVisitor]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("recent");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Pagination grows the page size (offset stays 0) so React Query owns the full list.
  const [limit, setLimit] = useState(20);
  const hasQuery = normalizeSearchText(query).length > 0;

  // Shared navigation path for BOTH keyboard Enter and mouse click (see
  // `select` below) — same helpers the mouse-click path already used before
  // this redesign (`mergeSearchIntoHref`/demo-param), so both resolve to the
  // identical destination URL.
  const [, setLocation] = useLocation();
  const currentSearch = useSearch();
  const addDemoParam = useAddDemoParam();

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Debounce typing into the query that actually drives backend requests
  // (the content-search tabs' `search` call, and the Recent tab's
  // cache-miss `nodes.searchByName` fallback below) — the Recent tab's own
  // local cache match stays instant/undebounced (see `recentLocalMatches`).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setLimit(20);
      setHighlightedIndex(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Reset state when closed.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setTab("recent");
      setHighlightedIndex(0);
      setLimit(20);
    }
  }, [open]);

  // The Recent tab's highlight should jump back to the top result on every
  // keystroke (its list updates instantly, unlike the debounced content
  // tabs) — the length-based clamp effect further below only covers a
  // shrinking/growing list, not "same length, different items."
  // biome-ignore lint/correctness/useExhaustiveDependencies: query intentionally re-triggers this on every keystroke; it isn't read in the body
  useEffect(() => {
    if (tab === "recent" || isNodeListTab(tab)) setHighlightedIndex(0);
  }, [tab, query]);

  // Content-search tabs' backend call, paused on every tab that does not read
  // it: Recent's whole point is to stay cheap (local cache, or the lightweight
  // `nodes.searchByName` fallback below), and Skills/Apps read their own
  // `nodes.list` instead — firing the full-text/asset-scan `search` procedure
  // from either would pay for a response nothing renders.
  const searchQuery = useQuery({
    ...orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
    enabled: open && isContentSearchTab(tab) && debouncedQuery.length > 0,
  });
  const response = searchQuery.data ?? null;
  // Node content is indexed only up to a cap, so a thin or empty result is not
  // proof of absence. Surfaced in the empty state rather than swallowed —
  // otherwise "no matches" quietly means two different things.
  const contentTruncated = response?.contentTruncated ?? false;
  const allResults = response?.results ?? [];
  const isSearching = searchQuery.isFetching;
  const searchError = searchQuery.isError
    ? searchQuery.error instanceof Error
      ? searchQuery.error.message
      : messages.search.failed
    : null;
  const tabLabel: Record<SearchTab, string> = {
    recent: messages.search.recent,
    all: messages.search.all,
    change_requests: messages.search.changeRequests,
    files: messages.nodeDetail.files,
    records: messages.search.records,
    skills: messages.search.skills,
    apps: messages.search.apps,
  };

  // "Content" tab (label "Content", key stays "all" internally) merges every
  // CONTENT kind `search` can return, excluding change_request; other content
  // tabs filter by a single kind. It carries no Skills/Apps — `search` has no
  // "skill"/"airapp" result kind, those come from the separate `nodes.list`
  // source the two node-list tabs read (see `helpers/search-tabs.ts`).
  const contentSearchResults = useMemo(() => {
    if (tab === "all") return allResults.filter((r) => r.kind !== "change_request");
    const kind = TAB_KIND[tab];
    return kind ? allResults.filter((r) => r.kind === kind) : allResults;
  }, [allResults, tab]);

  // Recent tab: instant, client-side match over the WHOLE `KnownNode` cache —
  // computed fresh every render (cheap; bounded by the cache's own entry cap)
  // so it always reflects the LIVE singleton, including merges that happened
  // in a parent's effect (e.g. a fresh sidebar `nodes.list` response) between
  // renders. Computed unconditionally (not gated on `tab === "recent"`) so the
  // Recent tab's OWN badge count stays accurate even while a different tab is
  // active.
  const nodeCacheSnapshot = useSyncExternalStore(
    nodeCache.subscribe,
    nodeCache.getSnapshot,
    nodeCache.getSnapshot,
  );
  const recentLocalMatches = useMemo(
    () =>
      hasQuery ? fuzzyMatchKnownNodes(nodeCacheSnapshot.all, query) : nodeCacheSnapshot.visited,
    [hasQuery, nodeCacheSnapshot, query],
  );
  // A cache miss (typed a query, zero local matches) falls through to the
  // cheap, name-only `nodes.searchByName` endpoint — only while the Recent
  // tab is actually the active one, so switching to a content-search tab
  // never fires this in the background for no reason.
  const recentUsesNetworkFallback = tab === "recent" && hasQuery && recentLocalMatches.length === 0;
  const nodeSearchByNameQuery = useQuery({
    ...orpc.nodes.searchByName.queryOptions({ input: { query: debouncedQuery, limit: 20 } }),
    enabled:
      open &&
      recentUsesNetworkFallback &&
      debouncedQuery.length > 0 &&
      normalizeSearchText(debouncedQuery) === normalizeSearchText(query),
  });
  const normalizedDebouncedQuery = normalizeSearchText(debouncedQuery);
  const isDebouncedQueryCurrent = normalizedDebouncedQuery === normalizeSearchText(query);
  const recentNetworkResults = isDebouncedQueryCurrent ? (nodeSearchByNameQuery.data ?? []) : [];
  const recentIsSearching =
    recentUsesNetworkFallback && (!isDebouncedQueryCurrent || nodeSearchByNameQuery.isFetching);
  const recentSearchError =
    isDebouncedQueryCurrent && nodeSearchByNameQuery.isError
      ? nodeSearchByNameQuery.error instanceof Error
        ? nodeSearchByNameQuery.error.message
        : messages.search.failed
      : null;

  // Fold every `nodes.searchByName` hit straight back into the persisted
  // cache, so the same query resolves locally (zero network calls) next time
  // — the "app gets faster the more it's used" principle.
  useEffect(() => {
    if (recentNetworkResults.length > 0) {
      nodeCache.merge(recentNetworkResults.map(nodeSearchResultToKnownNode));
    }
  }, [nodeCache, recentNetworkResults]);

  // Skills / Apps tabs. One request per tab, fetched only while that tab is
  // open and then filtered locally on every keystroke. The input is byte-identical
  // to `AppsListView`'s (`{ types: ["airapp"] }`), which is what makes React
  // Query hand back the App Launcher's already-cached list instead of refetching
  // it — and keeps the two surfaces from ever disagreeing about what exists.
  const skillsQuery = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { types: [NODE_TYPE_FOR_TAB.skills] } }),
    enabled: open && tab === "skills" && !isAnonymousVisitor,
  });
  const appsQuery = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { types: [NODE_TYPE_FOR_TAB.apps] } }),
    enabled: open && tab === "apps" && !isAnonymousVisitor,
  });
  // Matched against the RAW `query`, never `debouncedQuery`: this is a local
  // array scan, so debouncing it would add lag with nothing to save.
  const skillMatches = useMemo(
    () => filterNodeListByQuery(skillsQuery.data ?? [], query),
    [skillsQuery.data, query],
  );
  const appMatches = useMemo(
    () => filterNodeListByQuery(appsQuery.data ?? [], query),
    [appsQuery.data, query],
  );
  const nodeListTab: NodeListTab | null = isNodeListTab(tab) ? tab : null;
  const nodeListQuery =
    nodeListTab === "skills" ? skillsQuery : nodeListTab === "apps" ? appsQuery : null;
  const nodeListMatches =
    nodeListTab === "skills" ? skillMatches : nodeListTab === "apps" ? appMatches : [];

  // Same "the app gets faster the more it's used" fold-back the Recent tab does
  // with its `nodes.searchByName` hits: every Skill/App listed here becomes a
  // Recent-tab quick-jump target, including ones sitting below the sidebar
  // tree's lazily-loaded depth that the tree itself never merged.
  useEffect(() => {
    const listed = [...(skillsQuery.data ?? []), ...(appsQuery.data ?? [])];
    if (listed.length > 0) nodeCache.merge(listed.map(nodeVOToKnownNode));
  }, [nodeCache, skillsQuery.data, appsQuery.data]);

  const visibleResults: DisplayResult[] = useMemo(() => {
    if (tab === "recent") {
      const source = recentUsesNetworkFallback
        ? recentNetworkResults.map(nodeSearchResultToKnownNode)
        : recentLocalMatches;
      return source.map(knownNodeToDisplay);
    }
    if (nodeListTab) return nodeListMatches.map(nodeVOToDisplay);
    return contentSearchResults.map(searchResultToDisplay);
  }, [
    tab,
    recentUsesNetworkFallback,
    recentNetworkResults,
    recentLocalMatches,
    nodeListTab,
    nodeListMatches,
    contentSearchResults,
  ]);

  // Tab result counts (for badges) — `null` means "this number cannot be
  // trusted right now", which is a different thing from zero and must not be
  // rendered as one.
  //
  // Recent's own count is always cheap to compute (local cache, or the live
  // network-fallback result), and Skills/Apps can be counted from their own
  // client-side list as soon as it has loaded — even from another tab, and
  // even with no query, where the number is simply "how many you own".
  // The CONTENT tabs' counts all come from `allResults`, which is only ever
  // fetched while a content-search tab is active (see `searchQuery.enabled`),
  // so anywhere else they would be a stale, misleading zero.
  const tabCount = useCallback(
    (t: SearchTab): number | null => {
      if (t === "skills") return skillsQuery.data ? skillMatches.length : null;
      if (t === "apps") return appsQuery.data ? appMatches.length : null;
      if (!hasQuery) return null;
      if (t === "recent") {
        return recentUsesNetworkFallback ? recentNetworkResults.length : recentLocalMatches.length;
      }
      if (!isContentSearchTab(tab)) return null;
      if (t === "all") return allResults.filter((r) => r.kind !== "change_request").length;
      const kind = TAB_KIND[t];
      return kind ? allResults.filter((r) => r.kind === kind).length : allResults.length;
    },
    [
      allResults,
      appMatches.length,
      appsQuery.data,
      hasQuery,
      recentUsesNetworkFallback,
      recentNetworkResults,
      recentLocalMatches,
      skillMatches.length,
      skillsQuery.data,
      tab,
    ],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight when tab changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [tab]);

  useEffect(() => {
    if (visibleResults.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((i) => Math.min(i, visibleResults.length - 1));
  }, [visibleResults.length]);

  // Cycles the VISIBLE tabs: walking the full list would let Tab land on a tab
  // this visitor cannot see, with no way back out of it.
  const switchTab = useCallback(
    (direction: 1 | -1) => {
      setTab((current) => {
        const idx = visibleTabs.indexOf(current);
        const from = idx === -1 ? 0 : idx;
        return visibleTabs[
          (from + direction + visibleTabs.length) % visibleTabs.length
        ] as SearchTab;
      });
    },
    [visibleTabs],
  );

  // ONE shared selection path for BOTH keyboard Enter and mouse click (fixes
  // the bug where Enter built a synthetic anchor from the raw `href`,
  // skipping the query-string merge the mouse-click path applied): resolve
  // the href through the same `mergeSearchIntoHref` + demo-param helpers,
  // close, and navigate via the SPA router. Node details report the visit only
  // after their data loads successfully.
  const select = useCallback(
    (result: DisplayResult) => {
      onClose();
      // Both the Enter key and the mouse funnel through here, so overriding
      // this one function is enough to redirect every selection path — that
      // parity is deliberate and worth preserving.
      if (onSelect) {
        onSelect(result);
        return;
      }
      setLocation(addDemoParam(mergeSearchIntoHref(result.href, currentSearch)));
    },
    [onClose, onSelect, setLocation, addDemoParam, currentSearch],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        switchTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((i) =>
          visibleResults.length === 0 ? 0 : (i + 1) % visibleResults.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((i) =>
          visibleResults.length === 0 ? 0 : (i - 1 + visibleResults.length) % visibleResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        const result = visibleResults[highlightedIndex];
        if (result) {
          event.preventDefault();
          select(result);
        }
      }
    },
    [onClose, switchTab, visibleResults, highlightedIndex, select],
  );

  const loadMore = useCallback(() => {
    if (response?.hasMore) {
      setLimit((current) => current + 20);
    }
  }, [response?.hasMore]);

  if (!open) {
    return null;
  }

  const isRecentTab = tab === "recent";
  const nodeListError =
    nodeListQuery?.isError === true
      ? nodeListQuery.error instanceof Error
        ? nodeListQuery.error.message
        : messages.search.failed
      : null;
  const showLoadingIndicator =
    (nodeListQuery ? nodeListQuery.isPending : isRecentTab ? recentIsSearching : isSearching) &&
    visibleResults.length === 0;
  const visibleError = nodeListQuery
    ? nodeListError
    : isRecentTab
      ? recentSearchError
      : searchError;

  // Skills/Apps land on their full list, so — like Recent — they have something
  // to show before a single character is typed.
  const showsResultsWithoutQuery = isRecentTab || nodeListTab !== null;
  const emptyState =
    nodeListTab && !hasQuery
      ? nodeListTab === "skills"
        ? { title: messages.search.noSkillsTitle, body: messages.search.noSkillsBody }
        : { title: messages.search.noAppsTitle, body: messages.search.noAppsBody }
      : nodeListTab
        ? { title: messages.search.noMatchesTitle, body: messages.search.noNodeMatchesBody }
        : isRecentTab && !hasQuery
          ? { title: messages.search.noRecentTitle, body: messages.search.noRecentBody }
          : {
              title: messages.search.noMatchesTitle,
              body: contentTruncated
                ? messages.search.partialContentBody
                : messages.search.noMatchesBody,
            };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-3 pt-[12vh] backdrop-blur-[1px]"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <button
        aria-label={messages.search.closeSearch}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <section className="relative flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-linear-zen-hover,0_8px_32px_-8px_rgba(0,0,0,0.18))]">
        {/* Search input row */}
        <label className="flex items-center gap-3 border-b px-4">
          <Search className="size-[18px] shrink-0 text-muted-foreground" />
          <input
            autoComplete="off"
            className="h-14 min-w-0 flex-1 bg-transparent font-light text-base text-foreground outline-none placeholder:text-muted-foreground"
            id="busabase-dashboard-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={messages.search.placeholder}
            ref={inputRef}
            type="search"
            value={query}
          />
          <button
            aria-label={messages.search.closeSearch}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X size={15} />
          </button>
        </label>

        {/* Tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as SearchTab);
            setHighlightedIndex(0);
          }}
        >
          <TabsList className="h-auto w-full justify-start gap-0.5 overflow-x-auto border-b bg-transparent px-2 py-2 sm:gap-1 sm:px-3">
            {visibleTabs.map((t) => {
              const count = tabCount(t);
              return (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="group h-7 shrink-0 gap-1 rounded-lg px-1.5 font-medium text-muted-foreground text-xs shadow-none transition-colors data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none sm:gap-1.5 sm:px-2.5 sm:text-[13px]"
                >
                  {tabLabel[t]}
                  {count !== null && count > 0 && (
                    <span
                      aria-hidden
                      className="tabular-nums text-[11px] text-muted-foreground/60 transition-colors group-data-[state=active]:text-muted-foreground"
                    >
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* Results area */}
        <div className="min-h-52 overflow-auto px-3 py-3">
          {showsResultsWithoutQuery || hasQuery ? (
            <div>
              {visibleError ? (
                <div className="mb-3 rounded-lg border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
                  {visibleError}
                </div>
              ) : null}
              {visibleError && visibleResults.length === 0 ? null : showLoadingIndicator ? (
                <div className="px-1 py-10 text-center text-muted-foreground text-sm">
                  {isRecentTab ? messages.search.searchingNodes : messages.search.searching}
                </div>
              ) : visibleResults.length > 0 ? (
                <>
                  <div className="space-y-0.5">
                    {visibleResults.map((result, index) => (
                      <SearchResultRow
                        key={result.key}
                        highlighted={index === highlightedIndex}
                        onHighlight={() => setHighlightedIndex(index)}
                        onSelect={() => select(result)}
                        result={result}
                      />
                    ))}
                  </div>
                  {isContentSearchTab(tab) && response?.hasMore && tab !== "change_requests" ? (
                    <button
                      className="mt-3 rounded-lg border bg-card px-3 py-2 font-medium text-sm transition-colors hover:bg-accent/40 disabled:opacity-60"
                      disabled={isSearching}
                      onClick={loadMore}
                      type="button"
                    >
                      {isSearching ? messages.common.loadingPlain : messages.search.loadMore}
                    </button>
                  ) : null}
                </>
              ) : (
                <EmptyState body={emptyState.body} title={emptyState.title} />
              )}
            </div>
          ) : (
            <EmptyState
              title={messages.search.typeToSearchTitle}
              body={messages.search.typeToSearchBody}
            />
          )}
        </div>

        {/* Keyboard hint footer */}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
            <Kbd>Tab</Kbd>
          </div>
          <Kbd>Esc</Kbd>
        </div>
      </section>
    </div>
  );
}

function SearchResultRow({
  highlighted,
  onHighlight,
  onSelect,
  result,
}: {
  highlighted?: boolean;
  onHighlight?: () => void;
  onSelect: () => void;
  result: DisplayResult;
}) {
  return (
    <button
      className={cn(
        "group flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-foreground transition-colors",
        highlighted ? "bg-muted" : "hover:bg-muted/60",
      )}
      onClick={onSelect}
      onMouseEnter={onHighlight}
      type="button"
    >
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {result.icon}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-normal leading-tight">
            {result.title}
          </span>
          {result.body && (
            <span className="mt-0.5 block truncate text-muted-foreground text-xs leading-tight">
              {result.body}
            </span>
          )}
        </span>
        {result.eyebrow && (
          <span className="max-w-32 shrink-0 truncate text-[13px] text-muted-foreground leading-none">
            {result.eyebrow}
          </span>
        )}
      </span>
    </button>
  );
}
