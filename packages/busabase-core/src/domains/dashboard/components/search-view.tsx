"use client";

import { useQuery } from "@tanstack/react-query";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatListTime } from "../helpers/format";
import { searchKindIcon } from "../helpers/search";
import {
  clearNarrowing,
  DATE_PRESETS,
  type DatePresetKey,
  hasActiveNarrowing,
  parseSearchPageParams,
  presetToUpdatedAfter,
  SEARCH_PAGE_SORTS,
  SEARCH_PAGE_SOURCES,
  type SearchPageSource,
  type SearchPageState,
  serializeSearchPageParams,
} from "../helpers/search-page";

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
  locale,
  onFilterByAuthor,
  unknownAuthor,
}: {
  result: SearchResultVO;
  locale: string;
  onFilterByAuthor: (actorId: string) => void;
  unknownAuthor: string;
}) {
  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {searchKindIcon[result.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <Link className="block truncate font-medium text-foreground text-sm" href={result.href}>
          {result.title}
        </Link>
        {result.body ? (
          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{result.body}</p>
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

  const enabled = urlState.query.trim().length > 0;
  const results = useQuery({
    ...orpc.search.queryOptions({
      input: {
        query: urlState.query,
        limit: PAGE_SIZE * pages,
        sources: urlState.sources.length > 0 ? urlState.sources : undefined,
        sort: urlState.sort,
        updatedAfter,
        inNodeId: urlState.inNodeId || undefined,
        createdBy: urlState.createdBy || undefined,
      },
    }),
    enabled,
  });

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
  const hasMore = results.data?.hasMore ?? false;
  const narrowed = hasActiveNarrowing(urlState);

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
              ...SEARCH_PAGE_SOURCES.map((s) => ({ key: s, label: sourceLabels[s] })),
            ]}
            value={
              urlState.sources.length === 1 && urlState.sources[0]
                ? sourceLabels[urlState.sources[0]]
                : t.sourceAll
            }
          />
          <FilterMenu
            label={t.sortLabel}
            onSelect={(key) =>
              apply({ ...urlState, sort: key as (typeof SEARCH_PAGE_SORTS)[number] })
            }
            options={SEARCH_PAGE_SORTS.map((s) => ({ key: s, label: sortLabels[s] }))}
            value={sortLabels[urlState.sort]}
          />
          <FilterMenu
            label={t.whenLabel}
            onSelect={(key) => apply({ ...urlState, datePreset: key as DatePresetKey })}
            options={DATE_PRESETS.map((p) => ({ key: p, label: whenLabels[p] }))}
            value={whenLabels[urlState.datePreset]}
          />
          {urlState.createdBy ? (
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
        {!enabled ? (
          <EmptyState body={t.emptyBody} title={t.emptyTitle} hint={t.appsElsewhere} />
        ) : results.isPending ? (
          <p className="px-3 py-6 text-muted-foreground text-sm">{t.loading}</p>
        ) : results.isError ? (
          <p className="px-3 py-6 text-destructive text-sm">{t.failed}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            body={narrowed ? t.noMatchesWithFilters : t.noMatchesBody}
            title={t.noMatchesTitle}
            hint={t.appsElsewhere}
          />
        ) : (
          <>
            <p className="px-3 pb-2 text-muted-foreground text-xs">
              {fmt(t.resultCount, { count: String(rows.length) })}
            </p>
            <div className="space-y-0.5">
              {rows.map((result) => (
                <ResultRow
                  key={`${result.kind}-${result.id}`}
                  locale={locale}
                  onFilterByAuthor={(actorId) => apply({ ...urlState, createdBy: actorId })}
                  result={result}
                  unknownAuthor={t.authorUnknown}
                />
              ))}
            </div>
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
