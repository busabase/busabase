"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createBusabaseRestApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { BusabaseDashboard } from "busabase-core/dashboard";
import { CreateNodeModal } from "busabase-core/dashboard/create-node-modal";
import { EmptyAgentGuide } from "busabase-core/dashboard/empty-agent-guide";
import { getBusabaseDashboardRoutes as getDashboardRoutes } from "busabase-core/dashboard/routes";
import { coreLocaleOptions } from "busabase-core/i18n";
import { useRouter } from "next/navigation";
import { detectBrowserLocale, type Locale } from "openlib/i18n";
import { addDemoParam } from "openlib/ui/dashboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProductReadyDashboardShell } from "~/components/dashboard/productready-dashboard-shell";
import { DashboardNotFound } from "~/components/spa/not-found";
import { SPARouteRenderer } from "~/components/spa/spa-route-renderer";
import { SPAWrapper } from "~/components/spa/spa-wrapper";
import { getSecondarySidebarNav } from "~/config/navigation-nested";

interface DashboardClientProps {
  initialPath?: string;
}

export function DashboardClient({ initialPath = "/inbox" }: DashboardClientProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardClientContent initialPath={initialPath} />
    </QueryClientProvider>
  );
}

function DashboardClientContent({ initialPath = "/inbox" }: DashboardClientProps) {
  const router = useRouter();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
  const apiClient = useMemo(() => createBusabaseRestApiClient("/api/v1"), []);
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const nodesQuery = useQuery(orpc.nodes.list.queryOptions({}));
  const basesQuery = useQuery(orpc.bases.list.queryOptions({}));
  const changeRequestsQuery = useQuery(orpc.changeRequests.list.queryOptions({ input: {} }));
  const recordsQuery = useQuery(orpc.records.list.queryOptions({ input: {} }));
  const auditEventsQuery = useQuery(orpc.auditEvents.list.queryOptions({ input: {} }));
  const nodes = nodesQuery.data ?? [];
  const bases = basesQuery.data ?? [];
  const changeRequests = changeRequestsQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const auditEvents = auditEventsQuery.data ?? [];
  const loadError =
    nodesQuery.error ??
    basesQuery.error ??
    changeRequestsQuery.error ??
    recordsQuery.error ??
    auditEventsQuery.error;
  const loadErrorMessage = loadError
    ? loadError instanceof Error
      ? loadError.message
      : "Failed to load dashboard data"
    : null;
  const isLoadingDashboardData =
    nodesQuery.isPending ||
    basesQuery.isPending ||
    changeRequestsQuery.isPending ||
    recordsQuery.isPending ||
    auditEventsQuery.isPending;
  // Local single-tenant app: persist the chosen UI language preference in
  // localStorage. The default is "auto" — follow the browser language, the same
  // way apps/busabase-cloud does via `detectBrowserLocale`. A concrete choice
  // (e.g. "zh-CN") overrides it. The cloud app injects its `[lang]` locale instead.
  const [languagePref, setLanguagePref] = useState("auto");
  const [detectedLocale, setDetectedLocale] = useState<string>("en");
  const coreLocaleCodes = useMemo(
    () => coreLocaleOptions.map((option) => option.code) as Locale[],
    [],
  );
  useEffect(() => {
    const stored = window.localStorage.getItem("busabaseLocale");
    if (stored) {
      setLanguagePref(stored);
    }
    setDetectedLocale(detectBrowserLocale(coreLocaleCodes));
  }, [coreLocaleCodes]);
  const locale = languagePref === "auto" ? detectedLocale : languagePref;
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
  const routes = useMemo(() => getDashboardRoutes(dashboard), [dashboard]);
  const secondaryNavConfig = useMemo(() => getSecondarySidebarNav(), []);

  return (
    <SPAWrapper
      basePath="/dashboard"
      context={{ locale, secondaryNavConfig }}
      initialPath={initialPath}
    >
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
        locale={locale}
        languagePref={languagePref}
        onLocaleChange={changeLocale}
      >
        {loadErrorMessage ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-destructive">
            {loadErrorMessage}
          </div>
        ) : isLoadingDashboardData ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Loading dashboard...
          </div>
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
    </SPAWrapper>
  );
}
