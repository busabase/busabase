import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeType } from "busabase-contract/domains";
import type { NodeSearchResultVO, NodeVO, SearchResultVO } from "busabase-contract/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Kbd } from "kui/kbd";
import { cn } from "kui/utils";
import { Check, ChevronDown, CornerDownLeft, Search, X } from "lucide-react";
import { useAddDemoParam } from "openlib/ui/dashboard";
import {
  Fragment,
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
  mergeRecentMatches,
  nodeRoutePath,
  partitionByVisited,
} from "../helpers/known-node-cache";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { NodeAvatar } from "../helpers/node-icons";
import { filterNodeListByQuery } from "../helpers/node-list-search";
import { normalizeSearchText, searchKindIcon } from "../helpers/search";
import {
  KIND_FOR_SECTION,
  type SearchFilterKey,
  type SearchSectionKey,
  searchFiltersFor,
  visibleSectionsFor,
} from "../helpers/search-sections";
import { useIsAnonymousVisitor } from "../visitor-context";
import { EmptyState } from "./primitives";

// "Recent" replaces the old static-tiles "Bases" landing tab — it's a
// keyboard-first quick-jump over every node the dashboard has ever shown the
// user, not a full-text-content search. It's selected by default whenever the
// dialog opens.
const NODE_TYPE_FOR_SECTION = { skills: "skill", apps: "airapp" } as const satisfies Record<
  "skills" | "apps",
  NodeType
>;

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
  const visibleFilters = useMemo(() => searchFiltersFor(isAnonymousVisitor), [isAnonymousVisitor]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilterKey>("all");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Pagination grows the page size (offset stays 0) so React Query owns the full list.
  const [limit, setLimit] = useState(20);
  const hasQuery = normalizeSearchText(query).length > 0;
  /**
   * The sections on screen for this filter + query state. Everything below
   * gates its request on membership here, so a section that is not rendered
   * never costs a round trip.
   */
  const sections = useMemo(
    () => visibleSectionsFor(filter, hasQuery, isAnonymousVisitor),
    [filter, hasQuery, isAnonymousVisitor],
  );
  const shows = useCallback((section: SearchSectionKey) => sections.includes(section), [sections]);

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
  // local cache match stays instant/undebounced (see `recentLocalMatches`),
  // and is merged with the debounced server results (see `recentMatches`).
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
      setFilter("all");
      setHighlightedIndex(0);
      setLimit(20);
    }
  }, [open]);

  // The highlight returns to the top result on every keystroke. The local
  // sections (recent / apps / skills) update instantly while the scoped
  // requests are still debouncing, so the list under the cursor can change
  // identity without changing length — which the length-based clamp further
  // below cannot detect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query intentionally re-triggers this on every keystroke; it isn't read in the body
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filter, query]);

  /**
   * One scoped `search()` per content section, instead of one combined call.
   *
   * NOT an optimization — a correctness requirement. `search()` applies its
   * `limit` per source but only slices the CONCATENATION at the end, and
   * records are concatenated first. One combined call in a record-heavy
   * workspace therefore returns 20 records and zero files even when files
   * match, which is precisely the silent-truncation shape this redesign exists
   * to remove. Scoping gives each section its own budget.
   *
   * The cost is real and worth stating: up to four concurrent requests per
   * settled keystroke instead of one. Each is cheaper than the combined call it
   * replaces — `sources` exists so a caller can skip the expensive
   * records-ranking query, which three of these four do — and all four share
   * the same 180ms debounce.
   */
  // Written out four times rather than through a helper that wraps `useQuery`:
  // a helper would be a hook, and a hook called in a loop or behind a condition
  // is a rules-of-hooks bug waiting for the next person to introduce. Four
  // explicit calls cannot drift into that shape.
  const scopedInput = (source: "records" | "files" | "nodes" | "names") => ({
    query: debouncedQuery,
    limit,
    offset: 0,
    sources: [source] as [typeof source],
  });
  const canSearch = open && debouncedQuery.length > 0;

  // `changeRequests` deliberately has no request of its own: the change
  // requests `search` returns are the ones the matching RECORDS came from, so
  // they arrive on the records response and are split out by kind below.
  const recordsQuery = useQuery({
    ...orpc.search.queryOptions({ input: scopedInput("records") }),
    enabled: canSearch && (shows("records") || shows("changeRequests")),
  });
  const filesQuery = useQuery({
    ...orpc.search.queryOptions({ input: scopedInput("files") }),
    enabled: canSearch && shows("files"),
  });
  const docContentQuery = useQuery({
    ...orpc.search.queryOptions({ input: scopedInput("nodes") }),
    enabled: canSearch && shows("docContent"),
  });
  const baseNamesQuery = useQuery({
    ...orpc.search.queryOptions({ input: scopedInput("names") }),
    enabled: canSearch && shows("bases"),
  });
  const contentQueries = [recordsQuery, filesQuery, docContentQuery, baseNamesQuery];

  const rowsForSection = useCallback(
    (section: SearchSectionKey): DisplayResult[] => {
      const kind = KIND_FOR_SECTION[section];
      if (!kind) return [];
      const source =
        section === "files"
          ? filesQuery
          : section === "docContent"
            ? docContentQuery
            : section === "bases"
              ? baseNamesQuery
              : recordsQuery;
      return (source.data?.results ?? [])
        .filter((result) => result.kind === kind)
        .map(searchResultToDisplay);
    },
    [recordsQuery, filesQuery, docContentQuery, baseNamesQuery],
  );

  // Node content is indexed only up to a cap, so a thin or empty result is not
  // proof of absence. Surfaced in the empty state rather than swallowed —
  // otherwise "no matches" quietly means two different things.
  const contentTruncated = contentQueries.some((q) => q.data?.contentTruncated ?? false);
  const isSearching = contentQueries.some((q) => q.isFetching);
  const searchError =
    contentQueries.find((q) => q.isError)?.error instanceof Error
      ? (contentQueries.find((q) => q.isError)?.error as Error).message
      : contentQueries.some((q) => q.isError)
        ? messages.search.failed
        : null;

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
  // The authoritative half of the Recent tab: the cheap, name-only
  // `nodes.searchByName` endpoint, which spans EVERY node type with no content
  // scan. Fired on every query while the Recent tab is active — not only on a
  // local cache miss, which is what it used to do.
  //
  // Why the change: the cache only holds what this browser has already loaded
  // (the sidebar tree's `NODE_TREE_PREFETCH_DEPTH` levels, folders the user
  // expanded, nodes they visited). Gating the request on
  // `recentLocalMatches.length === 0` meant a SINGLE shallow hit suppressed the
  // request entirely, hiding every deeper node matching the same query behind a
  // result that looked complete. Verified in a real browser: two Docs both named
  // "Zebra …", one at the root and one four levels down — searching "zebra"
  // returned only the shallow one and made zero network requests.
  //
  // The extra cost is one debounced `ilike` per settled keystroke, and local
  // matches still render instantly underneath it (see `recentMatches`).
  const recentWantsNetworkSearch = (shows("recent") || shows("workspace")) && hasQuery;
  const nodeSearchByNameQuery = useQuery({
    ...orpc.nodes.searchByName.queryOptions({ input: { query: debouncedQuery, limit: 20 } }),
    enabled:
      open &&
      recentWantsNetworkSearch &&
      debouncedQuery.length > 0 &&
      normalizeSearchText(debouncedQuery) === normalizeSearchText(query),
  });
  const normalizedDebouncedQuery = normalizeSearchText(debouncedQuery);
  const isDebouncedQueryCurrent = normalizedDebouncedQuery === normalizeSearchText(query);
  const recentNetworkResults = isDebouncedQueryCurrent ? (nodeSearchByNameQuery.data ?? []) : [];
  // Local rows first (already on screen — never reordered under the user),
  // server rows the cache had not seen appended below. This list, not
  // `recentLocalMatches`, is what the tab renders and counts.
  // Merge, then float the genuinely-visited rows to the top. The split is by
  // `lastVisitedAt`, NOT by "came from the cache" — the cache also holds the
  // sidebar tree and every node a past search returned, so a cache-based split
  // would file nodes the user has never opened under "Recently visited".
  const { ordered: recentMatches, visitedCount: recentVisitedCount } = useMemo(
    () =>
      partitionByVisited(
        mergeRecentMatches(
          recentLocalMatches,
          recentNetworkResults.map(nodeSearchResultToKnownNode),
        ),
      ),
    [recentLocalMatches, recentNetworkResults],
  );
  // Only ever surfaces as a full-pane spinner when there is nothing to show yet
  // (see `showLoadingIndicator`) — with local hits on screen the server results
  // simply appear underneath when they land, no flicker.
  const recentIsSearching =
    recentWantsNetworkSearch && (!isDebouncedQueryCurrent || nodeSearchByNameQuery.isFetching);
  const recentSearchError =
    isDebouncedQueryCurrent && nodeSearchByNameQuery.isError
      ? nodeSearchByNameQuery.error instanceof Error
        ? nodeSearchByNameQuery.error.message
        : messages.search.failed
      : null;

  // Fold every `nodes.searchByName` hit back into the persisted cache — the
  // "app gets faster the more it's used" principle — but only once the dialog
  // has CLOSED, never the moment the results land.
  //
  // Merging mid-query is what the obvious version does, and it is wrong here:
  // the merged rows immediately re-enter `recentLocalMatches` (it reads the
  // live cache), which re-sorts the list the user is currently looking at. A
  // row under the highlight slides down a position and `Enter` opens something
  // else. Observed for real: with the fold-back inline, searching "zebra"
  // rendered `[Zebra Shallow Doc]`, then flipped to
  // `[Zebra Deep Doc, Zebra Shallow Doc]` — the highlighted row changed
  // identity without the user touching anything.
  //
  // Deferring keeps the whole benefit (the next time this dialog opens, the
  // query resolves locally) and costs only that one repeat query inside the
  // same session still going to the server, which is the cheap name-only
  // endpoint anyway.
  const pendingCacheMerge = useRef<Map<string, KnownNode>>(new Map());
  useEffect(() => {
    for (const result of recentNetworkResults) {
      pendingCacheMerge.current.set(result.id, nodeSearchResultToKnownNode(result));
    }
  }, [recentNetworkResults]);
  useEffect(() => {
    if (open || pendingCacheMerge.current.size === 0) return;
    nodeCache.merge([...pendingCacheMerge.current.values()]);
    pendingCacheMerge.current = new Map();
  }, [open, nodeCache]);

  // Skills / Apps tabs. One request per tab, fetched only while that tab is
  // open and then filtered locally on every keystroke. The input is byte-identical
  // to `AppsListView`'s (`{ types: ["airapp"] }`), which is what makes React
  // Query hand back the App Launcher's already-cached list instead of refetching
  // it — and keeps the two surfaces from ever disagreeing about what exists.
  const skillsQuery = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { types: [NODE_TYPE_FOR_SECTION.skills] } }),
    enabled: open && shows("skills") && !isAnonymousVisitor,
  });
  const appsQuery = useQuery({
    ...orpc.nodes.list.queryOptions({ input: { types: [NODE_TYPE_FOR_SECTION.apps] } }),
    enabled: open && shows("apps") && !isAnonymousVisitor,
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
  // Same "the app gets faster the more it's used" fold-back the Recent tab does
  // with its `nodes.searchByName` hits: every Skill/App listed here becomes a
  // Recent-tab quick-jump target, including ones sitting below the sidebar
  // tree's lazily-loaded depth that the tree itself never merged.
  useEffect(() => {
    const listed = [...(skillsQuery.data ?? []), ...(appsQuery.data ?? [])];
    if (listed.length > 0) nodeCache.merge(listed.map(nodeVOToKnownNode));
  }, [nodeCache, skillsQuery.data, appsQuery.data]);

  const filterLabel: Record<SearchFilterKey, string> = useMemo(
    () => ({
      all: messages.search.filterAll,
      apps: messages.search.apps,
      skills: messages.search.skills,
      records: messages.search.records,
      files: messages.nodeDetail.files,
      changeRequests: messages.search.changeRequests,
    }),
    [messages],
  );

  // Memoized so it is referentially stable — an inline object here would make
  // every memo that reads it re-run on every render, and tempts the linter into
  // "fixing" dependency arrays with expressions that do not exist in scope.
  const sectionTitle: Record<SearchSectionKey, string> = useMemo(
    () => ({
      recent: messages.search.sectionRecent,
      workspace: messages.search.sectionElsewhere,
      apps: messages.search.apps,
      skills: messages.search.skills,
      records: messages.search.records,
      files: messages.nodeDetail.files,
      docContent: messages.search.sectionDocContent,
      bases: messages.search.bases,
      changeRequests: messages.search.changeRequests,
    }),
    [messages],
  );

  /**
   * Every visible section's rows, in render order, each still carrying which
   * section produced it.
   *
   * The `recent` / `workspace` split is not two lists: `recentMatches` is one
   * ordered list whose first `recentVisitedCount` entries are the nodes this
   * person actually opened (see `partitionByVisited`), so it is sliced rather
   * than re-derived — the same list the keyboard walks.
   */
  const populatedSections = useMemo(() => {
    const built: { key: SearchSectionKey; rows: DisplayResult[] }[] = [];
    /**
     * One NODE, one row — but only among the sections that describe nodes.
     *
     * Those sections overlap by construction: a Base matches
     * `nodes.searchByName` by its name AND the `names` source by that same
     * name, so the same node legitimately lands in two result sets. While each
     * was a separate tab you could never see both; showing them together made
     * it plainly visible ("Quokka Customers" under both "Elsewhere in this
     * workspace" and "Bases"). Keyed on `href`, not `id`, because the two rows
     * carry different ids — a Base result's id is the base id, the node row's
     * is the node id — while the href is what `select()` actually navigates to.
     *
     * Content sections are deliberately EXCLUDED. A file result's href is its
     * containing node's route (there is no per-file page), so href-deduping
     * them against an already-listed node deletes every matching file in that
     * node — verified: it silently emptied the whole Files section. That is the
     * exact failure this redesign exists to remove, so the noise those rows
     * currently carry stays visible until it is fixed where it originates
     * (`fileIdentitySqlCondition` matches the owning node's name, so a file
     * whose own name is unrelated still matches). Papering over a
     * server-side over-match by hiding rows would trade a visible problem for
     * an invisible one.
     */
    const DEDUPED_SECTIONS: SearchSectionKey[] = ["recent", "workspace", "apps", "skills", "bases"];
    const seenHrefs = new Set<string>();
    for (const key of sections) {
      const rows =
        key === "recent"
          ? recentMatches
              .slice(0, hasQuery ? recentVisitedCount : recentMatches.length)
              .map(knownNodeToDisplay)
          : key === "workspace"
            ? recentMatches.slice(recentVisitedCount).map(knownNodeToDisplay)
            : key === "apps"
              ? appMatches.map(nodeVOToDisplay)
              : key === "skills"
                ? skillMatches.map(nodeVOToDisplay)
                : rowsForSection(key);
      const deduped = DEDUPED_SECTIONS.includes(key)
        ? rows.filter((row) => {
            if (seenHrefs.has(row.href)) return false;
            seenHrefs.add(row.href);
            return true;
          })
        : rows;
      if (deduped.length > 0) built.push({ key, rows: deduped });
    }
    return built;
  }, [
    sections,
    hasQuery,
    recentMatches,
    recentVisitedCount,
    appMatches,
    skillMatches,
    rowsForSection,
  ]);

  /**
   * The one flat list. `highlightedIndex`, the arrow keys and `Enter` all index
   * THIS — sections are drawn over it by offset (below) rather than owning
   * their own copies of the rows, so a heading can never drift out of step with
   * what Enter opens.
   */
  const visibleResults: DisplayResult[] = useMemo(
    () => populatedSections.flatMap((section) => section.rows),
    [populatedSections],
  );

  /**
   * Heading offsets into `visibleResults`.
   *
   * A single section gets no heading: with nothing to contrast against, the
   * label only repeats what the filter already says.
   */
  const resultSections = useMemo((): { at: number; title: string }[] => {
    if (populatedSections.length < 2) return [];
    let at = 0;
    return populatedSections.map((section) => {
      const entry = { at, title: sectionTitle[section.key] };
      at += section.rows.length;
      return entry;
    });
  }, [populatedSections, sectionTitle]);

  const sectionTitleAt = useCallback(
    (index: number) => resultSections.find((section) => section.at === index)?.title ?? null,
    [resultSections],
  );

  useEffect(() => {
    if (visibleResults.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((i) => Math.min(i, visibleResults.length - 1));
  }, [visibleResults.length]);

  // Tab still cycles the narrowing control, now that the control is a filter
  // rather than a tab strip — the keyboard habit survives the redesign.
  // Cycles the VISIBLE filters only: an anonymous visitor has fewer, and
  // landing on one they cannot see would be a dead end.
  const switchFilter = useCallback(
    (direction: 1 | -1) => {
      setFilter((current) => {
        const idx = visibleFilters.indexOf(current);
        const from = idx === -1 ? 0 : idx;
        return visibleFilters[
          (from + direction + visibleFilters.length) % visibleFilters.length
        ] as SearchFilterKey;
      });
    },
    [visibleFilters],
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
        switchFilter(event.shiftKey ? -1 : 1);
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
    [onClose, switchFilter, visibleResults, highlightedIndex, select],
  );

  // Grows every scoped request's page size at once. Per-section "load more"
  // would be better and is deliberately not attempted here: each section would
  // need its own `limit`, which changes the flat list's length from four
  // independent places and is exactly where an off-by-one puts `Enter` on the
  // wrong row. One shared page size keeps that invariant trivial.
  const canLoadMore = [recordsQuery, filesQuery, docContentQuery, baseNamesQuery].some(
    (q) => q.data?.hasMore ?? false,
  );
  const loadMore = useCallback(() => {
    setLimit((current) => current + 20);
  }, []);

  if (!open) {
    return null;
  }

  const nodeListError = [skillsQuery, appsQuery].some((q) => q.isError)
    ? messages.search.failed
    : null;
  const showLoadingIndicator =
    visibleResults.length === 0 &&
    (isSearching ||
      recentIsSearching ||
      (shows("apps") && appsQuery.isPending) ||
      (shows("skills") && skillsQuery.isPending));
  const visibleError = recentSearchError ?? searchError ?? nodeListError;

  // Every filter except the content-only ones has something to show before a
  // single character is typed — the things you own, not things you matched.
  const showsResultsWithoutQuery = sections.length > 0;
  const emptyState = !hasQuery
    ? filter === "apps"
      ? { title: messages.search.noAppsTitle, body: messages.search.noAppsBody }
      : filter === "skills"
        ? { title: messages.search.noSkillsTitle, body: messages.search.noSkillsBody }
        : { title: messages.search.noRecentTitle, body: messages.search.noRecentBody }
    : {
        title: messages.search.noMatchesTitle,
        body: contentTruncated ? messages.search.partialContentBody : messages.search.noMatchesBody,
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

        {/* One filter control where seven tabs used to be. Notion's search
            overlay narrows the same way — a control, not a mode — which is what
            lets every section stay on screen at once instead of one at a time. */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/50 hover:text-foreground sm:text-[13px]"
                type="button"
              >
                {filterLabel[filter]}
                <ChevronDown aria-hidden className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {visibleFilters.map((option) => (
                <DropdownMenuItem
                  key={option}
                  onSelect={() => {
                    setFilter(option);
                    setHighlightedIndex(0);
                  }}
                >
                  <Check
                    aria-hidden
                    className={cn("size-3.5", option === filter ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1">{filterLabel[option]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {filter !== "all" ? (
            <button
              className="text-muted-foreground text-xs underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={() => {
                setFilter("all");
                setHighlightedIndex(0);
              }}
              type="button"
            >
              {messages.search.filterAll}
            </button>
          ) : null}
        </div>

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
                  {hasQuery ? messages.search.searching : messages.search.searchingNodes}
                </div>
              ) : visibleResults.length > 0 ? (
                <>
                  <div className="space-y-0.5">
                    {visibleResults.map((result, index) => {
                      const sectionTitle = sectionTitleAt(index);
                      return (
                        <Fragment key={result.key}>
                          {sectionTitle ? (
                            <div
                              className={cn(
                                "px-2.5 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide",
                                index === 0 ? "pt-0.5" : "pt-3",
                              )}
                            >
                              {sectionTitle}
                            </div>
                          ) : null}
                          <SearchResultRow
                            highlighted={index === highlightedIndex}
                            onHighlight={() => setHighlightedIndex(index)}
                            onSelect={() => select(result)}
                            result={result}
                          />
                        </Fragment>
                      );
                    })}
                  </div>
                  {canLoadMore ? (
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
