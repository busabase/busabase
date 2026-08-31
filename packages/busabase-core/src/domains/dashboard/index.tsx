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
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import {
  type BusabaseDashboardApiClient,
  createBusabaseRestApiClient,
} from "busabase-contract/api-client";
import {
  type BusabaseClientOptions,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import type {
  AuditEventVO,
  BaseVO,
  ChangeRequestVO,
  NodeVO,
  RecordVO,
  ViewVO,
} from "busabase-contract/types";
import { SidebarTrigger } from "kui/sidebar";
// Demo-aware navigation (the shared `openlib/ui/dashboard` helpers):
// `SPALink` appends `?demo=1` on <Link> clicks; `useAddDemoParam` wraps
// programmatic `setLocation` targets — together they keep the demo across all
// navigation (the proxy reads `?demo` via Referer and keeps serving the demo router).
import { type iString, iStringParse } from "openlib/i18n/i-string";
import { useAddDemoParam } from "openlib/ui/dashboard";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { CoreI18nProvider, fmt, useCoreI18n } from "../../i18n";
import { AgentDetailView } from "../agents/components/agent-detail-view";
import { AgentsAddView } from "../agents/components/agents-add-view";
import { AgentsListView } from "../agents/components/agents-list-view";
import { AirAppKeepAliveHost } from "../airapp/components/AirAppKeepAliveHost";
import { AppsListView } from "../airapp/components/apps-list-view";
import { getPrimaryField } from "../base/utils/primary-field";
import { TemplateCenter } from "../templates/components/template-center";
import type { AgentIntegrationTarget } from "./components/agent-install-panel";
import { ArchivedBasesView } from "./components/archived-bases";
import { AssetsView } from "./components/assets";
import { BaseDetailView, BaseSetupView, BaseTopbarActions } from "./components/base-views";
import {
  ChangeRequestDetailPage,
  type ReviewAction,
  ReviewConflictPanel,
} from "./components/change-request-review";
import {
  getChangeRequestReviewMessage,
  getChangeRequestTitle,
  getOperationTitle,
  getRecordTitle,
} from "./helpers/change-request";
// Side-effect import: registers the skill/doc/folder node-detail renderers.
import "./components/node-detail-views";
// Side-effect import: registers Whiteboard, Workflow, and HTML renderers.
import "../rich-node/components/register";
import { AirAppEngineAvailabilityProvider } from "../airapp/components/engine-availability-context";
import { NodeActivityView, RecordActivityView } from "./components/activity";
import { BaseGraphView } from "./components/graph-view";
import { HomeView } from "./components/home";
import { ActivityView, InboxView } from "./components/inbox";
import { RecordDetailView, RecordEditorView, RecordTopbarActions } from "./components/record-views";
import { SearchDialog } from "./components/search-dialog";
import { SidePanel, SidePanelToggle } from "./components/side-panel";
import { isPinnableNode, pinNodeToSidePanel } from "./components/side-panel-sources";
import { BaseTableSkeleton, NodeDetailSkeleton } from "./components/skeletons";
import { SubmitPermissionProvider } from "./components/split-submit-button";
import { BusabaseTopbarBreadcrumb, TopbarNodeActionsSlot } from "./components/topbar";
import { getNodeDetailBreadcrumbItems } from "./helpers/breadcrumbs";
import { shouldQueryGlobalChangeRequests } from "./helpers/change-request-data-source";
import { createChangeRequestQueryKeys } from "./helpers/change-request-query-keys";
import { getRelationRecordIds } from "./helpers/field";
import { getLocationPath, readInboxView } from "./helpers/inbox";
import { createKnownNodeCache, type KnownNode, nodeRoutePath } from "./helpers/known-node-cache";
import { mergeSearchIntoHref } from "./helpers/link-search";
import { shouldShowInitialLoadingState } from "./helpers/query-state";
import { readRecordPagination, writeRecordPagination } from "./helpers/record-pagination-url";
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
import { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut";
import { useBusabaseLiveSync } from "./hooks/use-live-sync";
import { getNodeDetail, type LoadedNode } from "./node-detail-registry";
import { type DashboardVisitorKind, DashboardVisitorProvider } from "./visitor-context";

// Flattens the (already-fetched, for sidebar-tree rendering) node tree into
// `KnownNode` cache entries — free, no new request: every `nodes.list`
// response (root eager-prefetch + each lazily-expanded folder) already flows
// through this `nodeTree`/`nodes` prop. `path` mirrors the server's
// `toNodeSearchResultVO` (logic/vo.ts) convention (`/${type}/${slug}`) —
// every built-in node type has its own detail route.
const flattenNodesForCache = (nodes: NodeVO[]): KnownNode[] =>
  nodes.flatMap((node) => [
    {
      id: node.id,
      type: node.type,
      name: node.name,
      slug: node.slug,
      path: nodeRoutePath(node.type, node.slug),
    },
    ...flattenNodesForCache(node.children),
  ]);

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
  /**
   * Host guidance for the Agent install tab of the Template Center's install
   * dialog — which edition's connection instructions to show and which space to
   * pin them to. Same shape the host already passes to its sidebar
   * `BusabaseAgentSkillButton`; omit and the dialog falls back to Desktop's
   * local guidance.
   */
  agentIntegration?: AgentIntegrationTarget;
  embedded?: boolean;
  /**
   * Full-screen, chrome-free rendering: skips the topbar (SidebarTrigger,
   * breadcrumb, badges, topbar actions), the side panel, and the search
   * dialog, rendering only the current SPA-routed node's detail pane. Distinct
   * from `embedded` (which only swaps the outer wrapper tag/height styling and
   * still shows the full topbar) — this is for hosts with NO chrome of their
   * own around the dashboard at all, e.g. busabase-mobile's WebView embed of a
   * single AirApp's Run/Files/Logs UI, where a sidebar toggle or breadcrumb
   * back to the rest of the workspace makes no sense. Defaults to false so
   * every existing browser consumer is unaffected.
   */
  chromeless?: boolean;
  /** Reuses the Change Request detail surface without exposing mutation controls. */
  readOnlyChangeRequestPreview?: boolean;
  /** Reuses the Record detail surface from server-seeded data without broader Base reads. */
  readOnlyRecordPreview?: boolean;
  /**
   * Which AirApp engines this deployment can offer, resolved server-side by
   * `domains/airapp/logic/engine-availability.ts`. Omitted, the dashboard
   * assumes only the in-browser engine — a safe floor, since Nodepod needs
   * nothing configured, rather than an optimistic guess the user pays for.
   */
  availableAirAppEngines?: AirAppRunnerKind[];
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
  /**
   * Who this render is for. `"anonymous"` = a session-less visitor who arrived
   * through a public share link, so the dashboard must confine itself to the
   * ONE shared node it was given and fire only the reads on busabase-core's
   * anonymous allowlist (`bases.get`, `bases.listViews`, `records.list`,
   * `records.get`, `nodes.get`).
   *
   * Every space-wide query below is switched off in that mode. That is a
   * correctness fix, not a security one — the server refuses them either way
   * (see `logic/anonymous-allowlist.ts`); asking anyway just yielded a page of
   * 403s and, worse, an EMPTY base, because `activeBase` used to be looked up
   * inside the (refused) `bases.list` result. Anonymous hosts pass the shared
   * base in via the `bases` prop instead, which seeds the same lookup.
   *
   * Defaults to `"member"` so every existing consumer is untouched.
   */
  visitorKind?: DashboardVisitorKind;
  /** Host-resolved workspace permission; local/open-source defaults to manage. */
  submitPermissionLevel?: ApiKeyPermissionLevel;
}

// Public entry: provides a React Query client so the whole dashboard data layer
// runs on oRPC + TanStack Query. Consumers don't need their own provider; a
// nested QueryClientProvider is harmless if they already have one.
export function BusabaseDashboard({
  locale,
  provideQueryClient = true,
  visitorKind = "member",
  submitPermissionLevel = "manage",
  ...props
}: BusabaseDashboardProps) {
  const queryClient = useMemo(() => new QueryClient(), []);
  const content = (
    <SubmitPermissionProvider permissionLevel={submitPermissionLevel}>
      <CoreI18nProvider locale={locale}>
        {/* Descendants (node-detail views, headers) read this to drop editing and
            permission affordances a session-less visitor can neither use nor be
            shown honestly. */}
        <DashboardVisitorProvider visitorKind={visitorKind}>
          <AirAppEngineAvailabilityProvider engines={props.availableAirAppEngines}>
            <BusabaseDashboardContent {...props} visitorKind={visitorKind} />
          </AirAppEngineAvailabilityProvider>
        </DashboardVisitorProvider>
      </CoreI18nProvider>
    </SubmitPermissionProvider>
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
  agentIntegration,
  auditEvents: initialAuditEvents = [],
  changeRequests: initialChangeRequests,
  currentUserId = null,
  emptyGuide,
  bases: initialBases,
  nodes: nodeTree,
  views: initialViews = [],
  embedded = false,
  chromeless = false,
  readOnlyChangeRequestPreview = false,
  readOnlyRecordPreview = false,
  // Normal Base views still load records per page. A read-only record embed is
  // the narrow exception: its one server-authorized record is seeded here.
  records: initialRecords,
  onSearchOpenChange,
  searchOpen,
  visitorKind = "member",
}: BusabaseDashboardProps) {
  const messages = useCoreI18n();
  // An anonymous (public-link) visitor may reach ONLY the single shared node and
  // only the reads on busabase-core's anonymous allowlist. Every space-wide query
  // below is gated off in that mode: the server refuses them regardless (see
  // logic/anonymous-allowlist.ts), so this is a correctness fix — firing them
  // anyway produced a page of 403s and, because `activeBase` was looked up in the
  // refused `bases.list` result, an empty base. The shared base is seeded via the
  // `bases` prop instead.
  const isAnon = visitorKind === "anonymous";
  const orpc = useMemo(
    () => createBusabaseQueryUtils(apiBasePath, apiClientOptions ?? {}, cacheSpaceKey),
    [apiBasePath, apiClientOptions, cacheSpaceKey],
  );
  const queryClient = useQueryClient();
  const client = useMemo(
    () => apiClient ?? createBusabaseRestApiClient(apiBasePath, apiClientOptions),
    [apiBasePath, apiClient, apiClientOptions],
  );
  const [location, rawSetLocation] = useLocation();
  const search = useSearch();
  const locationPath = getLocationPath(location);
  const nodeCache = useMemo(
    () => createKnownNodeCache(`${cacheSpaceKey}:${currentUserId ?? "anonymous"}`),
    [cacheSpaceKey, currentUserId],
  );
  const [loadedDetailNode, setLoadedDetailNode] = useState<{
    node: LoadedNode;
    scopeKey: string;
  } | null>(null);
  const recordLoadedNode = useCallback(
    (node: LoadedNode) => {
      setLoadedDetailNode({ node, scopeKey: cacheSpaceKey });
      nodeCache.recordVisit(
        {
          id: node.id,
          type: node.type,
          name: node.name,
          slug: node.slug,
          path: nodeRoutePath(node.type, node.slug),
        },
        new Date().toISOString(),
      );
    },
    [cacheSpaceKey, nodeCache],
  );
  // Reads run through oRPC + React Query, seeded by the SSR props as initialData.
  const changeRequestsList = orpc.changeRequests.list.queryOptions({ input: {} });
  const basesList = orpc.bases.list.queryOptions({ input: {} });
  const archivedBasesList = orpc.bases.list.queryOptions({ input: { status: "archived" } });
  const archivedNodesList = orpc.nodes.list.queryOptions({ input: { status: "archived" } });
  const auditEventsList = orpc.auditEvents.list.queryOptions({ input: {} });
  const changeRequestsQuery = useQuery({
    ...changeRequestsList,
    // The endpoint is paginated now; this screen wants the first page's rows and
    // the SSR prop is already just that array. The cast is the pre-existing
    // `ChangeRequestVO` vs inferred-output mismatch on `submittedByUser`'s
    // optionality, which used to be absorbed by passing the array straight in.
    initialData: { changeRequests: initialChangeRequests, nextCursor: null } as {
      changeRequests: typeof initialChangeRequests;
      nextCursor: string | null;
    } & Awaited<ReturnType<typeof changeRequestsList.queryFn>>,
    enabled: !isAnon && shouldQueryGlobalChangeRequests(locationPath),
  });
  // For an anonymous visitor `bases.list` is off; `activeBase` resolves from the
  // seeded `initialBases` prop (the one shared base the public host fetched via
  // the allowlisted `bases.get`) that this query keeps as its fallback data.
  const basesQuery = useQuery({ ...basesList, initialData: initialBases, enabled: !isAnon });
  const archivedBasesQuery = useQuery({ ...archivedBasesList, enabled: !isAnon });
  const archivedNodesQuery = useQuery({ ...archivedNodesList, enabled: !isAnon });
  const auditEventsQuery = useQuery({
    ...auditEventsList,
    initialData: initialAuditEvents,
    enabled: !isAnon,
  });
  const allChangeRequests = changeRequestsQuery.data?.changeRequests ?? [];
  const isChangeRequestsLoaded =
    changeRequestsQuery.isFetchedAfterMount || !changeRequestsQuery.isFetching;
  // Anonymous mode reads the seeded prop directly, NOT the disabled query's
  // cache: `basesQuery` freezes `initialData` at first mount, but the public
  // host resolves the shared base asynchronously (`bases.get`) and passes it in
  // a render later — reading the prop lets that update flow through so
  // `activeBase` (and therefore the records query) actually populates.
  const bases = isAnon ? (initialBases ?? []) : (basesQuery.data ?? []);
  const archivedBases = archivedBasesQuery.data ?? [];
  const archivedNodes = archivedNodesQuery.data ?? [];
  const auditEvents = auditEventsQuery.data ?? [];
  // Stable query keys for cache writes/invalidation (orpc is memoized on apiBasePath).
  const listKeys = useMemo(
    () => ({
      archivedBases: orpc.bases.list.queryOptions({ input: { status: "archived" } })
        .queryKey as QueryKey,
      archivedNodes: orpc.nodes.list.queryOptions({ input: { status: "archived" } })
        .queryKey as QueryKey,
      // Procedure-level page/count/detail keys match every active inbox filter.
      ...createChangeRequestQueryKeys(orpc),
      records: orpc.records.list.key() as QueryKey,
      recordsPage: orpc.records.listPage.key() as QueryKey,
      recordsCount: orpc.records.count.key() as QueryKey,
      bases: orpc.bases.list.queryOptions({ input: {} }).queryKey as QueryKey,
      nodes: orpc.nodes.list.queryOptions({}).queryKey as QueryKey,
      // Partial key so a single invalidation covers `nodes.get` for every
      // nodeId — the rich-node editors (whiteboard/workflow/html) fetch their
      // document via `nodes.get` instead of the tree, so live-sync has to
      // invalidate this alongside `nodes` or their content goes stale across
      // tabs/agents (see `use-live-sync.ts`).
      nodeDetail: orpc.nodes.get.key() as QueryKey,
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
  // Wrap every programmatic navigation so it keeps `?demo` in demo mode
  // (applied once at the source instead of per call
  // site) AND carries forward the rest of the current query string — e.g.
  // Busabase Cloud's `?space=tnl_…` selecting a connected Local ↔ Cloud
  // Tunnel remote space, which a bare `setLocation(`/inbox/${id}`)` would
  // otherwise silently drop, bouncing the host app back to its default space.
  const addDemoParam = useAddDemoParam();
  const setLocation = useCallback(
    (to: string, options?: { replace?: boolean; state?: unknown }) =>
      rawSetLocation(addDemoParam(mergeSearchIntoHref(to, search)), options),
    [rawSetLocation, addDemoParam, search],
  );
  const inboxView = readInboxView(search);
  const [uncontrolledSearchOpen, setUncontrolledSearchOpen] = useState(false);
  const isSearchOpen = searchOpen ?? uncontrolledSearchOpen;

  const {
    isArchivedRoute,
    isGraphRoute,
    isAssetDetailRoute,
    isAgentDetailRoute,
    agentDetailParams,
    isTemplateDetailRoute,
    templateDetailParams,
    isOperationRoute,
    operationParams,
    isChangeRequestRoute,
    isBaseDesignRoute,
    isLegacyBaseSetupRoute,
    isNewRecordRoute,
    isEditRecordRoute,
    editRecordParams,
    isRecordActivityRoute,
    recordActivityParams,
    baseParams,
    isBaseChildRoute,
    baseChildParams,
    isAirappRoute,
    isBaseSetupRoute,
    isBaseActivityRoute,
    selectedBaseSlug,
    selectedAirappSlug,
    nodeDetailRoute,
    nodeActivityRoute,
    selectedChangeRequestId,
  } = useDashboardRoutes();
  const activeDetailNode = useMemo(() => {
    if (!nodeDetailRoute) return null;
    const treeNode = flattenNodesForCache(nodeTree).find(
      (node) =>
        node.type === nodeDetailRoute.type &&
        (node.id === nodeDetailRoute.slug || node.slug === nodeDetailRoute.slug),
    );
    if (treeNode) return treeNode;
    const loadedNode = loadedDetailNode?.node;
    return loadedDetailNode?.scopeKey === cacheSpaceKey &&
      loadedNode?.type === nodeDetailRoute.type &&
      (loadedNode.id === nodeDetailRoute.slug || loadedNode.slug === nodeDetailRoute.slug)
      ? loadedNode
      : null;
  }, [cacheSpaceKey, loadedDetailNode, nodeDetailRoute, nodeTree]);
  // Same resolution as `activeDetailNode` above, but for `/{type}/:slug/activity`.
  const activeActivityNode = useMemo(() => {
    if (!nodeActivityRoute) return null;
    const treeNode = flattenNodesForCache(nodeTree).find(
      (node) =>
        node.type === nodeActivityRoute.type &&
        (node.id === nodeActivityRoute.slug || node.slug === nodeActivityRoute.slug),
    );
    if (treeNode) return treeNode;
    const loadedNode = loadedDetailNode?.node;
    return loadedDetailNode?.scopeKey === cacheSpaceKey &&
      loadedNode?.type === nodeActivityRoute.type &&
      (loadedNode.id === nodeActivityRoute.slug || loadedNode.slug === nodeActivityRoute.slug)
      ? loadedNode
      : null;
  }, [cacheSpaceKey, loadedDetailNode, nodeActivityRoute, nodeTree]);
  const activeBase = useMemo(
    () =>
      selectedBaseSlug
        ? (bases.find(
            (base) =>
              base.id === selectedBaseSlug ||
              base.nodeId === selectedBaseSlug ||
              base.slug === selectedBaseSlug,
          ) ?? null)
        : (bases[0] ?? null),
    [selectedBaseSlug, bases],
  );
  useBusabaseLiveSync({
    activeBaseId: activeBase?.id,
    listKeys,
    orpc,
    queryClient,
    enabled: !isAnon,
    currentUserId,
    notificationTitle: messages.shell.changeRequestPendingReviewTitle,
    notificationBody: messages.shell.changeRequestPendingReviewBody,
  });
  // Deleted fields scoped to the active base (for the Design tab).
  const deletedFieldsQuery = useQuery({
    ...orpc.bases.listDeletedFields.queryOptions({ input: { baseId: activeBase?.id ?? "" } }),
    enabled: Boolean(activeBase?.id && isBaseSetupRoute) && !isAnon,
  });
  const deletedFields = deletedFieldsQuery.data ?? [];
  // Archived views/records for the active base (for restore UI in the table).
  const isBaseDetailRoute = Boolean(
    activeBase?.id && locationPath.startsWith("/base/") && !isBaseSetupRoute,
  );
  const archivedViewsQuery = useQuery({
    ...orpc.bases.listViews.queryOptions({
      input: { baseId: activeBase?.id ?? "", status: "archived" },
    }),
    // Not on the anonymous allowlist, and a public visitor has no "restore"
    // affordance to feed anyway.
    enabled: Boolean(activeBase?.id && isBaseDetailRoute) && !isAnon,
  });
  const archivedViewsForBase = archivedViewsQuery.data ?? [];
  // Archived ("trash") records keyset-paginate too, so a Base with a large
  // soft-deleted history doesn't load it all at once when the section expands.
  const archivedRecordsInfiniteQuery = useInfiniteQuery({
    ...orpc.records.list.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        baseId: activeBase?.id ?? "",
        status: "archived" as const,
        cursor: pageParam,
        limit: RECORDS_PAGE_SIZE,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
    enabled: Boolean(activeBase?.id && isBaseDetailRoute) && !isAnon,
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
  const recordPaginationUrl = useMemo(() => readRecordPagination(search), [search]);
  const usesPagePagination =
    selectedBaseView === null ||
    selectedBaseView.type === "table" ||
    selectedBaseView.type === "gallery";
  const setRecordPaginationUrl = useCallback(
    (page: number, pageSize = recordPaginationUrl.pageSize, replace = false) => {
      const nextSearch = writeRecordPagination(search, { page, pageSize });
      rawSetLocation(`${locationPath}${nextSearch ? `?${nextSearch}` : ""}`, { replace });
    },
    [locationPath, rawSetLocation, recordPaginationUrl.pageSize, search],
  );
  // Preserve a deep-linked page on first load, but reset when the user moves to
  // another Base or saved view. The unrelated query parameters are retained by
  // writeRecordPagination (notably demo and cloud space selection).
  const paginationScope = `${activeBase?.id ?? ""}:${baseChildParams?.childId ?? "all"}`;
  const previousPaginationScope = useRef<string | null>(null);
  useEffect(() => {
    if (!activeBase?.id) return;
    if (previousPaginationScope.current === null) {
      previousPaginationScope.current = paginationScope;
      return;
    }
    if (previousPaginationScope.current !== paginationScope) {
      previousPaginationScope.current = paginationScope;
      if (recordPaginationUrl.page !== 1) {
        setRecordPaginationUrl(1, recordPaginationUrl.pageSize, true);
      }
    }
  }, [
    activeBase?.id,
    paginationScope,
    recordPaginationUrl.page,
    recordPaginationUrl.pageSize,
    setRecordPaginationUrl,
  ]);
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
  // Board/timeline views still need their entire candidate set. Keep their
  // cursor query isolated from the random-access Table/Gallery query below.
  const recordsInfiniteQuery = useInfiniteQuery({
    ...orpc.records.list.infiniteOptions({
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
    enabled: Boolean(activeBase?.id) && !usesPagePagination && !readOnlyRecordPreview,
  });
  const recordsPageQuery = useQuery({
    ...orpc.records.listPage.queryOptions({
      input: {
        baseId: activeBase?.id ?? "",
        viewId: selectedBaseView?.id,
        page: recordPaginationUrl.page,
        pageSize: recordPaginationUrl.pageSize,
      },
    }),
    enabled: Boolean(activeBase?.id) && usesPagePagination && !readOnlyRecordPreview,
    placeholderData: (previousData, previousQuery) => {
      const previousInput = (
        previousQuery?.queryKey[1] as { input?: { baseId?: string; viewId?: string } } | undefined
      )?.input;
      return previousInput?.baseId === activeBase?.id &&
        previousInput?.viewId === selectedBaseView?.id
        ? previousData
        : undefined;
    },
  });
  const baseRecords = useMemo(
    () =>
      usesPagePagination
        ? (recordsPageQuery.data?.records ?? [])
        : (recordsInfiniteQuery.data?.pages.flatMap((page) => page.records) ?? []),
    [recordsInfiniteQuery.data, recordsPageQuery.data?.records, usesPagePagination],
  );
  const recordsPagination = useMemo(() => {
    if (!usesPagePagination) return undefined;
    const pageData = recordsPageQuery.data;
    const changePage = (page: number) => {
      setRecordPaginationUrl(page);
      document.querySelector<HTMLElement>("[data-base-detail-scroll]")?.scrollTo({ top: 0 });
    };
    return {
      page: pageData?.page ?? recordPaginationUrl.page,
      pageSize: recordPaginationUrl.pageSize,
      total: pageData?.total ?? 0,
      totalPages: pageData?.totalPages ?? 0,
      isLoading: recordsPageQuery.isLoading,
      isFetching: recordsPageQuery.isFetching,
      error: recordsPageQuery.error
        ? recordsPageQuery.error instanceof Error
          ? recordsPageQuery.error.message
          : messages.shell.operationFailed
        : null,
      onPageChange: changePage,
      onPageSizeChange: (pageSize: 25 | 50 | 100) => {
        setRecordPaginationUrl(1, pageSize, true);
        document.querySelector<HTMLElement>("[data-base-detail-scroll]")?.scrollTo({ top: 0 });
      },
      onRetry: () => {
        void recordsPageQuery.refetch();
      },
      getPageHref: (page: number) => {
        const nextSearch = writeRecordPagination(search, {
          page,
          pageSize: recordPaginationUrl.pageSize,
        });
        return `${locationPath}${nextSearch ? `?${nextSearch}` : ""}`;
      },
    };
  }, [
    locationPath,
    messages.shell.operationFailed,
    recordPaginationUrl.page,
    recordPaginationUrl.pageSize,
    recordsPageQuery.data,
    recordsPageQuery.error,
    recordsPageQuery.isFetching,
    recordsPageQuery.isLoading,
    recordsPageQuery.refetch,
    search,
    setRecordPaginationUrl,
    usesPagePagination,
  ]);
  const isBaseViewRoute = Boolean(isBaseChildRoute && selectedBaseView);
  // Kanban/Calendar/Gantt operate on the whole set. Their existing cursor API
  // remains the sequential traversal path and is drained in the background.
  const viewNeedsAllRecords = Boolean(selectedBaseView && !usesPagePagination);
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
  // A record deletion can make the current page disappear. Converge to the new
  // last page rather than leaving an empty, out-of-range table.
  useEffect(() => {
    const totalPages = recordsPageQuery.data?.totalPages;
    if (
      usesPagePagination &&
      totalPages !== undefined &&
      recordPaginationUrl.page > Math.max(1, totalPages)
    ) {
      setRecordPaginationUrl(Math.max(1, totalPages), recordPaginationUrl.pageSize, true);
    }
  }, [
    recordPaginationUrl.page,
    recordPaginationUrl.pageSize,
    recordsPageQuery.data?.totalPages,
    setRecordPaginationUrl,
    usesPagePagination,
  ]);
  const isRecordRoute = Boolean(
    isBaseChildRoute && !selectedBaseView && !isBaseSetupRoute && !isBaseActivityRoute,
  );
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
    initialData: initialRecords.find((record) => record.id === selectedRecordId),
    enabled:
      !readOnlyRecordPreview &&
      Boolean(selectedRecordId) &&
      !baseRecords.some((item) => item.id === selectedRecordId),
  });
  const [relationRecordIds, setRelationRecordIds] = useState<string[]>([]);
  const relationRecordQueries = useQueries({
    queries: (readOnlyRecordPreview ? [] : relationRecordIds).map((recordId) => ({
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
            .flatMap((field) => getRelationRecordIds(record.headCommit.payload[field.slug])),
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
    // Public embed hosts seed the one permitted Change Request server-side;
    // never fall back to a space-scoped read from an anonymous iframe.
    enabled: Boolean(selectedChangeRequestId) && isChangeRequestDetailRoute && !isAnon,
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
          <span className="rounded-md border bg-muted/30 px-2.5 py-1 text-muted-foreground text-xs">
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

    // Catch-all: name the landing page, not one particular feature page. (This
    // used to say "Reviews" back when Inbox was where an unqualified visit landed.)
    return {
      badge: null,
      title: messages.nav.home,
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

    // Home before the catch-all below, which falls through to Home for every
    // unlabelled route.
    if (locationPath === "/" || locationPath === "/home") {
      return [{ label: messages.nav.home }];
    }

    if (locationPath === "/inbox") {
      return [{ label: messages.inbox.title }];
    }

    if (locationPath === "/activity") {
      return [{ label: messages.nav.activity }];
    }

    if (locationPath === "/agents") {
      return [{ label: messages.nav.agents }];
    }

    if (locationPath === "/agents/new") {
      return [{ href: "/agents", label: messages.nav.agents }, { label: "Add agent" }];
    }

    if (isAgentDetailRoute) {
      return [
        { href: "/agents", label: messages.nav.agents },
        { label: agentDetailParams?.agentSlug ?? messages.nav.agents },
      ];
    }

    if (locationPath === "/apps") {
      return [{ label: messages.nav.apps }];
    }

    if (locationPath === "/templates") {
      return [{ label: messages.nav.templates }];
    }

    if (isArchivedRoute) {
      return [{ label: messages.trash.title }];
    }

    if (isGraphRoute) {
      return [{ label: messages.nav.graph }];
    }

    if (locationPath === "/assets") {
      return [{ label: messages.nav.assets }];
    }

    if (isAssetDetailRoute) {
      return [{ href: "/assets", label: messages.nav.assets }, { label: messages.nav.assets }];
    }

    const nodeDetailBreadcrumbItems = getNodeDetailBreadcrumbItems(
      nodeDetailRoute,
      activeDetailNode,
      messages,
    );
    if (nodeDetailBreadcrumbItems) return nodeDetailBreadcrumbItems;

    if (isBaseSetupRoute) {
      return [
        { label: messages.nav.workspace },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: messages.base.designTab },
      ];
    }

    if (isNewRecordRoute) {
      return [
        { label: messages.nav.workspace },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: messages.base.newRecord },
      ];
    }

    if (isEditRecordRoute) {
      return [
        { label: messages.nav.workspace },
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
        { label: messages.nav.workspace },
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
        { label: messages.nav.workspace },
        {
          href: activeBase ? `/base/${activeBase.slug}` : undefined,
          label: activeBase?.name ?? messages.nav.base,
        },
        { label: selectedBaseView?.name ?? messages.recordView.view },
      ];
    }

    if (locationPath.startsWith("/base/")) {
      return [{ label: messages.nav.workspace }, { label: activeBase?.name ?? messages.nav.base }];
    }

    // Catch-all, same reasoning as the page-title fallback above.
    return [{ label: messages.nav.home }];
  }, [
    activeBase,
    activeDetailNode,
    activeRecord,
    agentDetailParams,
    isAgentDetailRoute,
    isArchivedRoute,
    isBaseSetupRoute,
    isChangeRequestRoute,
    isEditRecordRoute,
    isAssetDetailRoute,
    isGraphRoute,
    isNewRecordRoute,
    isOperationRoute,
    isBaseViewRoute,
    isRecordRoute,
    locationPath,
    nodeDetailRoute,
    selectedBaseView,
    selectedChangeRequest,
    selectedOperation,
    messages,
  ]);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequests }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestsPaged }),
      queryClient.invalidateQueries({ queryKey: listKeys.inboxSnapshot }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestCounts }),
      queryClient.invalidateQueries({ queryKey: listKeys.changeRequestDetail }),
      queryClient.invalidateQueries({ queryKey: listKeys.records }),
      queryClient.invalidateQueries({ queryKey: listKeys.recordsPage }),
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
  const pendingReviewAction: ReviewAction | null = reviewMutation.isPending
    ? (reviewMutation.variables?.action ?? null)
    : null;

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
      // Explicit `autoMerge: false`: this call must always land as a pending CR
      // regardless of the actor's own permission — `mergeImmediately` below is
      // what decides whether to separately approve + merge it right away.
      const changeRequest = await client.createChangeRequest(base.id, {
        fields,
        message: fmt(messages.createNode.createRecordMessage, { base: base.name }),
        submittedBy: "local-editor",
        autoMerge: false,
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
        autoMerge: false,
        fields,
        message: fmt(messages.createNode.updateRecordMessage, {
          record: getRecordTitle(record, messages),
        }),
      });
      if (changeRequest.materialized) {
        throw new Error("Expected a review-first record update");
      }
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

  // Kanban drag-to-move: set one field on a record and auto-merge the resulting
  // ChangeRequest (an instant change that still leaves an audit trail, per the
  // approval model). Unlike submitUpdateRecord it does NOT navigate — the user
  // stays on the board — and refreshes in place so the card lands in its column.
  const submitMoveRecord = useCallback(
    async (record: RecordVO, fieldSlug: string, value: string | null) => {
      setError(null);
      const changeRequest = await client.createUpdateChangeRequest(record.id, {
        author: "local-editor",
        autoMerge: false,
        fields: { ...record.headCommit.payload, [fieldSlug]: value },
        message: fmt(messages.createNode.updateRecordMessage, {
          record: getRecordTitle(record, messages),
        }),
      });
      if (changeRequest.materialized) {
        throw new Error("Expected a review-first record move");
      }
      await approveAndMergeChangeRequest(changeRequest.id);
      await refresh();
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages,
      messages.createNode.updateRecordMessage,
      refresh,
    ],
  );

  // Gantt drag-to-reschedule: patch several fields at once (start/end dates) via
  // one auto-merged ChangeRequest, staying on the timeline. `patch` is the full
  // fields object the caller already merged, matching submitMoveRecord's shape.
  const submitPatchRecord = useCallback(
    async (record: RecordVO, patch: Record<string, unknown>) => {
      setError(null);
      const changeRequest = await client.createUpdateChangeRequest(record.id, {
        author: "local-editor",
        autoMerge: false,
        fields: patch,
        message: fmt(messages.createNode.updateRecordMessage, {
          record: getRecordTitle(record, messages),
        }),
      });
      if (changeRequest.materialized) {
        throw new Error("Expected a review-first record patch");
      }
      await approveAndMergeChangeRequest(changeRequest.id);
      await refresh();
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages,
      messages.createNode.updateRecordMessage,
      refresh,
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

  // Bulk delete from the table's multi-select toolbar. There is no batch
  // delete endpoint (createBulkChangeRequest only supports batch *create*),
  // so this loops the same single-record delete call per selected record.
  // Deliberately serial rather than Promise.all: bulk deletes run against a
  // local PGLite DB and write an audit-log entry per Change Request, and
  // concurrent writes there have been flaky in other flows in this codebase
  // — sequential is slower but safe. Each record's outcome is isolated so a
  // failure partway through doesn't abort the rest, matching the batch
  // Change-Request review flow above.
  const bulkDeleteRecordsMutation = useMutation({
    mutationFn: async (variables: { records: RecordVO[]; options?: RecordSubmitOptions }) => {
      let ok = 0;
      let failed = 0;
      for (const record of variables.records) {
        try {
          const changeRequest = await client.createDeleteChangeRequest(record.id);
          if (variables.options?.mergeImmediately) {
            await approveAndMergeChangeRequest(changeRequest.id);
          }
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      return { ok, failed };
    },
    onMutate: () => setError(null),
    onSuccess: (result, variables) => {
      // The result tally means something different depending on the mode:
      // with mergeImmediately the records are actually gone; without it,
      // "ok" only counts delete Change Requests that were successfully
      // submitted for review — the records are still present until someone
      // approves them. Reusing one "deleted" message for both would tell the
      // user something false happened when they only requested a review.
      const summary = variables.options?.mergeImmediately
        ? fmt(messages.base.bulkDeleteResult, { ok: result.ok, failed: result.failed })
        : fmt(messages.base.bulkDeleteRequestResult, {
            ok: result.ok,
            failed: result.failed,
            plural: result.ok === 1 ? "" : "s",
          });
      if (result.failed > 0) {
        toast.error(summary);
      } else {
        toast.success(summary);
      }
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof Error ? mutationError.message : messages.shell.operationFailed,
      ),
    onSettled: () => refresh(),
  });
  const submitDeleteRecords = useCallback(
    (recordsToDelete: RecordVO[], options?: RecordSubmitOptions) =>
      bulkDeleteRecordsMutation.mutateAsync({ records: recordsToDelete, options }),
    [bulkDeleteRecordsMutation],
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

  const submitSetPrimaryField = useCallback(
    async (base: BaseVO, fieldId: string, options?: { mergeImmediately?: boolean }) => {
      setError(null);
      const field = base.fields.find((candidate) => candidate.id === fieldId);
      if (!field || getPrimaryField(base)?.id === fieldId) return;
      const fieldIds = [
        fieldId,
        ...base.fields
          .slice()
          .sort((left, right) => left.position - right.position)
          .filter((candidate) => candidate.id !== fieldId)
          .map((candidate) => candidate.id),
      ];
      const changeRequest = await client.createReorderFieldsChangeRequest(base.id, {
        fieldIds,
        message: fmt(messages.base.setRecordTitleMessage, {
          field: iStringParse(field.name),
        }),
        submittedBy: "local-editor",
      });
      if (options?.mergeImmediately) {
        await approveAndMergeChangeRequest(changeRequest.id);
        await refresh();
        toast.success(messages.base.recordTitleUpdated);
        return;
      }
      await refresh();
      toast.success(messages.base.recordTitleRequestSubmitted);
      setLocation(`/inbox/${changeRequest.id}`);
    },
    [
      approveAndMergeChangeRequest,
      client,
      messages.base.recordTitleRequestSubmitted,
      messages.base.recordTitleUpdated,
      messages.base.setRecordTitleMessage,
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
        queryKey: orpc.bases.list.queryOptions({ input: { status: "archived" } }).queryKey,
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
        queryKey: orpc.nodes.list.queryOptions({ input: { status: "archived" } }).queryKey,
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
        queryKey: orpc.nodes.list.queryOptions({ input: { status: "archived" } }).queryKey,
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
        queryKey: orpc.bases.list.queryOptions({ input: { status: "archived" } }).queryKey,
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
        type: payload.type,
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
        type: payload.type,
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
        queryKey: orpc.bases.listViews.queryOptions({
          input: { baseId: view.baseId, status: "archived" },
        }).queryKey,
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
        queryKey: orpc.records.list.key(),
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
    if (readOnlyRecordPreview || !isRecordRoute || isEditRecordRoute || !activeRecord) {
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
    readOnlyRecordPreview,
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

  // Feed the quick-jump cache from fetched sidebar nodes without treating a
  // mere tree load/expand as a visit. Detail renderers report successful opens.
  useEffect(() => {
    nodeCache.merge(flattenNodesForCache(nodeTree));
  }, [nodeCache, nodeTree]);

  // Bases render from the already-resolved bases query rather than the generic
  // node-detail registry, so report their successful route resolution here.
  useEffect(() => {
    if (
      locationPath.startsWith("/base/") &&
      (activeBase?.id === selectedBaseSlug ||
        activeBase?.nodeId === selectedBaseSlug ||
        activeBase?.slug === selectedBaseSlug)
    ) {
      recordLoadedNode({
        id: activeBase.nodeId,
        type: "base",
        name: activeBase.name,
        slug: activeBase.slug,
      });
    }
  }, [activeBase, locationPath, recordLoadedNode, selectedBaseSlug]);

  // Global Cmd+K (Mac) / Ctrl+K (Windows/Linux) quick-jump shortcut — opens the
  // search dialog from anywhere in the dashboard. Registered as two separate
  // bindings (not one "meta-or-ctrl" combo) since `useKeyboardShortcut` treats
  // each modifier exactly, matching how this repo's other cross-platform
  // shortcuts are declared (e.g. the GM-panel toggle's `["meta.shift.m",
  // "ctrl.alt.m"]` pair in apps/*/keyboard-shortcuts-provider.tsx).
  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen]);

  /**
   * Whether the next search selection pins instead of navigating.
   *
   * The dialog is a singleton shared with Cmd-K, so "pin mode" has to be state
   * here rather than a second mounted instance — and it has to be cleared on
   * close, or a Cmd-K right after using the panel's "Search…" would still pin.
   */
  const [searchPinsResult, setSearchPinsResult] = useState(false);
  const openSearchToPin = useCallback(() => {
    setSearchPinsResult(true);
    setSearchOpen(true);
  }, [setSearchOpen]);
  const closeSearchAndClearMode = useCallback(() => {
    setSearchPinsResult(false);
    closeSearch();
  }, [closeSearch]);

  /**
   * The node the side panel's "+" offers to pin, or null when the current page
   * isn't a node at all (`/home`, `/agents`, settings…).
   *
   * Bases need their own branch for two reasons: `nodeDetailRoute` excludes
   * `base` on purpose, and `activeBase` falls back to `bases[0]` when no base
   * is selected — so it is non-null on pages that have nothing to do with a
   * base. Gating on `selectedBaseSlug` is what keeps this honest. A base is
   * also pinned by its `nodeId`, not its `id`.
   */
  const sidePanelCurrentNode = useMemo(() => {
    if (activeDetailNode) {
      return {
        id: activeDetailNode.id,
        type: activeDetailNode.type,
        name: activeDetailNode.name,
      };
    }
    if (selectedBaseSlug && activeBase) {
      return { id: activeBase.nodeId, type: "base", name: activeBase.name };
    }
    return null;
  }, [activeBase, activeDetailNode, selectedBaseSlug]);
  useKeyboardShortcut({ keys: "cmd+k", handler: openSearch });
  useKeyboardShortcut({ keys: "ctrl+k", handler: openSearch });

  const AirAppDetail = chromeless ? undefined : getNodeDetail("airapp");
  const keepAirAppsMounted = Boolean(AirAppDetail);
  const activeAirappSlug = isAirappRoute ? selectedAirappSlug : null;
  const airAppKeepAliveScopeKey = `${cacheSpaceKey}:${currentUserId ?? "anonymous"}`;

  const topbarActions = useMemo(() => {
    // Record view/edit → a View/Edit switch in the titlebar (far right).
    if ((isRecordRoute || isEditRecordRoute) && activeBase && selectedRecordId) {
      return (
        <RecordTopbarActions
          activeTab={isEditRecordRoute ? "edit" : "view"}
          base={activeBase}
          record={activeRecord}
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
    activeRecord,
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
    // Home is the landing page; Inbox keeps its own route but is no longer what
    // an unqualified visit resolves to.
    if (locationPath === "/" || locationPath === "/home") {
      return (
        <HomeView
          changeRequests={allChangeRequests}
          emptyGuide={emptyGuide}
          isChangeRequestsLoaded={isChangeRequestsLoaded}
          nodeCache={nodeCache}
          onOpenSearch={openSearch}
          orpc={orpc}
        />
      );
    }

    if (locationPath === "/inbox") {
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
      if (
        shouldShowInitialLoadingState(selectedChangeRequest, fallbackChangeRequestQuery.isLoading)
      ) {
        return <NodeDetailSkeleton variant="doc" />;
      }
      // A change request is the single review surface; an operation route just
      // deep-links / focuses one of its sections within the same page.
      return (
        <ChangeRequestDetailPage
          auditEvents={auditEvents}
          changeRequest={selectedChangeRequest}
          client={client}
          focusOperationId={isOperationRoute ? (operationParams?.operationId ?? null) : null}
          pendingAction={pendingReviewAction}
          onApprove={approveChangeRequest}
          onClose={closeChangeRequest}
          onMerge={mergeChangeRequest}
          onReject={rejectChangeRequest}
          onRevised={refresh}
          readOnly={readOnlyChangeRequestPreview}
        />
      );
    }

    if (locationPath === "/activity") {
      return <ActivityView orpc={orpc} emptyGuide={emptyGuide} />;
    }

    if (locationPath === "/agents") {
      return (
        <AgentsListView
          orpc={orpc}
          onSelectAgent={(slug) => setLocation(`/agents/${slug}`)}
          onAddAgent={() => setLocation("/agents/new")}
        />
      );
    }

    if (locationPath === "/apps") {
      return <AppsListView orpc={orpc} />;
    }

    if (locationPath === "/templates" || isTemplateDetailRoute) {
      return (
        <TemplateCenter
          orpc={orpc}
          apiClient={apiClient}
          agentIntegration={agentIntegration}
          selectedName={isTemplateDetailRoute ? (templateDetailParams?.templateName ?? null) : null}
          onSelect={(template) => setLocation(`/templates/${template.name}`)}
          onBack={() => setLocation("/templates")}
          onReviewChangeRequests={() => setLocation("/inbox")}
          onInstalled={() => {
            // Structure is created immediately, so the tree on screen is
            // already out of date by the time this fires.
            void queryClient.invalidateQueries();
          }}
        />
      );
    }

    if (locationPath === "/agents/new") {
      return (
        <AgentsAddView
          orpc={orpc}
          onBack={() => setLocation("/agents")}
          onConnected={(slug) => setLocation(`/agents/${slug}`)}
          spaceId={cacheSpaceKey}
        />
      );
    }

    if (isAgentDetailRoute) {
      return (
        <AgentDetailView
          orpc={orpc}
          agentSlug={agentDetailParams?.agentSlug ?? ""}
          onBack={() => setLocation("/agents")}
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

    if (
      locationPath.startsWith("/base/") &&
      shouldShowInitialLoadingState(activeBase, basesQuery.isFetching)
    ) {
      return <BaseTableSkeleton />;
    }

    if (isArchivedRoute) {
      if (archivedBasesQuery.isPending || archivedNodesQuery.isPending) {
        return <NodeDetailSkeleton variant="folder" />;
      }
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
          onRestoreField={submitRestoreField}
          onSetPrimaryField={submitSetPrimaryField}
          onUpdateFieldName={submitUpdateFieldName}
        />
      );
    }

    if (isBaseActivityRoute) {
      // Must be checked BEFORE isNewRecordRoute/isEditRecordRoute/isRecordRoute
      // below — those all derive from the same `/base/:slug/:childId` match
      // (`isBaseChildRoute`) that "activity" also satisfies, and would
      // otherwise treat "activity" as a nonexistent record id.
      return (
        <NodeActivityView
          breadcrumb={activeBase?.name ?? messages.nav.base}
          nodeId={activeBase?.nodeId ?? ""}
          orpc={orpc}
        />
      );
    }

    if (isRecordActivityRoute) {
      // Unlike `isBaseActivityRoute` above, this is a 4-segment path
      // (`/base/:slug/:recordId/activity`) that can't be shadowed by the
      // single-segment `isBaseChildRoute` match `isRecordRoute` derives
      // from, so — unlike that one — its position in this chain isn't
      // load-bearing. Kept next to the Base-level branch for readability.
      return (
        <RecordActivityView
          breadcrumb={activeBase?.name ?? messages.nav.base}
          orpc={orpc}
          recordId={recordActivityParams?.recordId ?? ""}
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
      if (shouldShowInitialLoadingState(activeRecord, fallbackRecordQuery.isLoading)) {
        return <NodeDetailSkeleton variant="doc" />;
      }
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
      if (shouldShowInitialLoadingState(activeRecord, fallbackRecordQuery.isLoading)) {
        return <NodeDetailSkeleton variant="doc" />;
      }
      return (
        <RecordDetailView
          baseSlug={activeBase?.slug ?? activeBase?.nodeId ?? activeBase?.id ?? ""}
          client={client}
          onDeleteChangeRequest={submitDeleteRecord}
          records={records}
          record={activeRecord}
        />
      );
    }

    if (locationPath.startsWith("/base/")) {
      const archivedMatch = selectedBaseSlug
        ? archivedBases.find(
            (b) =>
              b.id === selectedBaseSlug ||
              b.nodeId === selectedBaseSlug ||
              b.slug === selectedBaseSlug,
          )
        : null;
      // Cold cache / direct link: the base hasn't resolved yet and either list is
      // still loading — wait before falling back to an archived match so an
      // archived response that arrives first cannot flash Trash over a live Base.
      if (!activeBase && archivedBasesQuery.isFetching) {
        return <BaseTableSkeleton />;
      }
      if (!activeBase && archivedMatch) {
        return (
          <ArchivedBasesView archivedBases={[archivedMatch]} onRestoreBase={submitRestoreBase} />
        );
      }
      return (
        <BaseDetailView
          activeView={selectedBaseView}
          archivedViews={archivedViewsForBase}
          archivedRecords={archivedRecordsForBase}
          archivedPagination={archivedRecordsPagination}
          records={records}
          orderedRecords={usesPagePagination || serverSortedView ? baseRecords : undefined}
          orpc={orpc}
          pagination={recordsPagination}
          base={activeBase}
          onCreateView={submitCreateView}
          onDeleteView={submitDeleteView}
          onDeleteRecords={submitDeleteRecords}
          onRestoreView={submitRestoreView}
          onRestoreRecord={submitRestoreRecord}
          onMoveRecord={submitMoveRecord}
          onPatchRecord={submitPatchRecord}
          onUpdateView={submitUpdateView}
          views={views}
        />
      );
    }

    if (nodeActivityRoute) {
      return (
        <NodeActivityView
          breadcrumb={activeActivityNode?.name ?? nodeActivityRoute.type}
          nodeId={activeActivityNode?.id ?? ""}
          orpc={orpc}
        />
      );
    }

    // Node-detail routes resolve their view from the per-platform renderer registry
    // (each domain registers via registerNodeDetail) instead of a hardcoded branch.
    const activeNodeDetailRoute =
      nodeDetailRoute?.type === "airapp" && keepAirAppsMounted && nodeDetailRoute.slug
        ? null
        : nodeDetailRoute;
    if (activeNodeDetailRoute) {
      const RenderDetail = getNodeDetail(activeNodeDetailRoute.type);
      if (RenderDetail) {
        return (
          <RenderDetail
            key={`${activeNodeDetailRoute.type}:${activeNodeDetailRoute.slug}`}
            nodes={nodeTree}
            onNodeLoaded={recordLoadedNode}
            orpc={orpc}
            slug={activeNodeDetailRoute.slug}
          />
        );
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
    agentDetailParams,
    approveChangeRequest,
    closeChangeRequest,
    auditEvents,
    archivedBasesQuery.isFetching,
    archivedBasesQuery.isPending,
    archivedNodesQuery.isPending,
    bases,
    basesQuery.isFetching,
    client,
    emptyGuide,
    isAgentDetailRoute,
    isChangeRequestRoute,
    isEditRecordRoute,
    isGraphRoute,
    isOperationRoute,
    isRecordRoute,
    keepAirAppsMounted,
    messages,
    nodeTree,
    orpc,
    nodeDetailRoute,
    nodeActivityRoute,
    activeActivityNode,
    isBaseActivityRoute,
    isRecordActivityRoute,
    recordActivityParams,
    selectedBaseView,
    isNewRecordRoute,
    pendingReviewAction,
    isBatchPending,
    isChangeRequestsLoaded,
    runBatchReview,
    locationPath,
    inboxView,
    mergeChangeRequest,
    records,
    readOnlyChangeRequestPreview,
    refresh,
    rejectChangeRequest,
    isBaseSetupRoute,
    selectedChangeRequest,
    fallbackChangeRequestQuery.isLoading,
    fallbackRecordQuery.isLoading,
    operationParams,
    submitCreateRecord,
    submitCreateBaseField,
    submitCreateView,
    submitDeleteRecord,
    submitDeleteView,
    submitRestoreBase,
    submitRestoreNode,
    submitPurgeNode,
    submitPurgeBase,
    submitRestoreField,
    submitSetPrimaryField,
    submitRestoreView,
    submitRestoreRecord,
    submitMoveRecord,
    submitPatchRecord,
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
    recordLoadedNode,
    serverSortedView,
    usesPagePagination,
    baseRecords,
    submitDeleteRecords,
    allChangeRequests,
    nodeCache,
    openSearch,
    cacheSpaceKey,
    apiClient,
    agentIntegration,
    queryClient,
    isTemplateDetailRoute,
    templateDetailParams,
  ]);

  const dashboardActiveView = (
    <AirAppKeepAliveHost
      activeSlug={activeAirappSlug}
      enabled={keepAirAppsMounted}
      fallback={activeView}
      onNodeLoaded={recordLoadedNode}
      orpc={orpc}
      renderer={AirAppDetail}
      scopeKey={airAppKeepAliveScopeKey}
    />
  );

  // Chrome-free: no topbar, no side panel, no search dialog — just the current
  // node-detail pane (still preceded by the error banner, since that reflects
  // the current view's own state rather than app-wide navigation chrome).
  if (chromeless) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
        {error ? (
          isConflictErrorMessage(error) ? (
            <ReviewConflictPanel message={error} />
          ) : (
            <div className="border-rejected/35 border-b bg-rejected/17 px-4 py-2 text-rejected-strong text-sm">
              {error}
            </div>
          )
        ) : null}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-dashboard-active-view>
          {dashboardActiveView}
        </div>
      </div>
    );
  }

  const content = (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-4 py-1.5 backdrop-blur-sm md:h-12"
          data-dashboard-topbar
        >
          <SidebarTrigger className="h-8 w-8 shrink-0" />
          <BusabaseTopbarBreadcrumb items={breadcrumbItems} />
          {titlebar.badge ? <div className="ml-1 shrink-0">{titlebar.badge}</div> : null}
          {topbarActions ? <div className="shrink-0">{topbarActions}</div> : null}
          <TopbarNodeActionsSlot />
          <SidePanelToggle />
        </div>
        {error ? (
          isConflictErrorMessage(error) ? (
            <ReviewConflictPanel message={error} />
          ) : (
            <div className="border-rejected/35 border-b bg-rejected/17 px-4 py-2 text-rejected-strong text-sm">
              {error}
            </div>
          )
        ) : null}

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-dashboard-active-view>
          {dashboardActiveView}
        </div>
      </div>
      <SidePanel
        currentNode={sidePanelCurrentNode}
        nodeCache={nodeCache}
        onNavigate={setLocation}
        onOpenSearch={openSearchToPin}
        orpc={orpc}
      />
      <SearchDialog
        nodeCache={nodeCache}
        onClose={closeSearchAndClearMode}
        onSelect={
          searchPinsResult
            ? (result) => {
                // Content results (records, files, change requests) live inside
                // a node and carry no node type, so there is nothing to pin —
                // fall back to navigating rather than doing nothing.
                if (result.nodeType && isPinnableNode(result.nodeType)) {
                  pinNodeToSidePanel({
                    id: result.id,
                    type: result.nodeType,
                    name: result.title,
                  });
                  return;
                }
                setLocation(result.href);
              }
            : undefined
        }
        open={isSearchOpen}
        orpc={orpc}
      />
    </div>
  );

  if (embedded) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{content}</div>;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">{content}</main>
  );
}
