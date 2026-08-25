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
import { addDemoParam } from "openlib/ui/dashboard";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
 *
 * `chromeless` (the WebView embed path) omits the fake nav rail entirely —
 * showing a sidebar-shaped skeleton, even a fake one, would violate the "no
 * sidebar at all" contract while the real content is still loading.
 */
function DashboardShellSkeleton({ chromeless = false }: { chromeless?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1" aria-hidden>
      {chromeless ? null : (
        <div className="hidden w-56 shrink-0 flex-col gap-1.5 border-border/60 border-r p-3 md:flex">
          {DASHBOARD_SKELETON_NAV_ITEMS.map((item) => (
            <div className="flex items-center gap-2 px-1 py-1.5" key={item.id}>
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className="h-3.5" style={{ width: item.width }} />
            </div>
          ))}
        </div>
      )}
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
      <Suspense fallback={<DashboardShellSkeleton chromeless={chromeless} />}>
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
  // `?chromeless=1` renders just the current node's detail pane with no
  // sidebar/topbar — used by busabase-mobile's WebView embed of a single
  // AirApp's Run/Files/Logs UI (see BusabaseDashboard's `chromeless` prop).
  const searchParams = useSearchParams();
  const chromeless = chromelessOverride ?? searchParams.get("chromeless") === "1";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
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
  // localStorage. The default is "auto" — follow the browser language, the same
  // way Busabase Cloud does via `detectBrowserLocale`. A concrete choice
  // (e.g. "zh-CN") overrides it. The cloud app injects its `[lang]` locale instead.
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
  const locale =
    languagePref === "auto" ? detectedLocale : (normalizeBusabaseAppLocale(languagePref) ?? "en");
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
  const changeRequestCountsQuery = useQuery(orpc.changeRequests.counts.queryOptions({}));
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
        emptyGuide={<EmptyAgentGuide edition="desktop" lang={locale} />}
        locale={locale}
        nodes={nodes}
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
    <DashboardShellSkeleton chromeless={chromeless} />
  ) : (
    <BusabaseDashboardRouteRenderer
      NotFoundComponent={DashboardNotFound}
      className="flex min-h-0 flex-1 flex-col"
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
      <CoreI18nProvider locale={locale}>
        {chromeless ? (
          // No sidebar, no topbar, no navigation — just the current node's
          // detail pane, full screen (busabase-mobile's WebView embed target).
          <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
            {routedContent}
          </div>
        ) : (
          <BusabaseDashboardShell
            activeChangeRequestCount={changeRequestCountsQuery.data?.review ?? 0}
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
            onExpandNode={onExpandNode}
            checkIsDescendant={checkIsDescendant}
          >
            {routedContent}
          </BusabaseDashboardShell>
        )}
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
