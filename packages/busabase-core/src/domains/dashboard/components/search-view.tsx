"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { SearchResultVO } from "busabase-contract/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatListTime } from "../helpers/format";
import { highlightSearchText, searchKindIcon, searchSnippetText } from "../helpers/search";
import {
  clearNarrowing,
  DATE_PRESETS,
  type DatePresetKey,
  hasActiveNarrowing,
  isGrepSource,
  isValidPattern,
  parseSearchPageParams,
  patternFlags,
  presetToUpdatedAfter,
  SEARCH_PAGE_SORTS,
  type SearchPageSource,
  type SearchPageState,
  SUPPORTS_NARROWING,
  serializeSearchPageParams,
  sourcesForMode,
} from "../helpers/search-page";
import { GrepCoverageNote, GrepMatchRow, hitKey } from "./grep-results";

/** One page of results. Matches the procedure's own default rather than inventing one. */
const PAGE_SIZE = 20;

function FilterMenu({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: { key: string; label: string }[];
  onSelect: (key: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-foreground text-sm transition-colors hover:bg-muted"
        type="button"
      >
        <span className="text-muted-foreground">{label}</span>
        <span>{value}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((option) => (
          <DropdownMenuItem key={option.key} onSelect={() => onSelect(option.key)}>
            <span className="flex-1">{option.label}</span>
            {option.label === value ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ResultRow({
  result,
  query,
  locale,
  onFilterByAuthor,
  onSelect,
  unknownAuthor,
}: {
  result: SearchResultVO;
  query: string;
  locale: string;
  onFilterByAuthor: (actorId: string) => void;
  onSelect: () => void;
  unknownAuthor: string;
}) {
  const body = result.body ? searchSnippetText(result.body) : "";
  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {searchKindIcon[result.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          className="block truncate font-medium text-foreground text-sm"
          href={result.href}
          onClick={onSelect}
        >
          {highlightSearchText(result.title, query)}
        </Link>
        {body ? (
          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
            {highlightSearchText(body, query)}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {result.eyebrow ? <span className="truncate">{result.eyebrow}</span> : null}
          {result.updatedAt ? <span>{formatListTime(result.updatedAt, locale)}</span> : null}
          {/*
            The author is a BUTTON when known and plain text when not. That is
            the whole author-filter affordance: you can only filter by a creator
            you can see, which sidesteps having to guess the spelling of an
            actor id that may belong to an agent rather than a person.
          */}
          {result.createdBy ? (
            <button
              className="rounded px-1 underline-offset-2 hover:underline"
              onClick={() => onFilterByAuthor(result.createdBy as string)}
              type="button"
            >
              {result.createdBy}
            </button>
          ) : (
            <span className="opacity-70">{unknownAuthor}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchView({ orpc }: { orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const t = messages.searchPage;
  const search = useSearch();
  const [, navigate] = useLocation();
  const reportSearchMetric = useMutation({
    ...orpc.searchMetrics.report.mutationOptions(),
    onError: () => undefined,
  });
  const searchSessionRef = useRef<{
    key: string;
    id: string;
    startedAt: number;
    reported: boolean;
  } | null>(null);
  const ensureSearchSession = useCallback(() => {
    if (searchSessionRef.current?.key !== search) {
      searchSessionRef.current = {
        key: search,
        id: globalThis.crypto.randomUUID(),
        startedAt: Date.now(),
        reported: false,
      };
    }
    return searchSessionRef.current;
  }, [search]);

  const urlState = useMemo(() => parseSearchPageParams(search), [search]);
  // The input is local so typing stays responsive; the URL is updated on submit
  // and on every filter change. Pushing a history entry per keystroke would make
  // the back button walk through half-typed queries.
  const [draft, setDraft] = useState(urlState.query);
  useEffect(() => setDraft(urlState.query), [urlState.query]);

  const [pages, setPages] = useState(1);
  // Any change to what is being asked resets paging — keeping page 3 while the
  // filters change would show "load more" over a result set that no longer has
  // the rows those offsets referred to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the serialized query, not on object identity
  useEffect(() => setPages(1), [search]);

  const apply = useCallback(
    (next: SearchPageState) => {
      const query = serializeSearchPageParams(next);
      navigate(query ? `/search?${query}` : "/search");
    },
    [navigate],
  );

  const updatedAfter = useMemo(
    // `new Date()` is read at render rather than being frozen in state: a page
    // left open overnight should mean "past 7 days" from now, not from whenever
    // it was opened.
    () => presetToUpdatedAfter(urlState.datePreset, new Date()),
    [urlState.datePreset],
  );

  const isRegex = urlState.mode === "regex";
  const supports = SUPPORTS_NARROWING[urlState.mode];
  const flags = patternFlags(urlState);
  // Compiled in the browser before anything is sent: an unbalanced bracket is
  // otherwise a 400 carrying a raw engine message, shown to someone who is
  // still typing.
  const patternOk = !isRegex || isValidPattern(urlState.query, flags);
  const enabled = urlState.query.trim().length > 0 && patternOk;
  useEffect(() => {
    if (!enabled) {
      searchSessionRef.current = null;
      return;
    }
    // Pattern search is a different endpoint and result language; do not
    // report it as an advanced full-text search session.
    if (!isRegex) ensureSearchSession();
  }, [enabled, isRegex, ensureSearchSession]);
  const results = useQuery({
    ...orpc.search.queryOptions({
      input: {
        query: urlState.query,
        mode: "full",
        surface: "advanced",
        limit: PAGE_SIZE * pages,
        sources: urlState.sources.length > 0 ? urlState.sources : undefined,
        sort: urlState.sort,
        updatedAfter,
        inNodeId: urlState.inNodeId || undefined,
        createdBy: urlState.createdBy || undefined,
      },
    }),
    enabled: enabled && !isRegex,
  });

  // `maxMatches` rides the same "load more" counter as text search, so the one
  // button means the same thing in both modes.
  const grepSources = urlState.sources.filter(isGrepSource);
  const grepResults = useQuery({
    ...orpc.grep.queryOptions({
      input: {
        pattern: urlState.query,
        flags,
        // OMITTED means "all three" to this endpoint; an empty array means
        // "scan nothing", which returns a confident zero with a coverage block
        // reporting everything read. Same shape the text branch uses above.
        sources: grepSources.length > 0 ? grepSources : undefined,
        maxMatches: PAGE_SIZE * pages,
      },
    }),
    enabled: enabled && isRegex,
    // One refusal is the answer; retrying a pattern the server rejected just
    // spends the scan budget again.
    retry: false,
  });

  const active = isRegex ? grepResults : results;

  const sourceLabels: Record<SearchPageSource, string> = {
    records: t.sourceRecords,
    files: t.sourceFiles,
    nodes: t.sourceNodes,
    names: t.sourceNames,
  };
  const sortLabels: Record<(typeof SEARCH_PAGE_SORTS)[number], string> = {
    relevance: t.sortRelevance,
    updated_desc: t.sortUpdatedDesc,
    updated_asc: t.sortUpdatedAsc,
    created_desc: t.sortCreatedDesc,
    created_asc: t.sortCreatedAsc,
  };
  const whenLabels: Record<DatePresetKey, string> = {
    any: t.whenAny,
    "7d": t.when7d,
    "30d": t.when30d,
    "365d": t.when365d,
  };

  const rows = results.data?.results ?? [];
  const matches = grepResults.data?.matches ?? [];
  const hasMore = isRegex
    ? (grepResults.data?.truncated ?? false)
    : (results.data?.hasMore ?? false);
  const narrowed = hasActiveNarrowing(urlState);
  const resultCount = isRegex ? matches.length : rows.length;

  useEffect(() => {
    if (!enabled || isRegex || !results.isSuccess) return;
    const session = ensureSearchSession();
    if (session.reported) return;
    session.reported = true;
    reportSearchMetric.mutate({
      event: "results_shown",
      sessionId: session.id,
      surface: "advanced",
      resultCount: rows.length,
      durationMs: Math.min(120_000, Date.now() - session.startedAt),
      hasMore,
    });
  }, [
    enabled,
    isRegex,
    results.isSuccess,
    ensureSearchSession,
    reportSearchMetric,
    rows.length,
    hasMore,
  ]);

  return (
    // `h-full` and `min-h-0`: the dashboard mounts a view into a block slot, so
    // a view that only sets `flex-1` gets silently cropped with no scrollbar.
    <section className="flex h-full min-h-0 flex-col" data-dashboard-scroll="search">
      <div className="shrink-0 border-border border-b px-6 py-4">
        <h1 className="font-semibold text-foreground text-lg">{t.title}</h1>
        <form
          className="mt-3 flex items-center gap-2 rounded-lg border border-border px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ ...urlState, query: draft });
          }}
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label={t.title}
            className="min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.placeholder}
            value={draft}
          />
          {draft ? (
            <button
              aria-label={t.clearFilters}
              onClick={() => {
                setDraft("");
                apply({ ...urlState, query: "" });
              }}
              type="button"
            >
              <X className="size-4 text-muted-foreground hover:text-foreground" />
            </button>
          ) : null}
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* The mode switch comes FIRST because it decides which of the
              controls after it exist at all. */}
          <FilterMenu
            label={t.modeLabel}
            onSelect={(key) =>
              apply({
                ...urlState,
                // Switching mode is itself a submission gesture. Preserve
                // what is visibly in the input even if Enter was not pressed.
                query: draft,
                mode: key === "regex" ? "regex" : "text",
                // Sources the new mode cannot scan would otherwise survive the
                // switch as an invisible filter.
                sources: urlState.sources.filter(
                  (source) => key !== "regex" || isGrepSource(source),
                ),
                // `inNodeId` means a text-search subtree. Grep has only
                // source-specific scopes, so keeping it would make the URL
                // claim a restriction the request did not execute.
                inNodeId: key === "regex" ? "" : urlState.inNodeId,
              })
            }
            options={[
              { key: "text", label: t.modeText },
              { key: "regex", label: t.modeRegex },
            ]}
            value={isRegex ? t.modeRegex : t.modeText}
          />
          <FilterMenu
            label={t.sourceLabel}
            onSelect={(key) =>
              apply({
                ...urlState,
                sources: key === "all" ? [] : [key as SearchPageSource],
              })
            }
            options={[
              { key: "all", label: t.sourceAll },
              ...sourcesForMode(urlState.mode).map((s) => ({ key: s, label: sourceLabels[s] })),
            ]}
            value={
              urlState.sources.length === 1 && urlState.sources[0]
                ? sourceLabels[urlState.sources[0]]
                : t.sourceAll
            }
          />
          {/* Absent, not disabled: grep takes no sort, no date bound and no
              author, so rendering them greyed out would still suggest this page
              could apply them. */}
          {supports.sort ? (
            <FilterMenu
              label={t.sortLabel}
              onSelect={(key) =>
                apply({ ...urlState, sort: key as (typeof SEARCH_PAGE_SORTS)[number] })
              }
              options={SEARCH_PAGE_SORTS.map((s) => ({ key: s, label: sortLabels[s] }))}
              value={sortLabels[urlState.sort]}
            />
          ) : null}
          {supports.datePreset ? (
            <FilterMenu
              label={t.whenLabel}
              onSelect={(key) => apply({ ...urlState, datePreset: key as DatePresetKey })}
              options={DATE_PRESETS.map((p) => ({ key: p, label: whenLabels[p] }))}
              value={whenLabels[urlState.datePreset]}
            />
          ) : null}
          {supports.caseSensitive ? (
            <FilterMenu
              label={t.caseLabel}
              onSelect={(key) => apply({ ...urlState, caseSensitive: key === "sensitive" })}
              options={[
                { key: "insensitive", label: t.caseInsensitive },
                { key: "sensitive", label: t.caseSensitive },
              ]}
              value={urlState.caseSensitive ? t.caseSensitive : t.caseInsensitive}
            />
          ) : null}
          {supports.createdBy && urlState.createdBy ? (
            <button
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm"
              onClick={() => apply({ ...urlState, createdBy: "" })}
              type="button"
            >
              <span className="text-muted-foreground">{t.authorLabel}</span>
              <span>{urlState.createdBy}</span>
              <X className="size-3.5 text-muted-foreground" />
            </button>
          ) : null}
          {narrowed ? (
            <button
              className="text-muted-foreground text-sm underline-offset-2 hover:underline"
              onClick={() => apply(clearNarrowing(urlState))}
              type="button"
            >
              {t.clearFilters}
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {!patternOk
            ? t.patternInvalid
            : active.isPending
              ? t.loading
              : active.isError
                ? t.failed
                : resultCount > 0
                  ? fmt(isRegex ? t.patternMatchCount : t.resultCount, {
                      count: String(resultCount),
                    })
                  : enabled
                    ? t.noMatchesTitle
                    : ""}
        </div>
        {!patternOk ? (
          // Its own branch, above the generic empty state: "that is not a
          // regular expression" is a different thing to tell someone than
          // "nothing matched".
          <p className="px-3 py-6 text-destructive text-sm">{t.patternInvalid}</p>
        ) : !enabled ? (
          <EmptyState body={t.emptyBody} title={t.emptyTitle} hint={t.appsElsewhere} />
        ) : active.isPending ? (
          <p className="px-3 py-6 text-muted-foreground text-sm">{t.loading}</p>
        ) : active.isError ? (
          <div className="px-3 py-6 text-destructive text-sm">
            <p>{t.failed}</p>
            <button
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-muted"
              onClick={() => active.refetch()}
              type="button"
            >
              {messages.search.retry}
            </button>
          </div>
        ) : resultCount === 0 ? (
          <>
            <EmptyState
              body={narrowed ? t.noMatchesWithFilters : t.noMatchesBody}
              title={t.noMatchesTitle}
              hint={t.appsElsewhere}
            />
            {/* Shown even with zero hits — especially with zero hits. "Nothing
                matched" and "most of it was never opened" look identical
                without it. */}
            {isRegex && grepResults.data ? (
              <GrepCoverageNote
                coverage={grepResults.data.coverage}
                truncated={grepResults.data.truncated}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="px-3 pb-2 text-muted-foreground text-xs">
              {fmt(isRegex ? t.patternMatchCount : t.resultCount, { count: String(resultCount) })}
            </p>
            <div className="space-y-0.5">
              {isRegex
                ? matches.map((match) => (
                    <GrepMatchRow currentSearch={search} key={hitKey(match)} match={match} />
                  ))
                : rows.map((result, index) => (
                    <ResultRow
                      key={`${result.kind}-${result.id}`}
                      locale={locale}
                      onFilterByAuthor={(actorId) => apply({ ...urlState, createdBy: actorId })}
                      onSelect={() =>
                        reportSearchMetric.mutate({
                          event: "result_click",
                          sessionId: ensureSearchSession().id,
                          surface: "advanced",
                          position: index + 1,
                          resultKind: result.kind,
                        })
                      }
                      query={urlState.query}
                      result={result}
                      unknownAuthor={t.authorUnknown}
                    />
                  ))}
            </div>
            {isRegex && grepResults.data ? (
              <GrepCoverageNote
                coverage={grepResults.data.coverage}
                truncated={grepResults.data.truncated}
              />
            ) : null}
            {hasMore ? (
              <button
                className="mt-3 w-full rounded-lg border border-border py-2 text-muted-foreground text-sm transition-colors hover:bg-muted"
                onClick={() => setPages((n) => n + 1)}
                type="button"
              >
                {t.loadMore}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function EmptyState({ body, hint, title }: { body: string; hint: string; title: string }) {
  return (
    <div className="px-3 py-10 text-center">
      <p className="font-medium text-foreground text-sm">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-muted-foreground text-xs">{body}</p>
      <p className="mt-3 text-muted-foreground text-xs opacity-80">{hint}</p>
    </div>
  );
}
