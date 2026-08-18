import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  normalizeRecordsPage,
  RECORDS_PAGE_SIZE,
  scopeRecordsPageToBase,
} from "../utils/record-pagination";
import { applyViewConfig } from "../utils/view-config";

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

  const recordsQuery = useInfiniteQuery({
    queryKey: [
      "base-records",
      busabase?.serverUrl,
      busabase?.spaceScope,
      base?.id,
      RECORDS_PAGE_SIZE,
    ],
    queryFn:
      busabase && base
        ? async ({ pageParam }) =>
            normalizeRecordsPage(
              scopeRecordsPageToBase(
                await busabase.client.records.list({
                  baseId: base.id,
                  cursor: pageParam,
                  limit: RECORDS_PAGE_SIZE,
                }),
                base.id,
              ),
              pageParam,
            )
        : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const viewsQuery = useQuery(
    busabase && base
      ? busabase.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );
  const views = viewsQuery.data ?? [];
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const records = useMemo(() => {
    const baseRecords =
      recordsQuery.data?.pages
        .flatMap((page) => page.records)
        .filter((record) => record.baseId === base?.id) ?? [];
    return applyViewConfig(baseRecords, activeView?.config);
  }, [recordsQuery.data, base?.id, activeView]);
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
    base,
    basesQuery,
    displayMode,
    error: basesQuery.error ?? recordsQuery.error,
    loading: basesQuery.isLoading || (Boolean(base) && recordsQuery.isPending),
    previewFields,
    records,
    recordsQuery,
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
