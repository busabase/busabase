"use client";

import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SidebarTrigger } from "kui/sidebar";
// Demo-aware navigation (same helpers as apps/productready & apps/buda):
// `SPALink` appends `?demo=1` on <Link> clicks; `useAddDemoParam` wraps
// programmatic `setLocation` targets — together they keep the demo across all
// navigation (the proxy reads `?demo` via Referer and keeps serving the demo router).
import { useAddDemoParam } from "openlib/ui/dashboard";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { type BusabaseDashboardApiClient, createBusabaseRestApiClient } from "../../api-client";
import { createBusabaseQueryUtils } from "../../api-client/react-query";
import { CoreI18nProvider } from "../../i18n";
import type { AuditEventVO, BaseVO, ChangeRequestVO, NodeVO, RecordVO, ViewVO } from "../../types";
import { AssetsView } from "./components/assets";
import { BaseDetailView, BaseSetupView, BaseTopbarActions } from "./components/base-views";
import { ChangeRequestDetailPage, ReviewConflictPanel } from "./components/change-request-review";
import { getChangeRequestTitle, getOperationTitle, getRecordTitle } from "./helpers/change-request";
// Side-effect import: registers the skill/doc/folder node-detail renderers.
import "./components/node-detail-views";
import { BaseGraphView } from "./components/graph-view";
import { ActivityView, InboxView } from "./components/inbox";
import { RecordDetailView, RecordEditorView, RecordTopbarActions } from "./components/record-views";
import { SearchDialog } from "./components/search-dialog";
import { BusabaseTopbarBreadcrumb } from "./components/topbar";
import { getRelationRecordIds } from "./helpers/field";
import { getLocationPath, readInboxView } from "./helpers/inbox";
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
import { getNodeDetail } from "./node-detail-registry";

interface BusabaseDashboardProps {
  nodes: NodeVO[];
  bases: BaseVO[];
  changeRequests: ChangeRequestVO[];
  records: RecordVO[];
  views?: ViewVO[];
  auditEvents?: AuditEventVO[];
  apiBasePath?: string;
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
  apiClient,
  auditEvents: initialAuditEvents = [],
  changeRequests: initialChangeRequests,
  emptyGuide,
  records: initialRecords,
  bases: initialBases,
  nodes: nodeTree,
  views: initialViews = [],
  embedded = false,
  onSearchOpenChange,
  searchOpen,
}: BusabaseDashboardProps) {
  const orpc = useMemo(() => createBusabaseQueryUtils(apiBasePath), [apiBasePath]);
  const queryClient = useQueryClient();
  const client = useMemo(
    () => apiClient ?? createBusabaseRestApiClient(apiBasePath),
    [apiBasePath, apiClient],
  );
  const uploadAttachment = useAttachmentUpload(client);
  // Reads run through oRPC + React Query, seeded by the SSR props as initialData.
  const changeRequestsList = orpc.changeRequests.list.queryOptions({ input: {} });
  const recordsList = orpc.records.list.queryOptions({ input: {} });
  const basesList = orpc.bases.list.queryOptions({});
  const auditEventsList = orpc.auditEvents.list.queryOptions({ input: {} });
  const changeRequestsQuery = useQuery({
    ...changeRequestsList,
    initialData: initialChangeRequests,
  });
  const recordsQuery = useQuery({ ...recordsList, initialData: initialRecords });
  const basesQuery = useQuery({ ...basesList, initialData: initialBases });
  const auditEventsQuery = useQuery({ ...auditEventsList, initialData: initialAuditEvents });
  const allChangeRequests = changeRequestsQuery.data ?? [];
  const baseRecords = recordsQuery.data ?? [];
  const bases = basesQuery.data ?? [];
  const auditEvents = auditEventsQuery.data ?? [];
  // Stable query keys for cache writes/invalidation (orpc is memoized on apiBasePath).
  const listKeys = useMemo(
    () => ({
      changeRequests: orpc.changeRequests.list.queryOptions({ input: {} }).queryKey as QueryKey,
      records: orpc.records.list.queryOptions({ input: {} }).queryKey as QueryKey,
      bases: orpc.bases.list.queryOptions({}).queryKey as QueryKey,
      auditEvents: orpc.auditEvents.list.queryOptions({ input: {} }).queryKey as QueryKey,
    }),
    [orpc],
  );
  const [error, setError] = useState<string | null>(null);
  const [location, rawSetLocation] = useLocation();
  // Wrap every programmatic navigation so it keeps `?demo` in demo mode (the
  // productready/buda pattern, applied once at the source instead of per call site).
  const addDemoParam = useAddDemoParam();
  const setLocation = useCallback(
    (to: string, options?: { replace?: boolean; state?: unknown }) =>
      rawSetLocation(addDemoParam(to), options),
    [rawSetLocation, addDemoParam],
  );
  const search = useSearch();
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
    isDocRoute,
    isFolderRoute,
    isBaseSetupRoute,
    selectedBaseSlug,
    selectedSkillSlug,
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
  const isBaseViewRoute = Boolean(isBaseChildRoute && selectedBaseView);
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
  // A change request opened by direct link may not be in the list query (e.g. a
  // merged/closed CR); fetch it on demand via React Query and fall back to it.
  const fallbackChangeRequestQuery = useQuery({
    ...orpc.changeRequests.get.queryOptions({
      input: { changeRequestId: selectedChangeRequestId ?? "" },
    }),
    enabled:
      Boolean(selectedChangeRequestId) &&
      !allChangeRequests.some((changeRequest) => changeRequest.id === selectedChangeRequestId),
  });
  const selectedChangeRequest = useMemo(
    () =>
      allChangeRequests.find((changeRequest) => changeRequest.id === selectedChangeRequestId) ??
      fallbackChangeRequestQuery.data ??
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
              : "Operation"}
          </span>
        ) : null,
        title: selectedOperation ? getOperationTitle(selectedOperation) : "Operation",
      };
    }

    if (isChangeRequestRoute) {
      return {
        badge: null,
        title: selectedChangeRequest
          ? getChangeRequestTitle(selectedChangeRequest)
          : "Change Request",
      };
    }

    if (isBaseSetupRoute) {
      return { badge: null, title: `${activeBase?.name ?? "Base"} design` };
    }

    if (isNewRecordRoute) {
      return { badge: null, title: `New ${activeBase?.name ?? "Record"}` };
    }

    if (isEditRecordRoute) {
      return { badge: null, title: `Edit ${getRecordTitle(activeRecord)}` };
    }

    if (isRecordRoute) {
      return { badge: null, title: getRecordTitle(activeRecord) };
    }

    if (isBaseViewRoute) {
      return { badge: null, title: selectedBaseView?.name ?? "View" };
    }

    if (locationPath.startsWith("/base/")) {
      return { badge: null, title: activeBase?.name ?? "Base" };
    }

    if (locationPath === "/activity") {
      return { badge: null, title: "Activity" };
    }

    if (locationPath === "/assets") {
      return { badge: null, title: "Assets" };
    }

    if (isAssetDetailRoute) {
      return { badge: null, title: "Asset" };
    }

    return {
      badge: null,
      title: "Reviews",
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
  ]);

  const breadcrumbItems = useMemo<BusabaseBreadcrumbItem[]>(() => {
    if (isOperationRoute) {
      return [
        { href: "/inbox", label: "Reviews" },
        {
          href: selectedChangeRequest ? `/inbox/${selectedChangeRequest.id}` : undefined,
          label: selectedChangeRequest
            ? getChangeRequestTitle(selectedChangeRequest)
            : "Change Request",
        },
        { label: selectedOperation ? getOperationTitle(selectedOperation) : "Operation" },
      ];
    }

    if (isChangeRequestRoute) {
      return [
        { href: "/inbox", label: "Reviews" },
        {
          label: selectedChangeRequest
            ? getChangeRequestTitle(selectedChangeRequest)
            : "Change Request",
        },
      ];
    }

    if (locationPath === "/activity") {
      return [{ label: "Activity" }];
    }

    if (locationPath === "/assets") {
      return [{ label: "Assets" }];
    }

    if (isAssetDetailRoute) {
      return [{ href: "/assets", label: "Assets" }, { label: "Asset" }];
    }

    if (isBaseSetupRoute) {
      return [
        { label: "Bases" },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? "Base",
        },
        { label: "Design" },
      ];
    }

    if (isNewRecordRoute) {
      return [
        { label: "Bases" },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? "Base",
        },
        { label: "New Record" },
      ];
    }

    if (isEditRecordRoute) {
      return [
        { label: "Bases" },
        {
          href: activeRecord
            ? `/base/${activeRecord.base.slug}`
            : activeBase
              ? `/base/${activeBase.slug}`
              : undefined,
          label: activeBase?.name ?? activeRecord?.base.name ?? "Base",
        },
        {
          href: activeRecord ? `/base/${activeRecord.base.slug}/${activeRecord.id}` : undefined,
          label: activeRecord ? getRecordTitle(activeRecord) : "Record",
        },
        { label: "Edit" },
      ];
    }

    if (isRecordRoute) {
      return [
        { label: "Bases" },
        {
          href: activeRecord
            ? `/base/${activeRecord.base.slug}`
            : activeBase
              ? `/base/${activeBase.slug}`
              : undefined,
          label: activeBase?.name ?? activeRecord?.base.name ?? "Base",
        },
        { label: activeRecord ? getRecordTitle(activeRecord) : "Record" },
      ];
    }

    if (isBaseViewRoute) {
      return [
        { label: "Bases" },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? "Base",
        },
        { label: selectedBaseView?.name ?? "View" },
      ];
    }

    if (locationPath.startsWith("/base/")) {
      return [{ label: "Bases" }, { label: activeBase?.name ?? "Base" }];
    }

    return [{ label: "Reviews" }];
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
  ]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequests }),
      queryClient.invalidateQueries({ queryKey: listKeys.records }),
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
    }) => {
      if (variables.action === "approve") {
        await client.approveChangeRequest(variables.changeRequestId, variables.reason);
      } else if (variables.action === "reject") {
        await client.rejectChangeRequest(variables.changeRequestId, variables.reason);
      } else if (variables.action === "close") {
        await client.closeChangeRequest(variables.changeRequestId, variables.reason);
      } else {
        return client.mergeChangeRequest(variables.changeRequestId);
      }
    },
    onMutate: () => setError(null),
    onError: (mutationError) =>
      setError(mutationError instanceof Error ? mutationError.message : "Operation failed"),
    onSuccess: (result, variables) => {
      if (variables.action !== "merge") {
        return;
      }
      const record = result?.record;
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

  const submitCreateRecord = useCallback(
    async (base: BaseVO, fields: Record<string, unknown>, options?: RecordSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createChangeRequest(base.id, {
        fields,
        message: `Create ${base.name} record`,
        submittedBy: "local-editor",
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        const mergedRecord = merged.record;
        if (!mergedRecord) {
          throw new Error("Merged change request did not return a record");
        }
        await refresh();
        setLocation(`/base/${mergedRecord.base.slug}/${mergedRecord.id}`);
        return;
      }
      setLocation(`/inbox/${changeRequest.id}`);
      await refresh();
    },
    [approveAndMergeChangeRequest, client, refresh, setLocation],
  );

  const submitUpdateRecord = useCallback(
    async (record: RecordVO, fields: Record<string, unknown>, options?: RecordSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createUpdateChangeRequest(record.id, {
        author: "local-editor",
        fields,
        message: `Update ${getRecordTitle(record)}`,
      });
      if (options?.mergeImmediately) {
        const merged = await approveAndMergeChangeRequest(changeRequest.id);
        const mergedRecord = merged.record;
        if (!mergedRecord) {
          throw new Error("Merged change request did not return a record");
        }
        await refresh();
        setLocation(`/base/${mergedRecord.base.slug}/${mergedRecord.id}`);
        return;
      }
      setLocation(`/inbox/${changeRequest.id}`);
      await refresh();
    },
    [approveAndMergeChangeRequest, client, refresh, setLocation],
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
        message: `Add field ${payload.name}`,
        submittedBy: "local-editor",
      });
      await refresh();
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [client, refresh, setLocation],
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
        toast.success("Base renamed");
        setLocation(`/base/${base.slug}`);
        return;
      }
      await refresh();
      toast.success("Rename request submitted");
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [approveAndMergeChangeRequest, client, refresh, setLocation],
  );

  const submitCreateView = useCallback(
    async (base: BaseVO, payload: ViewFormPayload, options?: ViewSubmitOptions) => {
      setError(null);
      if (!payload.slug) {
        throw new Error("View slug is required.");
      }
      const changeRequest = await client.createViewChangeRequest(base.id, {
        config: payload.config,
        description: payload.description,
        message: payload.message ?? `Create ${payload.name} view`,
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
    [approveAndMergeChangeRequest, client, refresh, setLocation],
  );

  const submitUpdateView = useCallback(
    async (view: ViewVO, payload: ViewFormPayload, options?: ViewSubmitOptions) => {
      setError(null);
      const changeRequest = await client.createUpdateViewChangeRequest(view.id, {
        config: payload.config,
        description: payload.description,
        message: payload.message ?? `Update ${payload.name || view.name} view`,
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
    [activeBase?.slug, approveAndMergeChangeRequest, bases, client, refresh, setLocation],
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
        metadata: { title: getRecordTitle(activeRecord) },
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
  }, [activeRecord, client, isEditRecordRoute, isRecordRoute, listKeys.auditEvents, queryClient]);

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
          changeRequests={allChangeRequests}
          emptyGuide={emptyGuide}
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
      return (
        <ActivityView
          auditEvents={auditEvents}
          changeRequests={allChangeRequests}
          emptyGuide={emptyGuide}
          records={records}
        />
      );
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

    if (isGraphRoute) {
      return <BaseGraphView bases={bases} nodes={nodeTree} />;
    }

    if (isBaseSetupRoute) {
      return (
        <BaseSetupView
          base={activeBase}
          bases={bases}
          onCreateField={submitCreateBaseField}
          onRenameBase={submitRenameBase}
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
      return (
        <BaseDetailView
          activeView={selectedBaseView}
          records={records}
          base={activeBase}
          onCreateView={submitCreateView}
          onDeleteView={submitDeleteView}
          onUpdateView={submitUpdateView}
          views={views}
        />
      );
    }

    // Node-detail routes resolve their view from the per-platform renderer registry
    // (each domain registers via registerNodeDetail) instead of a hardcoded branch.
    const nodeDetailRoute = isSkillRoute
      ? { type: "skill", slug: selectedSkillSlug }
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
        changeRequests={allChangeRequests}
        emptyGuide={emptyGuide}
      />
    );
  }, [
    activeBase,
    activeRecord,
    approveChangeRequest,
    closeChangeRequest,
    auditEvents,
    allChangeRequests,
    bases,
    client,
    emptyGuide,
    isChangeRequestRoute,
    isEditRecordRoute,
    isGraphRoute,
    isOperationRoute,
    isRecordRoute,
    isSkillRoute,
    isDocRoute,
    isFolderRoute,
    nodeTree,
    orpc,
    selectedSkillSlug,
    selectedDocSlug,
    selectedFolderSlug,
    selectedBaseView,
    isNewRecordRoute,
    isPending,
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
    submitUpdateRecord,
    submitUpdateView,
    uploadAttachment,
    views,
    setLocation,
  ]);

  const content = (
    <div className="flex h-full min-h-0 flex-col bg-background">
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

      <div className="min-h-0 flex-1">{activeView}</div>
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
