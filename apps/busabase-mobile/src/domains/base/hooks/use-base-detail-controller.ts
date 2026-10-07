import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
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
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
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
      busabase && base
        ? ({ pageParam }: { pageParam: RecordPageParam }) =>
            fetchRecordPage(busabase.client.records, base.id, activeViewId, pageParam)
        : skipToken,
    initialPageParam: FIRST_RECORD_PAGE,
    getNextPageParam: nextRecordPageParam,
  });

  const viewsQuery = useQuery(
    busabase && base
      ? busabase.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );
  const views = viewsQuery.data ?? [];
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
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
    const visibleSlugs = activeView?.config.visibleFieldSlugs;
    if (Array.isArray(visibleSlugs) && visibleSlugs.length > 0) {
      return visibleSlugs
        .map((fieldSlug) => allFields.find((field) => field.slug === fieldSlug))
        .filter((field): field is NonNullable<typeof field> => Boolean(field));
    }
    return allFields;
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
    selectedViewId: activeView?.id ?? null,
    selectedViewLabel: activeView?.name ?? "All",
    setActionsOpen,
    setActiveViewId,
    setDisplayMode,
    setViewPickerOpen,
    viewPickerOpen,
    views,
  };
}

export type BaseDetailController = ReturnType<typeof useBaseDetailController>;
