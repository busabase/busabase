"use client";

import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type BusabaseDashboardApiClient,
  createBusabaseRestApiClient,
} from "busabase-contract/api-client";
import {
  type BusabaseClientOptions,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import type {
  AuditEventVO,
  BaseVO,
  ChangeRequestVO,
  NodeVO,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import { SidebarTrigger } from "kui/sidebar";
// Demo-aware navigation (same helpers as apps/productready & apps/buda):
// `SPALink` appends `?demo=1` on <Link> clicks; `useAddDemoParam` wraps
// programmatic `setLocation` targets — together they keep the demo across all
// navigation (the proxy reads `?demo` via Referer and keeps serving the demo router).
import { type iString, iStringParse } from "openlib/i18n/i-string";
import { useAddDemoParam } from "openlib/ui/dashboard";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { CoreI18nProvider, fmt, useCoreI18n } from "../../i18n";
import { ArchivedBasesView } from "./components/archived-bases";
import { AssetsView } from "./components/assets";
import { BaseDetailView, BaseSetupView, BaseTopbarActions } from "./components/base-views";
import { ChangeRequestDetailPage, ReviewConflictPanel } from "./components/change-request-review";
import {
  getChangeRequestReviewMessage,
  getChangeRequestTitle,
  getOperationTitle,
  getRecordTitle,
} from "./helpers/change-request";
// Side-effect import: registers the skill/doc/folder node-detail renderers.
import "./components/node-detail-views";
import { BaseGraphView } from "./components/graph-view";
import { ActivityView, InboxView } from "./components/inbox";
import { RecordDetailView, RecordEditorView, RecordTopbarActions } from "./components/record-views";
import { SearchDialog } from "./components/search-dialog";
import { SidePanel } from "./components/side-panel";
import { BaseTableSkeleton } from "./components/skeletons";
import { BusabaseTopbarBreadcrumb } from "./components/topbar";
import { getRelationRecordIds } from "./helpers/field";
import { getLocationPath, readInboxView } from "./helpers/inbox";
import { mergeSearchIntoHref } from "./helpers/link-search";
import { isConflictErrorMessage } from "./helpers/search";
import type {
  BusabaseBreadcrumbItem,
  CreateBaseFieldPayload,
  RecordSubmitOptions,
  ViewFormPayload,
  ViewSubmitOptions,
} from "./helpers/view-types";
import { useAttachmentUpload } from "./hooks/use-attachment-upload";
import { useDashboardRoutes } from "./hooks/use-dashboard-routes";
import { useBusabaseLiveSync } from "./hooks/use-live-sync";
import { getNodeDetail } from "./node-detail-registry";

// Records per "load more" page. Server caps limit at 100; 50 keeps parity with
// the previous single-shot list size while staying paginated.
const RECORDS_PAGE_SIZE = 50;

// Field types whose sort can be pushed to the DB (their typed value column orders
// the same way the client would). Others keep the client-side locale sort.
const SERVER_SORTABLE_FIELD_TYPES = new Set(["number", "auto_number", "date"]);

interface BusabaseDashboardProps {
  nodes: NodeVO[];
  bases: BaseVO[];
  changeRequests: ChangeRequestVO[];
  records: RecordVO[];
  views?: ViewVO[];
  auditEvents?: AuditEventVO[];
  currentUserId?: string | null;
  apiBasePath?: string;
  /**
   * Namespaces every dashboard query key so one space's cached reads are never
   * served under another. The cloud passes the active space id; open source (a
   * single space) leaves the default.
   */
  cacheSpaceKey?: string;
  /**
   * Options threaded into the internally-built oRPC clients (e.g. the cloud's
   * per-request `x-busabase-space` header naming the active space so the
   * server can dispatch locally vs through a tunnel). Open source (a single
   * space) leaves the default.
   */
  apiClientOptions?: BusabaseClientOptions;
  apiClient?: BusabaseDashboardApiClient;
  embedded?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /**
   * Leave enabled for standalone consumers. Hosts that already mount an app-wide
   * QueryClientProvider can set this to false so shell and workbench queries
   * share one cache.
   */
  provideQueryClient?: boolean;
  searchOpen?: boolean;
  /** Optional host-provided guide rendered under empty states. */
  emptyGuide?: ReactNode;
  /** Active UI locale (e.g. "en", "zh-CN"). Host-injected; defaults to English. */
  locale?: string;
}

// Public entry: provides a React Query client so the whole dashboard data layer
// runs on oRPC + TanStack Query. Consumers don't need their own provider; a
// nested QueryClientProvider is harmless if they already have one.
export function BusabaseDashboard({
  locale,
  provideQueryClient = true,
  ...props
}: BusabaseDashboardProps) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const content = (
    <CoreI18nProvider locale={locale}>
      <BusabaseDashboardContent {...props} />
    </CoreI18nProvider>
  );
  return provideQueryClient ? (
    <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>
  ) : (
    content
  );
}

function BusabaseDashboardContent({
  apiBasePath = "/api/rpc",
  cacheSpaceKey = "local",
  apiClientOptions,
  apiClient,
  auditEvents: initialAuditEvents = [],
  changeRequests: initialChangeRequests,
  currentUserId = null,
  emptyGuide,
  // `records` (SSR seed) is intentionally not consumed: the table now loads per
  // base via keyset pagination so rows reflect exactly what was fetched. The
  // prop stays for host compatibility.
  bases: initialBases,
  nodes: nodeTree,
  views: initialViews = [],
  embedded = false,
  onSearchOpenChange,
  searchOpen,
}: BusabaseDashboardProps) {
  const messages = useCoreI18n();
  const orpc = useMemo(
    () => createBusabaseQueryUtils(apiBasePath, apiClientOptions ?? {}, cacheSpaceKey),
    [apiBasePath, apiClientOptions, cacheSpaceKey],
  );
  const queryClient = useQueryClient();
  const client = useMemo(
    () => apiClient ?? createBusabaseRestApiClient(apiBasePath, apiClientOptions),
    [apiBasePath, apiClient, apiClientOptions],
  );
  // Reads run through oRPC + React Query, seeded by the SSR props as initialData.
  const changeRequestsList = orpc.changeRequests.list.queryOptions({ input: {} });
  const basesList = orpc.bases.list.queryOptions({});
  const archivedBasesList = orpc.bases.listArchived.queryOptions({});
  const archivedNodesList = orpc.nodes.listArchived.queryOptions({});
  const auditEventsList = orpc.auditEvents.list.queryOptions({ input: {} });
  const changeRequestsQuery = useQuery({
    ...changeRequestsList,
    initialData: initialChangeRequests,
  });
  const basesQuery = useQuery({ ...basesList, initialData: initialBases });
  const archivedBasesQuery = useQuery(archivedBasesList);
  const archivedNodesQuery = useQuery(archivedNodesList);
  const auditEventsQuery = useQuery({ ...auditEventsList, initialData: initialAuditEvents });
  const allChangeRequests = changeRequestsQuery.data ?? [];
  const bases = basesQuery.data ?? [];
  const archivedBases = archivedBasesQuery.data ?? [];
  const archivedNodes = archivedNodesQuery.data ?? [];
  const auditEvents = auditEventsQuery.data ?? [];
  // Stable query keys for cache writes/invalidation (orpc is memoized on apiBasePath).
  const listKeys = useMemo(
    () => ({
      archivedBases: orpc.bases.listArchived.queryOptions({}).queryKey as QueryKey,
      archivedNodes: orpc.nodes.listArchived.queryOptions({}).queryKey as QueryKey,
      // Partial keys (no input) so invalidation matches every paged/counted
      // query regardless of base, tab, or cursor.
      changeRequests: orpc.changeRequests.list.queryOptions({ input: {} }).queryKey as QueryKey,
      changeRequestsPaged: orpc.changeRequests.listPaged.key() as QueryKey,
      changeRequestCounts: orpc.changeRequests.counts.key() as QueryKey,
      changeRequestDetail: orpc.changeRequests.get.key() as QueryKey,
      records: orpc.records.listPaged.key() as QueryKey,
      recordsCount: orpc.records.count.key() as QueryKey,
      bases: orpc.bases.list.queryOptions({}).queryKey as QueryKey,
      nodes: orpc.nodes.list.queryOptions({}).queryKey as QueryKey,
      auditEvents: orpc.auditEvents.list.queryOptions({ input: {} }).queryKey as QueryKey,
      assets: orpc.assets.list.queryOptions({}).queryKey as QueryKey,
    }),
    [orpc],
  );
  const uploadAttachmentBase = useAttachmentUpload(client);
  const uploadAttachment = useCallback(
    async (file: File) => {
      const ref = await uploadAttachmentBase(file);
      await queryClient.invalidateQueries({ queryKey: listKeys.assets });
      return ref;
    },
    [listKeys.assets, queryClient, uploadAttachmentBase],
  );
  const [error, setError] = useState<string | null>(null);
  const [location, rawSetLocation] = useLocation();
  const search = useSearch();
  // Wrap every programmatic navigation so it keeps `?demo` in demo mode (the
  // productready/buda pattern, applied once at the source instead of per call
  // site) AND carries forward the rest of the current query string — e.g.
  // busabase-cloud's `?space=tnl_…` selecting a connected Local ↔ Cloud
  // Tunnel remote space, which a bare `setLocation(`/inbox/${id}`)` would
  // otherwise silently drop, bouncing the host app back to its default space.
  const addDemoParam = useAddDemoParam();
  const setLocation = useCallback(
    (to: string, options?: { replace?: boolean; state?: unknown }) =>
      rawSetLocation(addDemoParam(mergeSearchIntoHref(to, search)), options),
    [rawSetLocation, addDemoParam, search],
  );
  const locationPath = getLocationPath(location);
  const inboxView = readInboxView(search);
  const [uncontrolledSearchOpen, setUncontrolledSearchOpen] = useState(false);
  const isSearchOpen = searchOpen ?? uncontrolledSearchOpen;
  const changeRequests = useMemo(
    () =>
      allChangeRequests.filter(
        (changeRequest) =>
          changeRequest.status === "in_review" ||
          changeRequest.status === "changes_requested" ||
          changeRequest.status === "approved",
      ),
    [allChangeRequests],
  );

  const {
    isArchivedRoute,
    isGraphRoute,
    isAssetDetailRoute,
    isOperationRoute,
    operationParams,
    isChangeRequestRoute,
    isBaseDesignRoute,
    isLegacyBaseSetupRoute,
    isNewRecordRoute,
    isEditRecordRoute,
    editRecordParams,
    baseParams,
    isBaseChildRoute,
    baseChildParams,
    isSkillRoute,
    isDriveRoute,
    isAirappRoute,
    isFileRoute,
    isDocRoute,
    isFolderRoute,
    isBaseSetupRoute,
    selectedBaseSlug,
    selectedSkillSlug,
    selectedDriveSlug,
    selectedAirappSlug,
    selectedFileSlug,
    selectedDocSlug,
    selectedFolderSlug,
    selectedChangeRequestId,
  } = useDashboardRoutes();
  const activeBase = useMemo(
    () =>
      selectedBaseSlug
        ? (bases.find((base) => base.slug === selectedBaseSlug) ?? null)
        : (bases[0] ?? null),
    [selectedBaseSlug, bases],
  );
  useBusabaseLiveSync({
    activeBaseId: activeBase?.id,
    listKeys,
    orpc,
    queryClient,
    currentUserId,
    notificationTitle: messages.shell.changeRequestPendingReviewTitle,
    notificationBody: messages.shell.changeRequestPendingReviewBody,
  });
  // Deleted fields scoped to the active base (for the Design tab).
  const deletedFieldsQuery = useQuery({
    ...orpc.bases.listDeletedFields.queryOptions({ input: { baseId: activeBase?.id ?? "" } }),
    enabled: Boolean(activeBase?.id && isBaseSetupRoute),
  });
  const deletedFields = deletedFieldsQuery.data ?? [];
  // Archived views/records for the active base (for restore UI in the table).
  const isBaseDetailRoute = Boolean(
    activeBase?.id && locationPath.startsWith("/base/") && !isBaseSetupRoute,
  );
  const archivedViewsQuery = useQuery({
    ...orpc.bases.listArchivedViews.queryOptions({ input: { baseId: activeBase?.id ?? "" } }),
    enabled: Boolean(activeBase?.id && isBaseDetailRoute),
  });
  const archivedViewsForBase = archivedViewsQuery.data ?? [];
  // Archived ("trash") records keyset-paginate too, so a Base with a large
  // soft-deleted history doesn't load it all at once when the section expands.
  const archivedRecordsInfiniteQuery = useInfiniteQuery({
    ...orpc.bases.listArchivedRecordsPaged.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        baseId: activeBase?.id ?? "",
        cursor: pageParam,
        limit: RECORDS_PAGE_SIZE,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
    enabled: Boolean(activeBase?.id && isBaseDetailRoute),
  });
  const archivedRecordsForBase = useMemo(
    () => archivedRecordsInfiniteQuery.data?.pages.flatMap((page) => page.records) ?? [],
    [archivedRecordsInfiniteQuery.data],
  );
  const archivedRecordsPagination = useMemo(
    () => ({
      hasMore: archivedRecordsInfiniteQuery.hasNextPage,
      isLoadingMore: archivedRecordsInfiniteQuery.isFetchingNextPage,
      loadMore: () => {
        void archivedRecordsInfiniteQuery.fetchNextPage();
      },
    }),
    [
      archivedRecordsInfiniteQuery.hasNextPage,
      archivedRecordsInfiniteQuery.isFetchingNextPage,
      archivedRecordsInfiniteQuery.fetchNextPage,
    ],
  );
  // Views are scoped to the active base (the oRPC endpoint is per-base).
  const viewsList = orpc.bases.listViews.queryOptions({
    input: { baseId: activeBase?.id ?? "" },
  });
  const viewsQuery = useQuery({
    ...viewsList,
    enabled: Boolean(activeBase?.id),
    initialData: activeBase ? initialViews.filter((view) => view.baseId === activeBase.id) : [],
  });
  const views = viewsQuery.data ?? [];
  const baseViews = useMemo(
    () => views.filter((view) => view.baseId === activeBase?.id),
    [activeBase?.id, views],
  );
  const selectedBaseView = useMemo(() => {
    const childId = baseChildParams?.childId;
    if (!childId || childId === "new" || childId === "design" || childId === "setup") {
      return null;
    }
    return baseViews.find((view) => view.slug === childId || view.id === childId) ?? null;
  }, [baseChildParams?.childId, baseViews]);
  // Carry the active view's filters (tagged with each field's type) to the server
  // for best-effort push-down; the client filter below stays the exact authority.
  const activeViewFilters = useMemo(() => {
    const filters = selectedBaseView?.config.filters ?? [];
    if (filters.length === 0) {
      return undefined;
    }
    const fieldTypeBySlug = new Map(
      (activeBase?.fields ?? []).map((field) => [field.slug, field.type]),
    );
    return filters.map((filter) => ({
      fieldSlug: filter.fieldSlug,
      fieldType: fieldTypeBySlug.get(filter.fieldSlug),
      operator: filter.operator,
      value: filter.value,
    }));
  }, [selectedBaseView, activeBase?.fields]);
  // A single number/date sort with no filters can be pushed to the DB, which then
  // orders + paginates authoritatively — so the base doesn't have to be pulled
  // into the browser to sort. (Filters are superset-pushed and the client still
  // narrows them, so a filtered view stays client-side. Multi-column and
  // text/other sorts also stay client-side.)
  const activeViewSort = useMemo(() => {
    const config = selectedBaseView?.config;
    if (!config || config.filters.length > 0 || config.sorts.length !== 1) {
      return undefined;
    }
    const sort = config.sorts[0];
    const fieldType = (activeBase?.fields ?? []).find((f) => f.slug === sort.fieldSlug)?.type;
    if (!fieldType || !SERVER_SORTABLE_FIELD_TYPES.has(fieldType)) {
      return undefined;
    }
    return { fieldSlug: sort.fieldSlug, fieldType, direction: sort.direction };
  }, [selectedBaseView, activeBase?.fields]);
  const serverSortedView = Boolean(activeViewSort);
  // Records load per active base via keyset pagination ("load more"), so a base
  // with more than one page is fully reachable instead of silently capped.
  const recordsInfiniteQuery = useInfiniteQuery({
    ...orpc.records.listPaged.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        baseId: activeBase?.id,
        cursor: pageParam,
        limit: RECORDS_PAGE_SIZE,
        filters: activeViewFilters,
        sort: activeViewSort,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
    enabled: Boolean(activeBase?.id),
  });
  const baseRecords = useMemo(
    () => recordsInfiniteQuery.data?.pages.flatMap((page) => page.records) ?? [],
    [recordsInfiniteQuery.data],
  );
  // Whole-base total for the table header ("N of total"), decoupled from paging.
  // `refetchInterval` is a low-frequency second line of defense alongside the
  // live-sync SSE stream + focus/visibility refresh (use-live-sync.ts): if a
  // merge lands from another tab/CLI/agent while this tab's SSE connection
  // has gone silently stale and it never regains focus, this still converges
  // within a minute instead of showing a stale count indefinitely.
  const recordCountQuery = useQuery({
    ...orpc.records.count.queryOptions({ input: { baseId: activeBase?.id ?? "" } }),
    enabled: Boolean(activeBase?.id),
    refetchInterval: 60_000,
  });
  const recordsPagination = useMemo(
    () => ({
      total: recordCountQuery.data?.total ?? null,
      loaded: baseRecords.length,
      hasMore: recordsInfiniteQuery.hasNextPage,
      isLoadingMore: recordsInfiniteQuery.isFetchingNextPage,
      loadMore: () => {
        void recordsInfiniteQuery.fetchNextPage();
      },
    }),
    [
      recordCountQuery.data?.total,
      baseRecords.length,
      recordsInfiniteQuery.hasNextPage,
      recordsInfiniteQuery.isFetchingNextPage,
      recordsInfiniteQuery.fetchNextPage,
    ],
  );
  const isBaseViewRoute = Boolean(isBaseChildRoute && selectedBaseView);
  // View filters/sorts are applied client-side over the loaded pages, so a view
  // with a filter or sort is only correct once every page is in — UNLESS the sort
  // was pushed to the server (serverSortedView), which orders + paginates for us.
  // So auto-load-all only when the view still needs client-side filter/sort.
  const viewNeedsAllRecords = Boolean(
    selectedBaseView &&
      !serverSortedView &&
      (selectedBaseView.config.filters.length > 0 || selectedBaseView.config.sorts.length > 0),
  );
  useEffect(() => {
    if (
      viewNeedsAllRecords &&
      recordsInfiniteQuery.hasNextPage &&
      !recordsInfiniteQuery.isFetchingNextPage
    ) {
      void recordsInfiniteQuery.fetchNextPage();
    }
  }, [
    viewNeedsAllRecords,
    recordsInfiniteQuery.hasNextPage,
    recordsInfiniteQuery.isFetchingNextPage,
    recordsInfiniteQuery.fetchNextPage,
  ]);
  const isRecordRoute = Boolean(isBaseChildRoute && !selectedBaseView && !isBaseSetupRoute);
  const selectedRecordId =
    isEditRecordRoute && editRecordParams?.recordId
      ? editRecordParams.recordId
      : isRecordRoute && baseChildParams?.childId !== "new"
        ? baseChildParams?.childId
        : null;
  // Records reached by a direct link (not in the list query) and the relation
  // records other records point at are loaded through React Query and folded into
  // `records`. Relation ids accumulate (append-only) so the query set never shrinks
  // — which would otherwise loop fetch→merge→drop→refetch — and so transitive
  // relations resolve as newly-merged records reference further ids.
  const fallbackRecordQuery = useQuery({
    ...orpc.records.get.queryOptions({ input: { recordId: selectedRecordId ?? "" } }),
    enabled: Boolean(selectedRecordId) && !baseRecords.some((item) => item.id === selectedRecordId),
  });
  const [relationRecordIds, setRelationRecordIds] = useState<string[]>([]);
  const relationRecordQueries = useQueries({
    queries: relationRecordIds.map((recordId) => ({
      ...orpc.records.get.queryOptions({ input: { recordId } }),
    })),
  });
  const records = useMemo(() => {
    const seen = new Set<string>();
    const merged: RecordVO[] = [];
    for (const record of [
      fallbackRecordQuery.data,
      ...relationRecordQueries.map((query) => query.data),
      ...baseRecords,
    ]) {
      if (record && !seen.has(record.id)) {
        seen.add(record.id);
        merged.push(record);
      }
    }
    return merged;
  }, [baseRecords, fallbackRecordQuery.data, relationRecordQueries]);
  const activeRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId],
  );
  const missingRelationRecordIds = useMemo(() => {
    const existingRecordIds = new Set(records.map((record) => record.id));
    return [
      ...new Set(
        records.flatMap((record) =>
          record.base.fields
            .filter((field) => field.type === "relation")
            .flatMap((field) => getRelationRecordIds(record.headCommit.fields[field.slug])),
        ),
      ),
    ].filter((recordId) => !existingRecordIds.has(recordId));
  }, [records]);
  // Queue newly-discovered relation ids for fetching; append-only (see above).
  useEffect(() => {
    const fresh = missingRelationRecordIds.filter((id) => !relationRecordIds.includes(id));
    if (fresh.length > 0) {
      setRelationRecordIds((previous) => [...previous, ...fresh]);
    }
  }, [missingRelationRecordIds, relationRecordIds]);
  // The list query caps each CR's `operations` (see LIST_MAX_OPERATIONS_PER_CHANGE_REQUEST)
  // and strips `reviews[].visibleOperationHeads` for payload size — fine for inbox
  // rows, but the single-CR detail view needs the uncapped, un-stripped shape
  // (full diffs past 5 operations; `changedSinceReview` staleness detection).
  // It also covers a change request opened by direct link that isn't in the
  // list query at all (e.g. a merged/closed CR).
  const isChangeRequestDetailRoute = isChangeRequestRoute || isOperationRoute;
  const fallbackChangeRequestQuery = useQuery({
    ...orpc.changeRequests.get.queryOptions({
      input: { changeRequestId: selectedChangeRequestId ?? "" },
    }),
    enabled: Boolean(selectedChangeRequestId) && isChangeRequestDetailRoute,
  });
  const selectedChangeRequest = useMemo(
    () =>
      fallbackChangeRequestQuery.data ??
      allChangeRequests.find((changeRequest) => changeRequest.id === selectedChangeRequestId) ??
      null,
    [allChangeRequests, selectedChangeRequestId, fallbackChangeRequestQuery.data],
  );
  const selectedOperation = useMemo(
    () =>
      selectedChangeRequest?.operations.find(
        (operation) => operation.id === operationParams?.operationId,
      ) ?? null,
    [operationParams?.operationId, selectedChangeRequest],
  );
  const titlebar = useMemo(() => {
    if (isOperationRoute) {
      return {
        badge: selectedChangeRequest ? (
          <span className="rounded-full border bg-muted/30 px-2.5 py-1 text-muted-foreground text-xs">
            {selectedOperation
              ? `${selectedOperation.position + 1} / ${selectedChangeRequest.operationCount}`
              : messages.activity.operation}
          </span>
        ) : null,
        title: selectedOperation
          ? getOperationTitle(selectedOperation, selectedChangeRequest?.base, messages)
          : messages.activity.operation,
      };
    }

    if (isChangeRequestRoute) {
      return {
        badge: null,
        title: selectedChangeRequest
          ? getChangeRequestTitle(selectedChangeRequest, messages)
          : messages.activity.changeRequest,
      };
    }

    if (isBaseSetupRoute) {
      return {
        badge: null,
        title: `${activeBase?.name ?? messages.nav.base} ${messages.base.designTab}`,
      };
    }

    if (isNewRecordRoute) {
      return {
        badge: null,
        title: fmt(messages.recordView.newRecordTitle, {
          base: activeBase?.name ?? messages.common.record,
        }),
      };
    }

    if (isEditRecordRoute) {
      return {
        badge: null,
        title: `${messages.common.edit} ${getRecordTitle(activeRecord, messages)}`,
      };
    }

    if (isRecordRoute) {
      return { badge: null, title: getRecordTitle(activeRecord, messages) };
    }

    if (isBaseViewRoute) {
      return { badge: null, title: selectedBaseView?.name ?? messages.recordView.view };
    }

    if (locationPath.startsWith("/base/")) {
      return { badge: null, title: activeBase?.name ?? messages.nav.base };
    }

    if (locationPath === "/activity") {
      return { badge: null, title: messages.nav.activity };
    }

    if (locationPath === "/assets") {
      return { badge: null, title: messages.nav.assets };
    }

    if (isAssetDetailRoute) {
      return { badge: null, title: messages.nav.assets };
    }

    return {
      badge: null,
      title: messages.inbox.title,
    };
  }, [
    activeBase,
    activeRecord,
    isBaseSetupRoute,
    isChangeRequestRoute,
    isEditRecordRoute,
    isAssetDetailRoute,
    isNewRecordRoute,
    isOperationRoute,
    isBaseViewRoute,
    isRecordRoute,
    locationPath,
    selectedBaseView,
    selectedChangeRequest,
    selectedOperation,
    messages,
  ]);

  const breadcrumbItems = useMemo<BusabaseBreadcrumbItem[]>(() => {
    if (isOperationRoute) {
      return [
        { href: "/inbox", label: messages.inbox.title },
        {
          href: selectedChangeRequest ? `/inbox/${selectedChangeRequest.id}` : undefined,
          label: selectedChangeRequest
            ? getChangeRequestTitle(selectedChangeRequest, messages)
            : messages.activity.changeRequest,
        },
        {
          label: selectedOperation
            ? getOperationTitle(selectedOperation, selectedChangeRequest?.base, messages)
            : messages.activity.operation,
        },
      ];
    }

    if (isChangeRequestRoute) {
      return [
        { href: "/inbox", label: messages.inbox.title },
        {
          label: selectedChangeRequest
            ? getChangeRequestTitle(selectedChangeRequest, messages)
            : messages.activity.changeRequest,
        },
      ];
    }

    if (locationPath === "/activity") {
      return [{ label: messages.nav.activity }];
    }

    if (locationPath === "/assets") {
      return [{ label: messages.nav.assets }];
    }

    if (isAssetDetailRoute) {
      return [{ href: "/assets", label: messages.nav.assets }, { label: messages.nav.assets }];
    }

    if (isBaseSetupRoute) {
      return [
        { label: messages.nav.bases },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: messages.base.designTab },
      ];
    }

    if (isNewRecordRoute) {
      return [
        { label: messages.nav.bases },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: messages.base.newRecord },
      ];
    }

    if (isEditRecordRoute) {
      return [
        { label: messages.nav.bases },
        {
          href: activeRecord
            ? `/base/${activeRecord.base.slug}`
            : activeBase
              ? `/base/${activeBase.slug}`
              : undefined,
          label: activeBase?.name ?? activeRecord?.base.name ?? messages.nav.base,
        },
        {
          href: activeRecord ? `/base/${activeRecord.base.slug}/${activeRecord.id}` : undefined,
          label: activeRecord ? getRecordTitle(activeRecord, messages) : messages.common.record,
        },
        { label: messages.common.edit },
      ];
    }

    if (isRecordRoute) {
      return [
        { label: messages.nav.bases },
        {
          href: activeRecord
            ? `/base/${activeRecord.base.slug}`
            : activeBase
              ? `/base/${activeBase.slug}`
              : undefined,
          label: activeBase?.name ?? activeRecord?.base.name ?? messages.nav.base,
        },
        { label: activeRecord ? getRecordTitle(activeRecord, messages) : messages.common.record },
      ];
    }

    if (isBaseViewRoute) {
      return [
        { label: messages.nav.bases },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: selectedBaseView?.name ?? messages.recordView.view },
      ];
    }

    if (locationPath.startsWith("/base/")) {
      return [{ label: messages.nav.bases }, { label: activeBase?.name ?? messages.nav.base }];
    }

    return [{ label: messages.inbox.title }];
  }, [
    activeBase,
    activeRecord,
    isBaseSetupRoute,
    isChangeRequestRoute,
    isEditRecordRoute,
    isAssetDetailRoute,
    isNewRecordRoute,
    isOperationRoute,
    isBaseViewRoute,
    isRecordRoute,
    locationPath,
    selectedBaseView,
    selectedChangeRequest,
    selectedOperation,
    messages,
  ]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequests }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestsPaged }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestCounts }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestDetail }),
      queryClient.invalidateQueries({ queryKey: listKeys.records }),
      queryClient.invalidateQueries({ queryKey: listKeys.recordsCount }),
      queryClient.invalidateQueries({ queryKey: listKeys.bases }),
      queryClient.invalidateQueries({ queryKey: listKeys.auditEvents }),
      queryClient.invalidateQueries({
        queryKey: orpc.bases.listViews.queryOptions({ input: { baseId: activeBase?.id ?? "" } })
          .queryKey,
      }),
    ]);
  }, [activeBase?.id, listKeys, orpc, queryClient]);

  const reviewMutation = useMutation({
    mutationFn: async (variables: {
      action: "approve" | "reject" | "merge" | "close";
      changeRequestId: string;
      reason?: string;
    }): Promise<
      | { action: "approve"; changeRequest: ChangeRequestVO }
      | { action: "merge"; record: RecordVO | null }
      | undefined
    > => {
      if (variables.action === "approve") {
        const changeRequest = await client.approveChangeRequest(
          variables.changeRequestId,
          variables.reason,
        );
        return { action: "approve", changeRequest };
      }
      if (variables.action === "reject") {
        await client.rejectChangeRequest(variables.changeRequestId, variables.reason);
        return undefined;
      }
      if (variables.action === "close") {
        await client.closeChangeRequest(variables.changeRequestId, variables.reason);
        return undefined;
      }
      const merged = await client.mergeChangeRequest(variables.changeRequestId);
      return { action: "merge", record: merged.record };
    },
    onMutate: () => setError(null),
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error ? mutationError.message : messages.shell.operationFailed,
      ),
    onSuccess: (result) => {
      if (!result) {
        return;
      }
      if (result.action === "approve") {
        // Approving used to leave the reviewer without any feedback beyond a
        // silent background refresh — surface the same "ready to merge"
        // status message the review panel itself shows.
        toast.success(getChangeRequestReviewMessage(result.changeRequest, messages));
        return;
      }
      const record = result.record;
      if (record) {
        setLocation(`/base/${record.base.slug}/${record.id}`);
      }
    },
    onSettled: () => refresh(),
  });
  const isPending = reviewMutation.isPending;

  const approveChangeRequest = useCallback(
    (changeRequestId: string, reason?: string) =>
      reviewMutation.mutate({ action: "approve", changeRequestId, reason }),
    [reviewMutation],
  );

  const rejectChangeRequest = useCallback(
    (changeRequestId: string, reason?: string) =>
      reviewMutation.mutate({ action: "reject", changeRequestId, reason }),
    [reviewMutation],
  );

  const mergeChangeRequest = useCallback(
    (changeRequestId: string) => reviewMutation.mutate({ action: "merge", changeRequestId }),
    [reviewMutation],
  );

  const closeChangeRequest = useCallback(
    (changeRequestId: string, reason?: string) =>
      reviewMutation.mutate({ action: "close", changeRequestId, reason }),
    [reviewMutation],
  );

  const approveAndMergeChangeRequest = useCallback(
    async (changeRequestId: string) => {
      await client.approveChangeRequest(changeRequestId);
      return client.mergeChangeRequest(changeRequestId);
    },
    [client],
  );

  // Batch review from the inbox. "approveMerge" approves the selected change
  // requests, then merges only the ones that approved cleanly; failures are
  // isolated per item (the server never aborts the whole batch).
  const batchMutation = useMutation({
    mutationFn: async (variables: {
      action: "approveMerge" | "reject";
      changeRequestIds: string[];
      reason?: string;
    }) => {
      if (variables.action === "reject") {
        return client.reviewChangeRequestsMany(
          variables.changeRequestIds,
          "rejected",
          variables.reason,
        );
      }
      const approveResult = await client.reviewChangeRequestsMany(
        variables.changeRequestIds,
        "approved",
      );
      const approvedIds = approveResult.results
        .filter((item) => item.ok)
        .map((item) => item.changeRequestId);
      const mergeResult = approvedIds.length
        ? await client.mergeChangeRequestsMany(approvedIds)
        : { results: [] };
      const mergedOk = new Set(
        mergeResult.results.filter((item) => item.ok).map((item) => item.changeRequestId),
      );
      // A change request counts as done only if it both approved and merged.
      return {
        results: approveResult.results.map((item) =>
          item.ok ? { ...item, ok: mergedOk.has(item.changeRequestId) } : item,
        ),
      };
    },
    onMutate: () => setError(null),
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error ? mutationError.message : messages.shell.operationFailed,
      ),
    onSuccess: (result) => {
      const ok = result.results.filter((item) => item.ok).length;
      const failed = result.results.length - ok;
      const summary = fmt(messages.inbox.batchResult, { ok, failed });
      if (failed > 0) {
        toast.error(summary);
      } else {
        toast.success(summary);
      }
    },
    onSettled: () => refresh(),
  });
  const isBatchPending = batchMutation.isPending;
  const runBatchReview = useCallback(
    (action: "approveMerge" | "reject", changeRequestIds: string[], reason?: string) =>
      batchMutation.mutate({ action, changeRequestIds, reason }),
    [batchMutation],
  );

  const submitCreateRecord = useCallback(
    async (base: BaseVO, fields: Record<string, unknown>, options?: RecordSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createChangeRequest(base.id, {
        fields,
        message: fmt(messages.createNode.createRecordMessage, { base: base.name }),
        submittedBy: "local-editor",
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        const mergedRecord = merged.record;
        if (!mergedRecord) {
          throw new Error(messages.shell.mergeRecordMissing);
        }
        await refresh();
        setLocation(`/base/${mergedRecord.base.slug}/${mergedRecord.id}`);
        return;
      }
      setLocation(`/inbox/${changeRequest.id}`);
      await refresh();
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.createNode.createRecordMessage,
      messages.shell.mergeRecordMissing,
      refresh,
      setLocation,
    ],
  );

  const submitUpdateRecord = useCallback(
    async (record: RecordVO, fields: Record<string, unknown>, options?: RecordSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createUpdateChangeRequest(record.id, {
        author: "local-editor",
        fields,
        message: fmt(messages.createNode.updateRecordMessage, {
          record: getRecordTitle(record, messages),
        }),
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        const mergedRecord = merged.record;
        if (!mergedRecord) {
          throw new Error(messages.shell.mergeRecordMissing);
        }
        await refresh();
        setLocation(`/base/${mergedRecord.base.slug}/${mergedRecord.id}`);
        return;
      }
      setLocation(`/inbox/${changeRequest.id}`);
      await refresh();
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.createNode.updateRecordMessage,
      messages.shell.mergeRecordMissing,
      messages,
      refresh,
      setLocation,
    ],
  );

  const submitDeleteRecord = useCallback(
    async (record: RecordVO, options?: RecordSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createDeleteChangeRequest(record.id);
      if (options?.mergeImmediately) {
        await approveAndMergeChangeRequest(changeRequest.id);
        await refresh();
        setLocation(`/base/${record.base.slug}`);
        return;
      }
      setLocation(`/inbox/${changeRequest.id}`);
      await refresh();
    },
    [approveAndMergeChangeRequest, client, refresh, setLocation],
  );

  const submitCreateBaseField = useCallback(
    async (
      base: BaseVO,
      payload: CreateBaseFieldPayload,
      options?: { mergeImmediately?: boolean },
    ) => {
      setError(null);
      if (options?.mergeImmediately) {
        await client.createBaseField(base.id, payload);
        await refresh();
        return;
      }
      const changeRequest = await client.createFieldChangeRequest(base.id, {
        ...payload,
        message: fmt(messages.createNode.addFieldMessage, {
          field: iStringParse(payload.name),
        }),
        submittedBy: "local-editor",
      });
      await refresh();
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [client, messages.createNode.addFieldMessage, refresh, setLocation],
  );

  const submitUpdateFieldName = useCallback(
    async (
      base: BaseVO,
      fieldId: string,
      name: iString,
      options?: { mergeImmediately?: boolean },
    ) => {
      setError(null);
      const changeRequest = await client.createUpdateFieldChangeRequest(base.id, {
        fieldId,
        patch: { name },
        message: fmt(messages.createNode.renameFieldMessage, {
          field: iStringParse(name),
        }),
      });
      if (options?.mergeImmediately) {
        await approveAndMergeChangeRequest(changeRequest.id);
        await refresh();
        toast.success(messages.createNode.fieldRenamed);
        return;
      }
      await refresh();
      toast.success(messages.createNode.renameRequestSubmitted);
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.createNode.fieldRenamed,
      messages.createNode.renameFieldMessage,
      messages.createNode.renameRequestSubmitted,
      refresh,
      setLocation,
    ],
  );

  const submitRenameBase = useCallback(
    async (
      base: BaseVO,
      payload: { name: string; description: string },
      options?: { mergeImmediately?: boolean },
    ) => {
      setError(null);
      const changeRequest = await client.createNodeChangeRequest({
        operations: [
          {
            kind: "rename",
            nodeId: base.nodeId,
            name: payload.name,
            description: payload.description,
          },
        ],
      });
      if (options?.mergeImmediately) {
        await approveAndMergeChangeRequest(changeRequest.id);
        await refresh();
        toast.success(messages.base.baseRenamed);
        setLocation(`/base/${base.slug}`);
        return;
      }
      await refresh();
      toast.success(messages.base.renameRequestSubmitted);
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.baseRenamed,
      messages.base.renameRequestSubmitted,
      refresh,
      setLocation,
    ],
  );

  const submitRestoreBase = useCallback(
    async (base: BaseVO) => {
      setError(null);
      const changeRequest = await client.createRestoreBaseChangeRequest(base.id, {
        submittedBy: "local-editor",
        message: fmt(messages.base.restoreBaseMessage, { base: base.name }),
      });
      await approveAndMergeChangeRequest(changeRequest.id);
      await queryClient.invalidateQueries({ queryKey: listKeys.bases });
      await queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchived.queryOptions({}).queryKey,
      });
      toast.success(messages.base.baseRestored);
      setLocation(`/base/${base.slug}`);
    },
    [
      approveAndMergeChangeRequest,
      client,
      listKeys.bases,
      messages.base.baseRestored,
      messages.base.restoreBaseMessage,
      orpc,
      queryClient,
      setLocation,
    ],
  );

  const submitRestoreNode = useCallback(
    async (node: NodeVO) => {
      setError(null);
      const changeRequest = await client.createNodeChangeRequest({
        submittedBy: "local-editor",
        message: fmt(messages.base.restoreNodeMessage, {
          name: node.name,
          type: node.type,
        }),
        operations: [{ kind: "restore", nodeId: node.id }],
      });
      await approveAndMergeChangeRequest(changeRequest.id);
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.listArchived.queryOptions({}).queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.list.queryOptions({}).queryKey,
      });
      toast.success(fmt(messages.base.nodeRestored, { type: node.type }));
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.nodeRestored,
      messages.base.restoreNodeMessage,
      orpc,
      queryClient,
    ],
  );

  const submitPurgeNode = useCallback(
    async (node: NodeVO) => {
      setError(null);
      await client.purgeNode(node.id);
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.listArchived.queryOptions({}).queryKey,
      });
      toast.success(fmt(messages.base.nodeDeletedPermanently, { type: node.type }));
    },
    [client, messages.base.nodeDeletedPermanently, orpc, queryClient],
  );

  // Same `nodes.purge` endpoint as submitPurgeNode — a Base's `nodeId` (1:1
  // with its `busabase_bases` row) is what purge actually targets, so this is
  // the Trash "Bases" section's counterpart to the folders/docs/skills purge.
  const submitPurgeBase = useCallback(
    async (base: BaseVO) => {
      setError(null);
      await client.purgeNode(base.nodeId);
      await queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchived.queryOptions({}).queryKey,
      });
      toast.success(fmt(messages.base.nodeDeletedPermanently, { type: "base" }));
    },
    [client, messages.base.nodeDeletedPermanently, orpc, queryClient],
  );

  const submitRestoreField = useCallback(
    async (base: BaseVO, fieldId: string) => {
      setError(null);
      const changeRequest = await client.createRestoreFieldChangeRequest(base.id, {
        fieldId,
        submittedBy: "local-editor",
        message: messages.base.restoreFieldMessage,
      });
      await approveAndMergeChangeRequest(changeRequest.id);
      await refresh();
      toast.success(messages.base.fieldRestored);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.fieldRestored,
      messages.base.restoreFieldMessage,
      refresh,
    ],
  );

  const submitCreateView = useCallback(
    async (base: BaseVO, payload: ViewFormPayload, options?: ViewSubmitOptions) => {
      setError(null);
      if (!payload.slug) {
        throw new Error(messages.base.viewSlugRequired);
      }
      const changeRequest = await client.createViewChangeRequest(base.id, {
        config: payload.config,
        description: payload.description,
        message: payload.message ?? fmt(messages.base.createViewMessage, { view: payload.name }),
        name: payload.name,
        slug: payload.slug,
        submittedBy: payload.submittedBy ?? "local-editor",
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        await refresh();
        setLocation(`/base/${base.slug}/${merged.view?.slug ?? payload.slug}`);
        return;
      }
      await refresh();
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.createViewMessage,
      messages.base.viewSlugRequired,
      refresh,
      setLocation,
    ],
  );

  const submitUpdateView = useCallback(
    async (view: ViewVO, payload: ViewFormPayload, options?: ViewSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createUpdateViewChangeRequest(view.id, {
        config: payload.config,
        description: payload.description,
        message:
          payload.message ??
          fmt(messages.base.updateViewMessage, { view: payload.name || view.name }),
        name: payload.name,
        submittedBy: payload.submittedBy ?? "local-editor",
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        const viewBase = bases.find((item) => item.id === view.baseId);
        await refresh();
        setLocation(
          `/base/${viewBase?.slug ?? activeBase?.slug ?? "blog"}/${merged.view?.slug ?? view.slug}`,
        );
        return;
      }
      await refresh();
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [
      activeBase?.slug,
      approveAndMergeChangeRequest,
      bases,
      client,
      messages.base.updateViewMessage,
      refresh,
      setLocation,
    ],
  );

  const submitDeleteView = useCallback(
    async (view: ViewVO) => {
      setError(null);
      const changeRequest = await client.createDeleteViewChangeRequest(view.id);
      await refresh();
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [client, refresh, setLocation],
  );

  const submitRestoreView = useCallback(
    async (view: ViewVO) => {
      setError(null);
      const changeRequest = await client.createRestoreViewChangeRequest(view.id, {
        submittedBy: "local-editor",
        message: fmt(messages.base.restoreViewMessage, { view: view.name }),
      });
      await approveAndMergeChangeRequest(changeRequest.id);
      await queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedViews.queryOptions({ input: { baseId: view.baseId } })
          .queryKey,
      });
      await refresh();
      toast.success(messages.base.viewRestored);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.restoreViewMessage,
      messages.base.viewRestored,
      orpc,
      queryClient,
      refresh,
    ],
  );

  const submitRestoreRecord = useCallback(
    async (record: RecordVO) => {
      setError(null);
      const changeRequest = await client.createRestoreRecordChangeRequest(record.id, {
        submittedBy: "local-editor",
        message: messages.recordView.restoreRecordMessage,
      });
      await approveAndMergeChangeRequest(changeRequest.id);
      await queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedRecordsPaged.key(),
      });
      await refresh();
      toast.success(messages.recordView.recordRestored);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.recordView.recordRestored,
      messages.recordView.restoreRecordMessage,
      orpc,
      queryClient,
      refresh,
    ],
  );

  const viewedRecordIds = useRef(new Set<string>());
  useEffect(() => {
    if (!isRecordRoute || isEditRecordRoute || !activeRecord) {
      return;
    }
    if (viewedRecordIds.current.has(activeRecord.id)) {
      return;
    }
    viewedRecordIds.current.add(activeRecord.id);
    client
      .createAuditEvent({
        action: "record.viewed",
        actorId: "local-viewer",
        baseId: activeRecord.baseId,
        commitId: activeRecord.headCommitId,
        metadata: { title: getRecordTitle(activeRecord, messages) },
        recordId: activeRecord.id,
      })
      .then((event) => {
        queryClient.setQueryData<AuditEventVO[]>(listKeys.auditEvents, (current = []) => [
          event,
          ...current.filter((item) => item.id !== event.id),
        ]);
      })
      .catch(() => {
        viewedRecordIds.current.delete(activeRecord.id);
      });
  }, [
    activeRecord,
    client,
    isEditRecordRoute,
    isRecordRoute,
    listKeys.auditEvents,
    messages,
    queryClient,
  ]);

  const setSearchOpen = useCallback(
    (open: boolean) => {
      if (searchOpen === undefined) {
        setUncontrolledSearchOpen(open);
      }
      onSearchOpenChange?.(open);
    },
    [onSearchOpenChange, searchOpen],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, [setSearchOpen]);

  const topbarActions = useMemo(() => {
    // Record view/edit → a View/Edit switch in the titlebar (far right).
    if ((isRecordRoute || isEditRecordRoute) && activeBase && selectedRecordId) {
      return (
        <RecordTopbarActions
          activeTab={isEditRecordRoute ? "edit" : "view"}
          base={activeBase}
          recordId={selectedRecordId}
        />
      );
    }

    const showBaseTabs =
      Boolean(activeBase) &&
      (Boolean(baseParams?.slug) ||
        isBaseSetupRoute ||
        isBaseDesignRoute ||
        isLegacyBaseSetupRoute) &&
      !isRecordRoute &&
      !isNewRecordRoute &&
      !isEditRecordRoute;

    if (!showBaseTabs || !activeBase) {
      return null;
    }

    return (
      <BaseTopbarActions activeTab={isBaseSetupRoute ? "design" : "records"} base={activeBase} />
    );
  }, [
    activeBase,
    baseParams?.slug,
    isBaseDesignRoute,
    isBaseSetupRoute,
    isEditRecordRoute,
    isLegacyBaseSetupRoute,
    isNewRecordRoute,
    isRecordRoute,
    selectedRecordId,
  ]);

  const activeView = useMemo(() => {
    if (locationPath === "/" || locationPath === "/inbox") {
      return (
        <InboxView
          activeView={inboxView}
          emptyGuide={emptyGuide}
          orpc={orpc}
          onBatchReview={runBatchReview}
          isBatchPending={isBatchPending}
        />
      );
    }

    if (isOperationRoute || isChangeRequestRoute) {
      // A change request is the single review surface; an operation route just
      // deep-links / focuses one of its sections within the same page.
      return (
        <ChangeRequestDetailPage
          auditEvents={auditEvents}
          changeRequest={selectedChangeRequest}
          client={client}
          focusOperationId={isOperationRoute ? (operationParams?.operationId ?? null) : null}
          isPending={isPending}
          onApprove={approveChangeRequest}
          onClose={closeChangeRequest}
          onMerge={mergeChangeRequest}
          onReject={rejectChangeRequest}
        />
      );
    }

    if (locationPath === "/activity") {
      return <ActivityView orpc={orpc} emptyGuide={emptyGuide} />;
    }

    if (locationPath === "/assets" || locationPath.startsWith("/assets/")) {
      const assetId = locationPath.startsWith("/assets/")
        ? locationPath.slice("/assets/".length)
        : null;
      return (
        <AssetsView
          assetId={assetId}
          onBack={() => setLocation("/assets")}
          onOpenAsset={(id) => setLocation(`/assets/${id}`)}
          onOpenNode={(nodeType, nodeSlug) => setLocation(`/${nodeType}/${nodeSlug}`)}
          orpc={orpc}
          emptyGuide={emptyGuide}
        />
      );
    }

    if (isArchivedRoute) {
      return (
        <ArchivedBasesView
          archivedBases={archivedBases}
          archivedNodes={archivedNodes}
          onPurgeBase={submitPurgeBase}
          onPurgeNode={submitPurgeNode}
          onRestoreBase={submitRestoreBase}
          onRestoreNode={submitRestoreNode}
        />
      );
    }

    if (isGraphRoute) {
      return <BaseGraphView bases={bases} nodes={nodeTree} />;
    }

    if (isBaseSetupRoute) {
      return (
        <BaseSetupView
          base={activeBase}
          bases={bases}
          deletedFields={deletedFields}
          orpc={orpc}
          onCreateField={submitCreateBaseField}
          onRenameBase={submitRenameBase}
          onRestoreField={submitRestoreField}
          onUpdateFieldName={submitUpdateFieldName}
        />
      );
    }

    if (isNewRecordRoute) {
      return (
        <RecordEditorView
          base={activeBase}
          mode="new"
          onSubmitCreate={submitCreateRecord}
          onSubmitError={setError}
          onUploadAttachment={uploadAttachment}
          records={records}
          record={null}
        />
      );
    }

    if (isEditRecordRoute) {
      return (
        <RecordEditorView
          base={activeBase}
          mode="edit"
          onSubmitError={setError}
          onSubmitUpdate={submitUpdateRecord}
          onUploadAttachment={uploadAttachment}
          records={records}
          record={activeRecord}
        />
      );
    }

    if (isRecordRoute) {
      return (
        <RecordDetailView
          client={client}
          onDeleteChangeRequest={submitDeleteRecord}
          records={records}
          record={activeRecord}
        />
      );
    }

    if (locationPath.startsWith("/base/")) {
      const archivedMatch = selectedBaseSlug
        ? archivedBases.find((b) => b.slug === selectedBaseSlug)
        : null;
      if (archivedMatch) {
        return (
          <ArchivedBasesView archivedBases={[archivedMatch]} onRestoreBase={submitRestoreBase} />
        );
      }
      // Cold cache / direct link: the base hasn't resolved yet and the list is
      // still loading — show a table-shaped skeleton instead of flashing an empty
      // "not found" state.
      if (!activeBase && basesQuery.isLoading) {
        return <BaseTableSkeleton />;
      }
      return (
        <BaseDetailView
          activeView={selectedBaseView}
          archivedViews={archivedViewsForBase}
          archivedRecords={archivedRecordsForBase}
          archivedPagination={archivedRecordsPagination}
          records={records}
          orderedRecords={serverSortedView ? baseRecords : undefined}
          orpc={orpc}
          pagination={recordsPagination}
          base={activeBase}
          onCreateView={submitCreateView}
          onDeleteView={submitDeleteView}
          onRestoreView={submitRestoreView}
          onRestoreRecord={submitRestoreRecord}
          onUpdateView={submitUpdateView}
          views={views}
        />
      );
    }

    // Node-detail routes resolve their view from the per-platform renderer registry
    // (each domain registers via registerNodeDetail) instead of a hardcoded branch.
    const nodeDetailRoute = isSkillRoute
      ? { type: "skill", slug: selectedSkillSlug }
      : isDriveRoute
        ? { type: "drive", slug: selectedDriveSlug }
        : isAirappRoute
          ? { type: "airapp", slug: selectedAirappSlug }
          : isFileRoute
            ? { type: "file", slug: selectedFileSlug }
            : isDocRoute
              ? { type: "doc", slug: selectedDocSlug }
              : isFolderRoute
                ? { type: "folder", slug: selectedFolderSlug }
                : null;
    if (nodeDetailRoute) {
      const RenderDetail = getNodeDetail(nodeDetailRoute.type);
      if (RenderDetail) {
        return <RenderDetail orpc={orpc} slug={nodeDetailRoute.slug} />;
      }
    }

    return (
      <InboxView
        activeView={inboxView}
        emptyGuide={emptyGuide}
        orpc={orpc}
        onBatchReview={runBatchReview}
        isBatchPending={isBatchPending}
      />
    );
  }, [
    activeBase,
    activeRecord,
    approveChangeRequest,
    closeChangeRequest,
    auditEvents,
    bases,
    basesQuery.isLoading,
    client,
    emptyGuide,
    isChangeRequestRoute,
    isEditRecordRoute,
    isGraphRoute,
    isOperationRoute,
    isRecordRoute,
    isSkillRoute,
    isDriveRoute,
    isAirappRoute,
    isFileRoute,
    isDocRoute,
    isFolderRoute,
    nodeTree,
    orpc,
    selectedSkillSlug,
    selectedDriveSlug,
    selectedAirappSlug,
    selectedFileSlug,
    selectedDocSlug,
    selectedFolderSlug,
    selectedBaseView,
    isNewRecordRoute,
    isPending,
    isBatchPending,
    runBatchReview,
    locationPath,
    inboxView,
    mergeChangeRequest,
    records,
    rejectChangeRequest,
    isBaseSetupRoute,
    selectedChangeRequest,
    operationParams,
    submitCreateRecord,
    submitCreateBaseField,
    submitRenameBase,
    submitCreateView,
    submitDeleteRecord,
    submitDeleteView,
    submitRestoreBase,
    submitRestoreNode,
    submitPurgeNode,
    submitPurgeBase,
    submitRestoreField,
    submitRestoreView,
    submitRestoreRecord,
    submitUpdateFieldName,
    submitUpdateRecord,
    submitUpdateView,
    uploadAttachment,
    views,
    archivedBases,
    archivedNodes,
    archivedViewsForBase,
    archivedRecordsForBase,
    archivedRecordsPagination,
    deletedFields,
    isArchivedRoute,
    selectedBaseSlug,
    setLocation,
    recordsPagination,
    serverSortedView,
    baseRecords,
  ]);

  const content = (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-4 py-1.5 backdrop-blur-sm md:h-12">
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          <BusabaseTopbarBreadcrumb items={breadcrumbItems} />
          {titlebar.badge ? <div className="ml-1 shrink-0">{titlebar.badge}</div> : null}
          {topbarActions ? <div className="shrink-0">{topbarActions}</div> : null}
        </div>
        {error ? (
          isConflictErrorMessage(error) ? (
            <ReviewConflictPanel message={error} />
          ) : (
            <div className="border-red-200 border-b bg-red-50 px-4 py-2 text-red-800 text-sm">
              {error}
            </div>
          )
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">{activeView}</div>
      </div>
      <SidePanel orpc={orpc} />
      <SearchDialog
        bases={bases}
        orpc={orpc}
        changeRequests={changeRequests}
        onClose={closeSearch}
        open={isSearchOpen}
        records={records}
      />
    </div>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">{content}</main>
  );
}
