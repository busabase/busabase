import { type QueryKey, type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseVO, RecordVO } from "busabase-contract/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { getPrimaryField } from "../../base/utils/primary-field";
import { getRelationRecordIds } from "../helpers/field";
import { retryRecordRead } from "../helpers/query-state";
import {
  type GridGroupBucket,
  gridGroupFilter,
  orderGridGroups,
  type ResolvedViewGrouping,
} from "../helpers/view-grouping";
import type { SummaryAggregate } from "../helpers/view-summaries";
import { useDashboardOrpc } from "../orpc-context";
import { useLinkedRecords } from "./use-linked-records";

/** Rows per request inside one group, like a Kanban column pages its cards. */
export const GRID_GROUP_PAGE_SIZE = 50;

type GroupPage = Awaited<ReturnType<BusabaseDashboardApiClient["listRecordsPage"]>>;

/**
 * The part of each page query a grouped table reads. Module-level so its
 * identity is stable: `useQueries` re-runs `combine` only when a result or the
 * function itself changes, and structurally shares what it returns.
 */
const combineGroupPages = (results: UseQueryResult<GroupPage>[]) =>
  results.map((result) => ({
    data: result.data,
    isError: result.isError,
    isFetching: result.isFetching,
    refetch: result.refetch,
  }));

export interface GroupedGridGroup extends GridGroupBucket {
  /** Loaded rows, in the view's order, de-duplicated across pages. */
  records: RecordVO[];
  collapsed: boolean;
  status: "pending" | "error" | "ready";
  hasMore: boolean;
  isLoadingMore: boolean;
}

export interface GroupedGridData {
  status: "pending" | "error" | "ready";
  error: unknown;
  /** Exact records in the view (filters + find), from `records.groupBy`. */
  total: number;
  groups: GroupedGridGroup[];
  /** Rows of every expanded group, in display order. */
  records: RecordVO[];
  /** Records the loaded rows link to, for relation chips. */
  relationRecords: RecordVO[];
  isFetching: boolean;
  toggleCollapsed: (groupId: string) => void;
  loadMore: (groupId: string) => void;
  retry: () => void;
}

/**
 * Data for a grouped table, built the way a Kanban board loads its columns:
 * ONE `records.groupBy` call gives every group's exact count (and the
 * aggregates its header summaries need), and each expanded group then pages
 * its own rows through `records.listPage` with the view, the find and a filter
 * selecting exactly that bucket. Collapsed groups fetch nothing.
 *
 * Every key sits under the `records.listPage` prefix, so the invalidation that
 * refreshes an ungrouped grid after an edit (or a live-sync event) refreshes
 * counts, summaries and rows here too — a record whose group changed moves.
 */
export function useGroupedGridData({
  aggregates,
  base,
  client,
  find,
  grouping,
  listMode,
  viewId,
}: {
  aggregates: SummaryAggregate[];
  base: BaseVO;
  client: BusabaseDashboardApiClient;
  find?: { query: string; fieldId?: string };
  grouping: ResolvedViewGrouping;
  listMode?: "full" | "table";
  viewId: string;
}): GroupedGridData {
  const orpc = useDashboardOrpc();
  const prefix = (orpc?.records.listPage.key() ?? ["busabase"]) as QueryKey;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [pageCounts, setPageCounts] = useState<Readonly<Record<string, number>>>({});
  const field = grouping.field;

  const groupsQuery = useQuery({
    queryKey: [...prefix, "grid-groups", base.id, viewId, field.slug, find ?? null, aggregates],
    queryFn: () =>
      client.groupRecords({
        baseId: base.id,
        viewId,
        fieldSlug: field.slug,
        ...(find ? { find } : {}),
        ...(aggregates.length ? { aggregates } : {}),
      }),
    placeholderData: (previous) => previous,
    retry: retryRecordRead,
  });
  // Keyed on the field and direction, not on `grouping` itself: callers derive
  // that object per render, and a fresh identity must not rebuild the rows.
  const direction = grouping.direction;
  const buckets = useMemo(
    () => (groupsQuery.data ? orderGridGroups({ field, direction }, groupsQuery.data.groups) : []),
    [groupsQuery.data, field, direction],
  );

  const pageRequests = useMemo(
    () =>
      buckets.flatMap((bucket) =>
        collapsed.has(bucket.id)
          ? []
          : Array.from({ length: pageCounts[bucket.id] ?? 1 }, (_, index) => ({
              bucket,
              page: index + 1,
            })),
      ),
    [buckets, collapsed, pageCounts],
  );
  // `combine` hands back a structurally shared array, so it keeps its identity
  // while no page changed — which is what keeps `groups` (and the table's row
  // list) stable across idle renders.
  const pageQueries = useQueries({
    combine: combineGroupPages,
    queries: pageRequests.map(({ bucket, page }) => ({
      queryKey: [
        ...prefix,
        "grid-group-rows",
        base.id,
        viewId,
        field.slug,
        bucket.id,
        page,
        GRID_GROUP_PAGE_SIZE,
        find ?? null,
        listMode ?? "full",
      ],
      queryFn: () =>
        client.listRecordsPage({
          baseId: base.id,
          viewId,
          filters: [gridGroupFilter(field, bucket.key)],
          ...(find ? { find } : {}),
          page,
          pageSize: GRID_GROUP_PAGE_SIZE,
          // A group's exact size is already known from `records.groupBy`; count
          // only one past this page, as a Kanban column does.
          totalLimit: page * GRID_GROUP_PAGE_SIZE + 1,
          ...(listMode ? { listMode } : {}),
        }),
      placeholderData: (previous: unknown) => previous,
      retry: retryRecordRead,
    })),
  });

  const groups = useMemo<GroupedGridGroup[]>(
    () =>
      buckets.map((bucket) => {
        const isCollapsed = collapsed.has(bucket.id);
        const pages = pageRequests.flatMap((request, index) =>
          request.bucket.id === bucket.id ? [pageQueries[index]] : [],
        );
        const seen = new Set<string>();
        const records = pages.flatMap((query) =>
          (query?.data?.records ?? []).filter((record) => {
            if (seen.has(record.id)) return false;
            seen.add(record.id);
            return true;
          }),
        );
        const last = pages.at(-1);
        const lastData = last?.data;
        const first = pages[0];
        return {
          ...bucket,
          records,
          collapsed: isCollapsed,
          status: isCollapsed
            ? "ready"
            : first?.isError && !first.data
              ? "error"
              : !first?.data
                ? "pending"
                : "ready",
          hasMore: Boolean(
            !isCollapsed &&
              lastData &&
              (lastData.totalCapped || lastData.page < lastData.totalPages) &&
              records.length < bucket.count,
          ),
          isLoadingMore: Boolean(pages.length > 1 && last && !last.data && !last.isError),
        };
      }),
    [buckets, collapsed, pageRequests, pageQueries],
  );
  const records = useMemo(
    () => groups.flatMap((group) => (group.collapsed ? [] : group.records)),
    [groups],
  );

  // Relation chips in the rows read their targets' titles, like a Kanban column.
  const primarySlug = getPrimaryField(base)?.slug;
  const relationIds = useMemo(() => {
    const relationFields = base.fields.filter(
      (candidate) => candidate.type === "relation" && candidate.slug !== primarySlug,
    );
    return [
      ...new Set(
        records.flatMap((record) =>
          relationFields.flatMap((candidate) =>
            getRelationRecordIds(record.headCommit.payload[candidate.slug]),
          ),
        ),
      ),
    ];
  }, [base.fields, primarySlug, records]);
  const linked = useLinkedRecords({ client, ids: relationIds, orpc });

  const toggleCollapsed = useCallback((groupId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);
  const loadMore = useCallback((groupId: string) => {
    setPageCounts((current) => ({ ...current, [groupId]: (current[groupId] ?? 1) + 1 }));
  }, []);
  const refetchGroups = groupsQuery.refetch;
  const pageQueriesRef = useRef(pageQueries);
  pageQueriesRef.current = pageQueries;
  const retry = useCallback(() => {
    void refetchGroups();
    for (const query of pageQueriesRef.current) {
      if (query.isError) void query.refetch();
    }
  }, [refetchGroups]);

  return useMemo(
    () => ({
      status:
        groupsQuery.isError && !groupsQuery.data ? "error" : groupsQuery.data ? "ready" : "pending",
      error: groupsQuery.error,
      total: groupsQuery.data?.total ?? 0,
      groups,
      records,
      relationRecords: linked.records,
      isFetching: groupsQuery.isFetching || pageQueries.some((query) => query.isFetching),
      toggleCollapsed,
      loadMore,
      retry,
    }),
    [
      groupsQuery.isError,
      groupsQuery.data,
      groupsQuery.error,
      groupsQuery.isFetching,
      groups,
      records,
      linked.records,
      pageQueries,
      toggleCollapsed,
      loadMore,
      retry,
    ],
  );
}
