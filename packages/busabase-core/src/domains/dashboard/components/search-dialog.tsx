import { useQuery } from "@tanstack/react-query";
import { Kbd } from "kui/kbd";
import { Tabs, TabsList, TabsTrigger } from "kui/tabs";
import { cn } from "kui/utils";
import { CornerDownLeft, Search, X } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusabaseQueryUtils } from "../../../api-client/react-query";
import type {
  BaseVO,
  ChangeRequestVO,
  RecordVO,
  SearchResultKind,
  SearchResultVO,
} from "../../../types";
import { normalizeSearchText, searchKindIcon } from "../helpers/search";
import { EmptyState } from "./primitives";

type SearchTab = "all" | "records" | "bases" | "change_requests";
const SEARCH_TABS: SearchTab[] = ["all", "records", "bases", "change_requests"];
const TAB_LABEL: Record<SearchTab, string> = {
  all: "All",
  records: "Records",
  bases: "Bases",
  change_requests: "Change Requests",
};
const TAB_KIND: Record<SearchTab, SearchResultKind | null> = {
  all: null,
  records: "record",
  bases: "base",
  change_requests: "change_request",
};

export function SearchDialog({
  bases,
  orpc,
  changeRequests,
  onClose,
  open,
  records,
}: {
  bases: BaseVO[];
  orpc: BusabaseQueryUtils;
  changeRequests: ChangeRequestVO[];
  onClose: () => void;
  open: boolean;
  records: RecordVO[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Pagination grows the page size (offset stays 0) so React Query owns the full list.
  const [limit, setLimit] = useState(20);
  const hasQuery = normalizeSearchText(query).length > 0;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Debounce typing into the query that actually drives the request.
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
      setTab("all");
      setHighlightedIndex(0);
      setLimit(20);
    }
  }, [open]);

  const searchQuery = useQuery({
    ...orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
    enabled: open && debouncedQuery.length > 0,
  });
  const response = searchQuery.data ?? null;
  const allResults = response?.results ?? [];
  const isSearching = searchQuery.isFetching;
  const searchError = searchQuery.isError
    ? searchQuery.error instanceof Error
      ? searchQuery.error.message
      : "Search failed"
    : null;

  // "All" tab excludes change_request; other tabs filter by kind.
  const visibleResults = useMemo(() => {
    if (tab === "all") return allResults.filter((r) => r.kind !== "change_request");
    const kind = TAB_KIND[tab];
    return kind ? allResults.filter((r) => r.kind === kind) : allResults;
  }, [allResults, tab]);

  // Tab result counts (for badges).
  const tabCount = useCallback(
    (t: SearchTab) => {
      if (t === "all") return allResults.filter((r) => r.kind !== "change_request").length;
      const kind = TAB_KIND[t];
      return kind ? allResults.filter((r) => r.kind === kind).length : allResults.length;
    },
    [allResults],
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
          onClose();
          // Navigate to the result href — use a real anchor click so SPALink intercepts it.
          const anchor = document.createElement("a");
          anchor.href = result.href;
          anchor.click();
        }
      }
    },
    [onClose, switchTab, visibleResults, highlightedIndex],
  );

  const loadMore = useCallback(() => {
    if (response?.hasMore) {
      setLimit((current) => current + 20);
    }
  }, [response?.hasMore]);

  if (!open) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: intentional modal backdrop
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop uses onKeyDown, click is backdrop dismiss
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-3 pt-[12vh] backdrop-blur-[1px]"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <button
        aria-label="Close search"
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
            placeholder="Search records, bases, change requests…"
            ref={inputRef}
            type="search"
            value={query}
          />
          <button
            aria-label="Close search"
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
          <TabsList className="h-auto w-full justify-start gap-1 border-b bg-transparent px-3 py-2">
            {SEARCH_TABS.map((t) => {
              const count = hasQuery ? tabCount(t) : null;
              return (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="group h-7 gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  {TAB_LABEL[t]}
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
          {hasQuery ? (
            <div>
              {searchError ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm">
                  {searchError}
                </div>
              ) : null}
              {isSearching && visibleResults.length === 0 ? (
                <div className="px-1 py-10 text-center text-muted-foreground text-sm">
                  Searching indexed fields…
                </div>
              ) : visibleResults.length > 0 ? (
                <>
                  <div className="space-y-0.5">
                    {visibleResults.map((result, index) => (
                      <SearchResultRow
                        key={`${result.kind}-${result.id}`}
                        highlighted={index === highlightedIndex}
                        onHighlight={() => setHighlightedIndex(index)}
                        onSelect={onClose}
                        result={result}
                      />
                    ))}
                  </div>
                  {response?.hasMore && tab !== "change_requests" ? (
                    <button
                      className="mt-3 rounded-lg border bg-background px-3 py-2 font-medium text-sm transition-colors hover:bg-accent/40 disabled:opacity-60"
                      disabled={isSearching}
                      onClick={loadMore}
                      type="button"
                    >
                      {isSearching ? "Loading" : "Load more"}
                    </button>
                  ) : null}
                </>
              ) : (
                <EmptyState title="No matches" body="Try a title, field name, channel, or Base." />
              )}
            </div>
          ) : (
            <SearchLanding bases={bases} changeRequests={changeRequests} records={records} />
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

function SearchLanding({
  bases,
  changeRequests,
  records,
}: {
  bases: BaseVO[];
  changeRequests: ChangeRequestVO[];
  records: RecordVO[];
}) {
  return (
    <div className="grid max-w-4xl gap-3 md:grid-cols-3">
      <SearchMetric label="Records" value={records.length} />
      <SearchMetric label="Change Requests" value={changeRequests.length} />
      <SearchMetric label="Bases" value={bases.length} />
    </div>
  );
}

function SearchMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background/45 p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-[0.12em]">{label}</div>
      <div className="mt-2 font-semibold text-2xl">{value}</div>
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
  onSelect?: () => void;
  result: SearchResultVO;
}) {
  return (
    <Link
      className={cn(
        "group flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-foreground transition-colors",
        highlighted ? "bg-muted" : "hover:bg-muted/60",
      )}
      href={result.href}
      onClick={onSelect}
      onMouseEnter={onHighlight}
    >
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
        {searchKindIcon[result.kind]}
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
    </Link>
  );
}
