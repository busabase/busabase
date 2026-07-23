import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeSearchResultVO, SearchResultKind, SearchResultVO } from "busabase-contract/types";
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
} from "../helpers/known-node-cache";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { nodeIconForType } from "../helpers/node-icons";
import { normalizeSearchText, searchKindIcon } from "../helpers/search";
import { EmptyState } from "./primitives";

// "Recent" replaces the old static-tiles "Bases" landing tab — it's a
// keyboard-first quick-jump over every node the dashboard has ever shown the
// user (see apps/busabase/content/spec/search-quick-jump.md), not a
// full-text-content search. It's selected by default whenever the dialog
// opens.
type SearchTab = "recent" | "all" | "records" | "files" | "change_requests";
const SEARCH_TABS: SearchTab[] = ["recent", "all", "records", "files", "change_requests"];
const TAB_KIND: Record<SearchTab, SearchResultKind | null> = {
  recent: null,
  all: null,
  records: "record",
  files: "file",
  change_requests: "change_request",
};

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

const knownNodeToDisplay = (node: KnownNode): DisplayResult => {
  const Icon = nodeIconForType(node.type);
  return {
    key: node.id,
    id: node.id,
    href: node.path,
    title: node.name,
    eyebrow: node.slug,
    icon: <Icon className="size-4" />,
  };
};

const nodeSearchResultToKnownNode = (result: NodeSearchResultVO): KnownNode => ({
  id: result.id,
  type: result.type,
  name: result.name,
  slug: result.slug,
  path: result.path,
});

export function SearchDialog({
  nodeCache,
  orpc,
  onClose,
  open,
}: {
  nodeCache: KnownNodeCache;
  orpc: BusabaseQueryUtils;
  onClose: () => void;
  open: boolean;
}) {
  const messages = useCoreI18n();
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
    if (tab === "recent") setHighlightedIndex(0);
  }, [tab, query]);

  // Content-search tabs' backend call — UNCHANGED from before this redesign,
  // except it's now paused while the Recent tab is active: Recent's whole
  // point is to stay cheap (local cache, or the lightweight `nodes.searchByName`
  // fallback below), never the heavier full-text/asset-scan `search` procedure.
  const searchQuery = useQuery({
    ...orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
    enabled: open && tab !== "recent" && debouncedQuery.length > 0,
  });
  const response = searchQuery.data ?? null;
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
  };

  // "All" tab excludes change_request; other content tabs filter by kind.
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

  const visibleResults: DisplayResult[] = useMemo(() => {
    if (tab === "recent") {
      const source = recentUsesNetworkFallback
        ? recentNetworkResults.map(nodeSearchResultToKnownNode)
        : recentLocalMatches;
      return source.map(knownNodeToDisplay);
    }
    return contentSearchResults.map(searchResultToDisplay);
  }, [
    tab,
    recentUsesNetworkFallback,
    recentNetworkResults,
    recentLocalMatches,
    contentSearchResults,
  ]);

  // Tab result counts (for badges). Recent's own count is always cheap to
  // compute (local cache, or the live network-fallback result); the OTHER
  // tabs' counts depend on `allResults`, which is only ever fetched while a
  // content-search tab is active (see `searchQuery.enabled` above) — showing
  // them while sitting on Recent would be a stale/misleading zero, so they're
  // hidden until the user actually switches to a content-search tab.
  const tabCount = useCallback(
    (t: SearchTab) => {
      if (t === "recent") {
        return recentUsesNetworkFallback ? recentNetworkResults.length : recentLocalMatches.length;
      }
      if (t === "all") return allResults.filter((r) => r.kind !== "change_request").length;
      const kind = TAB_KIND[t];
      return kind ? allResults.filter((r) => r.kind === kind).length : allResults.length;
    },
    [allResults, recentUsesNetworkFallback, recentNetworkResults, recentLocalMatches],
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

  const switchTab = useCallback((direction: 1 | -1) => {
    setTab((current) => {
      const idx = SEARCH_TABS.indexOf(current);
      return SEARCH_TABS[(idx + direction + SEARCH_TABS.length) % SEARCH_TABS.length] as SearchTab;
    });
  }, []);

  // ONE shared selection path for BOTH keyboard Enter and mouse click (fixes
  // the bug where Enter built a synthetic anchor from the raw `href`,
  // skipping the query-string merge the mouse-click path applied): resolve
  // the href through the same `mergeSearchIntoHref` + demo-param helpers,
  // close, and navigate via the SPA router. Node details report the visit only
  // after their data loads successfully.
  const select = useCallback(
    (result: DisplayResult) => {
      onClose();
      setLocation(addDemoParam(mergeSearchIntoHref(result.href, currentSearch)));
    },
    [onClose, setLocation, addDemoParam, currentSearch],
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
  const showLoadingIndicator = isRecentTab
    ? recentIsSearching && visibleResults.length === 0
    : isSearching && visibleResults.length === 0;
  const visibleError = isRecentTab ? recentSearchError : searchError;

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
          <TabsList className="h-auto w-full justify-start gap-0.5 border-b bg-transparent px-2 py-2 sm:gap-1 sm:px-3">
            {SEARCH_TABS.map((t) => {
              const count = hasQuery && (t === "recent" || tab !== "recent") ? tabCount(t) : null;
              return (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="group h-7 gap-1 rounded-lg px-1.5 font-medium text-muted-foreground text-xs shadow-none transition-colors data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none sm:gap-1.5 sm:px-2.5 sm:text-[13px]"
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
          {isRecentTab || hasQuery ? (
            <div>
              {visibleError ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
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
                  {!isRecentTab && response?.hasMore && tab !== "change_requests" ? (
                    <button
                      className="mt-3 rounded-lg border bg-background px-3 py-2 font-medium text-sm transition-colors hover:bg-accent/40 disabled:opacity-60"
                      disabled={isSearching}
                      onClick={loadMore}
                      type="button"
                    >
                      {isSearching ? messages.common.loadingPlain : messages.search.loadMore}
                    </button>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title={
                    isRecentTab && !hasQuery
                      ? messages.search.noRecentTitle
                      : messages.search.noMatchesTitle
                  }
                  body={
                    isRecentTab && !hasQuery
                      ? messages.search.noRecentBody
                      : messages.search.noMatchesBody
                  }
                />
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
