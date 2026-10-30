import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getVisibleViewFieldSlugs } from "busabase-contract/types";
import { useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { orderViews, resolveActiveView } from "../utils/base-views";
import {
  FIRST_RECORD_PAGE,
  fetchRecordPage,
  nextRecordPageParam,
  RECORDS_PAGE_SIZE,
  type RecordPageParam,
  recordsForDisplay,
  recordTotalFromPages,
} from "../utils/record-pagination";

export type BaseDisplayMode = "list" | "table";

export function useBaseDetailController(slug: string) {
  const busabase = useBusabaseOrpc();
  // The view the user picked. `null` = not picked yet → the Base's first view.
  const [selectedViewId, setActiveViewId] = useState<string | null>(null);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<BaseDisplayMode>("list");
  const [actionsOpen, setActionsOpen] = useState(false);

  const basesQuery = useQuery(
    busabase
      ? busabase.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const base = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const viewsQuery = useQuery(
    busabase && base
      ? busabase.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );
  const views = useMemo(() => orderViews(viewsQuery.data ?? []), [viewsQuery.data]);
  // Every Base has at least one saved view and opens on its first (leftmost)
  // one — there is no unsaved "All" option. `null` only for a Base with no
  // views at all, which then lists every record unfiltered rather than crash.
  const activeView = resolveActiveView(views, selectedViewId);
  const activeViewId = activeView?.id ?? null;
  // Records wait for the view list: fetching before it arrives would load the
  // unfiltered Base first and then refetch for the first view — a flash of the
  // wrong rows. A failed view list still settles, falling back to all records.
  const viewsSettled = Boolean(base) && !viewsQuery.isPending;

  // The active View is part of the key AND part of the request: the server
  // filters and sorts by it before computing totals and slicing pages, so a
  // different View is a different result set, not a narrowing of this one.
  const recordsQuery = useInfiniteQuery({
    queryKey: [
      "base-records",
      busabase?.serverUrl,
      busabase?.spaceScope,
      base?.id,
      activeViewId,
      RECORDS_PAGE_SIZE,
    ],
    queryFn:
      busabase && base && viewsSettled
        ? ({ pageParam }: { pageParam: RecordPageParam }) =>
            fetchRecordPage(busabase.client.records, base.id, activeViewId, pageParam)
        : skipToken,
    initialPageParam: FIRST_RECORD_PAGE,
    getNextPageParam: nextRecordPageParam,
  });
  const records = useMemo(() => {
    const pages = recordsQuery.data?.pages ?? [];
    // Still scoped to this Base: `records.list` may span the space when the
    // fallback path runs, and a stale page from a previous Base must not leak
    // into this one.
    const scoped = pages.map((page) => ({
      ...page,
      records: page.records.filter((record) => record.baseId === base?.id),
    }));
    return recordsForDisplay(scoped, activeView?.config);
  }, [recordsQuery.data, base?.id, activeView]);
  const recordTotal = useMemo(
    () => recordTotalFromPages(recordsQuery.data?.pages ?? []),
    [recordsQuery.data],
  );
  const visibleFields = useMemo(() => {
    const allFields = base?.fields ?? [];
    if (!activeView) return allFields;
    return getVisibleViewFieldSlugs(activeView.config, allFields)
      .map((fieldSlug) => allFields.find((field) => field.slug === fieldSlug))
      .filter((field): field is NonNullable<typeof field> => Boolean(field));
  }, [base?.fields, activeView]);
  const previewFields = useMemo(() => {
    const primaryFieldId = base?.fields[0]?.id;
    return visibleFields.filter((field) => field.id !== primaryFieldId);
  }, [base?.fields, visibleFields]);

  const refresh = () => {
    void basesQuery.refetch();
    void recordsQuery.refetch();
    void viewsQuery.refetch();
  };

  return {
    actionsOpen,
    activeView,
    base,
    basesQuery,
    displayMode,
    error: basesQuery.error ?? recordsQuery.error,
    loading: basesQuery.isLoading || (Boolean(base) && recordsQuery.isPending),
    previewFields,
    records,
    recordsQuery,
    recordTotal,
    refresh,
    selectedViewId: activeViewId,
    selectedViewLabel: activeView?.name ?? "",
    setActionsOpen,
    setActiveViewId,
    setDisplayMode,
    setViewPickerOpen,
    viewPickerOpen,
    views,
  };
}

export type BaseDetailController = ReturnType<typeof useBaseDetailController>;
