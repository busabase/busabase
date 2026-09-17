"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusabaseRestApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { BusabaseDashboard } from "busabase-core/dashboard";
import { CreateNodeModal } from "busabase-core/dashboard/create-node-modal";
import { EmptyAgentGuide } from "busabase-core/dashboard/empty-agent-guide";
import { InstallFromGithubModal } from "busabase-core/dashboard/install-from-github-modal";
import { BusabaseDashboardRouteRenderer } from "busabase-core/dashboard/route-renderer";
import { getBusabaseDashboardRoutes as getDashboardRoutes } from "busabase-core/dashboard/routes";
import { useNodeTree } from "busabase-core/dashboard/use-node-tree";
import { CoreI18nProvider } from "busabase-core/i18n";
import { Skeleton } from "kui/skeleton";
import { useRouter, useSearchParams } from "next/navigation";
import { detectBrowserLocale, type Locale } from "openlib/i18n";
import { addDemoParam, resolveDemoMode } from "openlib/ui/dashboard";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { BusabaseDashboardShell } from "~/components/dashboard/busabase-dashboard-shell";
import { DashboardNotFound } from "~/components/spa/not-found";

import { SPAWrapper } from "~/components/spa/spa-wrapper";
import { getSecondarySidebarNav } from "~/config/navigation-nested";
import { SUPPORTED_LOCALES } from "~/i18n/config";
import { buildDashboardUrl, getDashboardBasePath } from "~/lib/dashboard-routes";
import { getBusabaseAppLL, getBusabaseMessages, normalizeBusabaseAppLocale } from "~/lib/i18n";

interface DashboardClientProps {
  /** Server-resolved; see `dashboard-page.tsx`. */
  availableAirAppEngines?: AirAppRunnerKind[];
  initialPath?: string;
  localUserName?: string | null;
  chromeless?: boolean;
  readOnlyChangeRequestPreview?: boolean;
}

/**
 * React Query cache-key prefix shared by this client's own oRPC utils and
 * BusabaseDashboard's (`cacheSpaceKey`). Self-hosted Busabase serves exactly
 * one space, so the value is a constant — matching busabase-core's own default
 * — but both halves must derive from THIS constant, not each rely on a default.
 */
const CACHE_SPACE_KEY = "local";

/**
 * Desktop/open-source connection guidance: one local server, no OAuth, and a
 * single space — so there is no space id to pin the copied setup prompt to.
 * Mirrors the `BusabaseAgentSkillButton` props in the sidebar footer.
 */
const AGENT_INTEGRATION = {
  edition: "desktop",
  defaultOrigin: "http://localhost:15419",
} as const;

const INITIAL_SIDEBAR_NODE_ROWS = [
  { id: "initial-sidebar-node-1", width: "w-3/5" },
  { id: "initial-sidebar-node-2", width: "w-1/2" },
  { id: "initial-sidebar-node-3", width: "w-2/3" },
  { id: "initial-sidebar-node-4", width: "w-5/12" },
  { id: "initial-sidebar-node-5", width: "w-7/12" },
];

const DASHBOARD_SKELETON_ACTIVITY_ROWS = [
  "dashboard-activity-row-1",
  "dashboard-activity-row-2",
  "dashboard-activity-row-3",
] as const;

const isInboxLocation = (location: string): boolean =>
  /^\/inbox(?:\/|$)/.test(location.split("?")[0] ?? "");

function DashboardRouteObserver({
  onInboxRouteChange,
}: {
  onInboxRouteChange: (isInboxRoute: boolean) => void;
}) {
  const [location] = useLocation();
  const isInboxRoute = isInboxLocation(location);

  useEffect(() => {
    onInboxRouteChange(isInboxRoute);
  }, [isInboxRoute, onInboxRouteChange]);

  return null;
}

/**
 * Route-agnostic content placeholder shown inside the real dashboard shell
 * while its initial data is loading. It deliberately contains no nav rail: the
 * shared shell beside it already owns the sidebar and its Workspace skeleton.
 */
function DashboardContentSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-dashboard-content-loading
      aria-hidden
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-border/60 border-b px-4 md:h-12">
        <Skeleton className="size-5 shrink-0 rounded" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="ml-auto size-7 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <section>
            <Skeleton className="mb-2 h-3 w-28" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between gap-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="divide-y divide-border/50">
              {DASHBOARD_SKELETON_ACTIVITY_ROWS.map((id) => (
                <div className="flex h-10 items-center gap-3 px-1" key={id}>
                  <Skeleton className="size-2 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="ml-auto h-3 w-16" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Full-shell fallback used only before the SPA/dashboard shell itself mounts. */
function DashboardInitialShellSkeleton({ chromeless = false }: { chromeless?: boolean }) {
  if (chromeless) return <DashboardContentSkeleton />;

  return (
    <div className="flex min-h-0 flex-1" aria-hidden data-dashboard-initial-shell-loading>
      <aside className="hidden w-64 shrink-0 flex-col border-border/60 border-r bg-sidebar p-2 md:flex">
        <div className="flex h-12 items-center gap-2 px-2">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <div className="mt-1 space-y-1 px-2">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <div className="mt-3 px-2">
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="space-y-1">
            {INITIAL_SIDEBAR_NODE_ROWS.map((row) => (
              <div className="flex h-8 items-center gap-2 px-2" key={row.id}>
                <Skeleton className="size-4 shrink-0 rounded" />
                <Skeleton className={`h-3.5 ${row.width}`} />
              </div>
            ))}
          </div>
        </div>
      </aside>
      <DashboardContentSkeleton />
    </div>
  );
}

export function DashboardClient({
  initialPath = "/home",
  localUserName,
  availableAirAppEngines,
  chromeless,
  readOnlyChangeRequestPreview,
}: DashboardClientProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {/* useSearchParams (for ?chromeless=1) requires a Suspense boundary. */}
      <Suspense fallback={<DashboardInitialShellSkeleton chromeless={chromeless} />}>
        <DashboardClientContent
          availableAirAppEngines={availableAirAppEngines}
          initialPath={initialPath}
          localUserName={localUserName}
          chromeless={chromeless}
          readOnlyChangeRequestPreview={readOnlyChangeRequestPreview}
        />
      </Suspense>
    </QueryClientProvider>
  );
}

function DashboardClientContent({
  initialPath = "/home",
  localUserName,
  availableAirAppEngines,
  chromeless: chromelessOverride,
  readOnlyChangeRequestPreview = false,
}: DashboardClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // `initialPath` is available during SSR, so a direct Inbox load never mounts
  // the redundant counts request. DashboardRouteObserver runs inside Wouter's
  // SPAWrapper below and keeps this gate current for later client navigation.
  const [isInboxRoute, setIsInboxRoute] = useState(() => isInboxLocation(initialPath));
  // `?chromeless=1` renders just the current node's detail pane with no
  // sidebar/topbar — used by busabase-mobile's WebView embed of a single
  // AirApp's Run/Files/Logs UI (see BusabaseDashboard's `chromeless` prop).
  const searchParams = useSearchParams();
  const chromeless = chromelessOverride ?? searchParams.get("chromeless") === "1";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
  // Stable identity on purpose: this is handed to the memoized dashboard element
  // below, so a fresh arrow per render would rebuild the whole workbench tree.
  const openCreateNode = useCallback(() => {
    setCreateParent(null);
    setIsCreateOpen(true);
  }, []);
  const apiClient = useMemo(() => createBusabaseRestApiClient("/api/v1"), []);
  // The SAME key prefix BusabaseDashboard uses for its own queries (its
  // `cacheSpaceKey` prop, passed explicitly below so the two can't drift
  // again). This app is single-tenant, so the value is a constant — but it
  // still has to MATCH: React Query keys are compared structurally, and this
  // client used to build unprefixed `[["nodes","list"], …]` keys while the
  // dashboard invalidated prefixed `[["local","nodes","list"], …]` ones. Every
  // node invalidation the core fires — the live-sync SSE handler, the rename
  // dialog, a rich-node save — silently missed the very tree query the sidebar
  // and every node-detail view read from. busabase-cloud always passed its
  // space id to both; only this app had the halves out of step.
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc", {}, CACHE_SPACE_KEY), []);
  // Local single-tenant app: persist the chosen UI language preference in
  // localStorage. "auto" follows the demo dataset's ?lang (including its
  // English default) in demo mode, a valid ?lang for non-demo deep links, or
  // the browser language otherwise. A saved concrete choice always wins.
  // Hoisted above the node-tree wiring below (rather than its original spot
  // further down) only because `useNodeTree`'s `onMoveError` needs `LL` —
  // this block is otherwise self-contained and unrelated to `orpc`/nodes.
  const [languagePref, setLanguagePref] = useState("auto");
  const [detectedLocale, setDetectedLocale] = useState<string>("en");
  const appLocaleCodes = useMemo(() => [...SUPPORTED_LOCALES] as Locale[], []);
  useEffect(() => {
    const stored = window.localStorage.getItem("busabaseLocale");
    if (stored) {
      const normalizedStored =
        stored === "auto" ? "auto" : (normalizeBusabaseAppLocale(stored) ?? "auto");
      setLanguagePref(normalizedStored);
      if (normalizedStored !== stored) {
        window.localStorage.setItem("busabaseLocale", normalizedStored);
      }
    }
    setDetectedLocale(normalizeBusabaseAppLocale(detectBrowserLocale(appLocaleCodes)) ?? "en");
  }, [appLocaleCodes]);
  const demoMode = resolveDemoMode(searchParams);
  const locale =
    languagePref === "auto"
      ? ((demoMode.useCase
          ? demoMode.locale
          : normalizeBusabaseAppLocale(searchParams.get("lang") ?? undefined)) ?? detectedLocale)
      : (normalizeBusabaseAppLocale(languagePref) ?? "en");
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const LL = useMemo(() => getBusabaseAppLL(locale), [locale]);
  // The node tree — depth-bounded prefetch, per-folder lazy expansion, the
  // move/"Move to…" mutation, and the cycle-rejection check — is the SAME
  // wiring every hosted Busabase surface needs, so it lives in ONE shared hook
  // rather than being duplicated per host. No `initialData`: this app has no
  // SSR seed.
  const { nodes, loadingNodeIds, onExpandNode, checkIsDescendant, onMoveNode, nodesQuery } =
    useNodeTree({
      orpc,
      apiClient,
      queryClient,
      onMoveError: LL.shell.nodeMoveFailed(),
    });
  const basesQuery = useQuery(orpc.bases.list.queryOptions({ input: {} }));
  // ChangeRequest rows are route-owned inside BusabaseDashboard: Home uses
  // the cursor list, Inbox uses listPage, and detail uses get. The shell needs
  // only the whole-space review count for its badge.
  const changeRequestCountsQuery = useQuery({
    ...orpc.changeRequests.counts.queryOptions({}),
    enabled: !isInboxRoute,
  });
  const auditEventsQuery = useQuery(orpc.auditEvents.list.queryOptions({ input: {} }));
  const bases = basesQuery.data ?? [];
  const changeRequests = useMemo<never[]>(() => [], []);
  // The core dashboard loads records itself via records.list and ignores
  // this prop, so we don't fetch the whole records table just to hand it over.
  const records = useMemo<never[]>(() => [], []);
  const auditEvents = auditEventsQuery.data ?? [];
  const loadError = nodesQuery.error ?? basesQuery.error ?? auditEventsQuery.error;
  const isLoadingDashboardData =
    nodesQuery.isPending || basesQuery.isPending || auditEventsQuery.isPending;
  const coreMessages = useMemo(() => getBusabaseMessages(locale), [locale]);
  // RPC errors can contain unlocalized server messages. Surface one useful,
  // translated recovery message and retain the underlying error in the query.
  const loadErrorMessage = loadError ? LL.shell.failedToLoadDashboard() : null;
  const changeLocale = useCallback((next: string) => {
    setLanguagePref(next);
    window.localStorage.setItem("busabaseLocale", next);
  }, []);
  const dashboard = useMemo(
    () => (
      <BusabaseDashboard
        apiClient={apiClient}
        // Same guidance the sidebar's Agent Skills button gives, reused by the
        // install dialog's Agent install tab so both name one local endpoint.
        agentIntegration={AGENT_INTEGRATION}
        availableAirAppEngines={availableAirAppEngines}
        apiBasePath="/api/rpc"
        auditEvents={auditEvents}
        cacheSpaceKey={CACHE_SPACE_KEY}
        changeRequests={changeRequests}
        embedded
        chromeless={chromeless}
        emptyGuide={
          <EmptyAgentGuide edition="desktop" lang={locale} onCreateNode={openCreateNode} />
        }
        locale={locale}
        nodes={nodes}
        onCreateNode={openCreateNode}
        provideQueryClient={false}
        records={records}
        readOnlyChangeRequestPreview={readOnlyChangeRequestPreview}
        bases={bases}
        onSearchOpenChange={setIsSearchOpen}
        searchOpen={isSearchOpen}
      />
    ),
    [
      apiClient,
      auditEvents,
      changeRequests,
      records,
      bases,
      nodes,
      isSearchOpen,
      locale,
      chromeless,
      readOnlyChangeRequestPreview,
      availableAirAppEngines,
      openCreateNode,
    ],
  );
  const routes = useMemo(
    () => getDashboardRoutes(dashboard, coreMessages),
    [dashboard, coreMessages],
  );
  const secondaryNavConfig = useMemo(() => getSecondarySidebarNav(locale), [locale]);

  // Shared regardless of chrome mode: load error / loading skeleton / the
  // SPA-routed dashboard (every route pattern renders the same `dashboard`
  // element, which reads the current location itself).
  const routedContent = loadErrorMessage ? (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-destructive">
      {loadErrorMessage}
    </div>
  ) : isLoadingDashboardData ? (
    <DashboardContentSkeleton />
  ) : (
    <BusabaseDashboardRouteRenderer
      NotFoundComponent={DashboardNotFound}
      className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-200 motion-reduce:animate-none"
      routes={routes}
    />
  );

  return (
    <SPAWrapper
      basePath={getDashboardBasePath()}
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
      lockInitialPath={readOnlyChangeRequestPreview}
    >
      <DashboardRouteObserver onInboxRouteChange={setIsInboxRoute} />
      <CoreI18nProvider locale={locale}>
        {chromeless ? (
          // No sidebar, no topbar, no navigation — just the current node's
          // detail pane, full screen (busabase-mobile's WebView embed target).
          <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
            {routedContent}
          </div>
        ) : (
          <BusabaseDashboardShell
            // Same guidance the dashboard itself gets, so the sidebar row's
            // Agent prompts name the same local endpoint the node toolbars do.
            agentIntegration={AGENT_INTEGRATION}
            activeChangeRequestCount={
              changeRequestCountsQuery.isPending
                ? undefined
                : (changeRequestCountsQuery.data?.review ?? 0)
            }
            availableAirAppEngines={availableAirAppEngines}
            nodes={nodes}
            orpc={orpc}
            onSearchClick={() => setIsSearchOpen(true)}
            onCreateClick={(parent) => {
              setCreateParent(parent ?? null);
              setIsCreateOpen(true);
            }}
            // Single-tenant open-source app: there is no membership to check, and
            // busabase-core's own `isSpaceManager` seam defaults to "manager"
            // when a host leaves it unset — so the entry point is always offered
            // here. The cloud host is where the role gate actually bites.
            onInstallClick={() => setIsInstallOpen(true)}
            onMoveNode={onMoveNode}
            locale={locale}
            languagePref={languagePref}
            onLocaleChange={changeLocale}
            loadingNodeIds={loadingNodeIds}
            nodesLoading={nodesQuery.isPending}
            onExpandNode={onExpandNode}
            checkIsDescendant={checkIsDescendant}
          >
            {routedContent}
          </BusabaseDashboardShell>
        )}
        <CreateNodeModal
          agentIntegration={AGENT_INTEGRATION}
          apiClient={apiClient}
          open={isCreateOpen}
          orpc={orpc}
          parent={createParent}
          onOpenChange={(next) => {
            setIsCreateOpen(next);
            if (!next) {
              setCreateParent(null);
            }
          }}
          onCreated={(changeRequestId, mode) => {
            queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
            queryClient.invalidateQueries({ queryKey: orpc.bases.list.key() });
            queryClient.invalidateQueries({ queryKey: orpc.changeRequests.list.key() });
            queryClient.invalidateQueries({ queryKey: orpc.changeRequests.counts.key() });
            router.refresh();
            if (mode === "merged") {
              router.push(addDemoParam(buildDashboardUrl("/")));
            } else {
              router.push(addDemoParam(buildDashboardUrl(`/inbox/${changeRequestId}`)));
            }
          }}
        />
        <InstallFromGithubModal
          agentIntegration={AGENT_INTEGRATION}
          apiClient={apiClient}
          open={isInstallOpen}
          onOpenChange={setIsInstallOpen}
          onCreateNode={openCreateNode}
          // Structure (the folder, its Bases, fields and views) is materialized
          // immediately, so the tree has changed even when every record is still
          // pending review — reload rather than leave a stale sidebar.
          onInstalled={() => {
            router.refresh();
            window.location.assign(addDemoParam(buildDashboardUrl("/")));
          }}
          onReviewChangeRequests={() => {
            window.location.assign(addDemoParam(buildDashboardUrl("/inbox")));
          }}
        />
      </CoreI18nProvider>
    </SPAWrapper>
  );
}
