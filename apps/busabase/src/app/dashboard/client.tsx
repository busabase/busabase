"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusabaseRestApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { BusabaseDashboard } from "busabase-core/dashboard";
import { CreateNodeModal } from "busabase-core/dashboard/create-node-modal";
import { EmptyAgentGuide } from "busabase-core/dashboard/empty-agent-guide";
import { getBusabaseDashboardRoutes as getDashboardRoutes } from "busabase-core/dashboard/routes";
import { useLazyNodeChildren } from "busabase-core/dashboard/use-lazy-node-children";
import { useMoveNode } from "busabase-core/dashboard/use-move-node";
import { CoreI18nProvider, type CoreLocale, coreMessagesByLocale } from "busabase-core/i18n";
import { Skeleton } from "kui/skeleton";
import { useRouter } from "next/navigation";
import { detectBrowserLocale, type Locale } from "openlib/i18n";
import { addDemoParam } from "openlib/ui/dashboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProductReadyDashboardShell } from "~/components/dashboard/productready-dashboard-shell";
import { DashboardNotFound } from "~/components/spa/not-found";
import { SPARouteRenderer } from "~/components/spa/spa-route-renderer";
import { SPAWrapper } from "~/components/spa/spa-wrapper";
import { getSecondarySidebarNav } from "~/config/navigation-nested";
import { SUPPORTED_LOCALES } from "~/i18n/config";
import { getBusabaseAppLL } from "~/lib/i18n";

interface DashboardClientProps {
  initialPath?: string;
  localUserName?: string | null;
}

const DASHBOARD_SKELETON_NAV_ITEMS = [
  { id: "shell-nav-1", width: "70%" },
  { id: "shell-nav-2", width: "55%" },
  { id: "shell-nav-3", width: "62%" },
  { id: "shell-nav-4", width: "48%" },
  { id: "shell-nav-5", width: "66%" },
];

const DASHBOARD_SKELETON_CONTENT_ROWS = [
  "shell-content-row-1",
  "shell-content-row-2",
  "shell-content-row-3",
  "shell-content-row-4",
];

/**
 * Placeholder shown while the four parallel queries that seed the whole
 * workbench (nodes/bases/changeRequests/auditEvents) are still in flight —
 * before `SPARouteRenderer` has anything to render. Every route renders the
 * same `BusabaseDashboard` element (see busabase-core's routes.tsx), so this
 * can't know which specific view (inbox/base/node) will land; it approximates
 * the shared shell shape instead — a nav rail plus a content pane — so the
 * switch from this to the real layout doesn't jump.
 */
function DashboardShellSkeleton() {
  return (
    <div className="flex min-h-0 flex-1" aria-hidden>
      <div className="hidden w-56 shrink-0 flex-col gap-1.5 border-border/60 border-r p-3 md:flex">
        {DASHBOARD_SKELETON_NAV_ITEMS.map((item) => (
          <div className="flex items-center gap-2 px-1 py-1.5" key={item.id}>
            <Skeleton className="size-4 shrink-0 rounded" />
            <Skeleton className="h-3.5" style={{ width: item.width }} />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-6 space-y-3">
          {DASHBOARD_SKELETON_CONTENT_ROWS.map((id) => (
            <Skeleton className="h-16 w-full rounded-lg" key={id} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardClient({ initialPath = "/inbox", localUserName }: DashboardClientProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardClientContent initialPath={initialPath} localUserName={localUserName} />
    </QueryClientProvider>
  );
}

function DashboardClientContent({ initialPath = "/inbox", localUserName }: DashboardClientProps) {
  const router = useRouter();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
  const apiClient = useMemo(() => createBusabaseRestApiClient("/api/v1"), []);
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const queryClient = useQueryClient();
  // Depth-bounded eager prefetch: root + 2 levels beneath it, matching the
  // server's own default (see DEFAULT_NODE_LIST_DEPTH in
  // packages/busabase-core/src/logic/nodes.ts). Anything deeper is loaded
  // lazily per-folder via `useLazyNodeChildren` below, on first expand.
  const nodesListInput = useMemo(() => ({ parentId: null as string | null, depth: 2 }), []);
  const nodesQuery = useQuery(orpc.nodes.list.queryOptions({ input: nodesListInput }));
  // EXACT key of the root query above — required for useMoveNode's
  // optimistic get/setQueryData (which need an exact cache-entry match, not
  // a partial one). `nodesInvalidateQueryKey` below is deliberately the
  // BROADER `{}` (no input) key instead, so a move invalidates every
  // `nodes.list` variant — the root tree AND every lazily-fetched folder —
  // in one call; see the comment on `useMoveNode`'s `invalidateQueryKey`.
  const nodesQueryKey = orpc.nodes.list.queryOptions({ input: nodesListInput }).queryKey;
  const nodesInvalidateQueryKey = orpc.nodes.list.queryOptions({}).queryKey;
  const baseNodes = nodesQuery.data ?? [];
  const { nodes, loadingNodeIds, onExpandNode } = useLazyNodeChildren({ orpc, baseNodes });
  const checkIsDescendant = useCallback(
    async (params: { nodeId: string; potentialAncestorId: string }) => {
      const result = await orpc.nodes.isDescendant.call(params);
      return result.isDescendant;
    },
    [orpc],
  );
  const basesQuery = useQuery(orpc.bases.list.queryOptions({}));
  const changeRequestsQuery = useQuery(orpc.changeRequests.list.queryOptions({ input: {} }));
  const auditEventsQuery = useQuery(orpc.auditEvents.list.queryOptions({ input: {} }));
  const bases = basesQuery.data ?? [];
  const changeRequests = changeRequestsQuery.data ?? [];
  // The core dashboard loads records itself via records.listPaged and ignores
  // this prop, so we don't fetch the whole records table just to hand it over.
  const records = useMemo<never[]>(() => [], []);
  const auditEvents = auditEventsQuery.data ?? [];
  const loadError =
    nodesQuery.error ?? basesQuery.error ?? changeRequestsQuery.error ?? auditEventsQuery.error;
  const isLoadingDashboardData =
    nodesQuery.isPending ||
    basesQuery.isPending ||
    changeRequestsQuery.isPending ||
    auditEventsQuery.isPending;
  // Local single-tenant app: persist the chosen UI language preference in
  // localStorage. The default is "auto" — follow the browser language, the same
  // way apps/busabase-cloud does via `detectBrowserLocale`. A concrete choice
  // (e.g. "zh-CN") overrides it. The cloud app injects its `[lang]` locale instead.
  const [languagePref, setLanguagePref] = useState("auto");
  const [detectedLocale, setDetectedLocale] = useState<string>("en");
  const appLocaleCodes = useMemo(() => [...SUPPORTED_LOCALES] as Locale[], []);
  useEffect(() => {
    const stored = window.localStorage.getItem("busabaseLocale");
    if (stored) {
      setLanguagePref(stored);
    }
    setDetectedLocale(detectBrowserLocale(appLocaleCodes));
  }, [appLocaleCodes]);
  const locale = languagePref === "auto" ? detectedLocale : languagePref;
  const LL = useMemo(() => getBusabaseAppLL(locale), [locale]);
  const moveNodeMutation = useMoveNode({
    apiClient,
    queryClient,
    nodesQueryKey,
    invalidateQueryKey: nodesInvalidateQueryKey,
    onMoveError: LL.shell.nodeMoveFailed(),
  });
  const coreMessages = useMemo(
    () => coreMessagesByLocale[(locale in coreMessagesByLocale ? locale : "en") as CoreLocale],
    [locale],
  );
  const loadErrorMessage = loadError
    ? loadError instanceof Error
      ? loadError.message
      : LL.shell.failedToLoadDashboard()
    : null;
  const changeLocale = useCallback((next: string) => {
    setLanguagePref(next);
    window.localStorage.setItem("busabaseLocale", next);
  }, []);
  const dashboard = useMemo(
    () => (
      <BusabaseDashboard
        apiClient={apiClient}
        apiBasePath="/api/rpc"
        auditEvents={auditEvents}
        changeRequests={changeRequests}
        embedded
        emptyGuide={<EmptyAgentGuide lang={locale} />}
        locale={locale}
        nodes={nodes}
        provideQueryClient={false}
        records={records}
        bases={bases}
        onSearchOpenChange={setIsSearchOpen}
        searchOpen={isSearchOpen}
      />
    ),
    [apiClient, auditEvents, changeRequests, records, bases, nodes, isSearchOpen, locale],
  );
  const routes = useMemo(
    () => getDashboardRoutes(dashboard, coreMessages),
    [dashboard, coreMessages],
  );
  const secondaryNavConfig = useMemo(() => getSecondarySidebarNav(locale), [locale]);

  return (
    <SPAWrapper
      basePath="/dashboard"
      context={{
        activeSpace: {
          id: "local",
          name: LL.shell.localSpaceName(),
          slug: "local",
        },
        locale,
        secondaryNavConfig,
        spaces: [
          {
            id: "local",
            name: LL.shell.localSpaceName(),
            slug: "local",
          },
        ],
        user: {
          avatar: localUserName ? localUserName.slice(0, 2).toUpperCase() : "LR",
          email: "local@busabase.dev",
          id: "local-admin",
          name: localUserName ?? LL.shell.localReviewerName(),
        },
      }}
      initialPath={initialPath}
    >
      <CoreI18nProvider locale={locale}>
        <ProductReadyDashboardShell
          activeChangeRequestCount={
            changeRequests.filter((changeRequest) => changeRequest.status === "in_review").length
          }
          nodes={nodes}
          onSearchClick={() => setIsSearchOpen(true)}
          onCreateClick={(parent) => {
            setCreateParent(parent ?? null);
            setIsCreateOpen(true);
          }}
          onMoveNode={(payload) => moveNodeMutation.mutate(payload)}
          locale={locale}
          languagePref={languagePref}
          onLocaleChange={changeLocale}
          loadingNodeIds={loadingNodeIds}
          onExpandNode={onExpandNode}
          checkIsDescendant={checkIsDescendant}
        >
          {loadErrorMessage ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-destructive">
              {loadErrorMessage}
            </div>
          ) : isLoadingDashboardData ? (
            <DashboardShellSkeleton />
          ) : (
            <SPARouteRenderer
              NotFoundComponent={DashboardNotFound}
              className="flex min-h-0 flex-1 flex-col"
              routes={routes}
            />
          )}
        </ProductReadyDashboardShell>
        <CreateNodeModal
          apiClient={apiClient}
          open={isCreateOpen}
          parent={createParent}
          onOpenChange={(next) => {
            setIsCreateOpen(next);
            if (!next) {
              setCreateParent(null);
            }
          }}
          onCreated={(changeRequestId, mode) => {
            router.refresh();
            if (mode === "merged") {
              window.location.assign(addDemoParam("/dashboard"));
            } else {
              window.location.assign(addDemoParam(`/dashboard/inbox/${changeRequestId}`));
            }
          }}
        />
      </CoreI18nProvider>
    </SPAWrapper>
  );
}
