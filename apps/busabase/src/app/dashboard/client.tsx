"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createBusabaseRestApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { BusabaseDashboard } from "busabase-core/dashboard";
import { CreateNodeModal } from "busabase-core/dashboard/create-node-modal";
import { EmptyAgentGuide } from "busabase-core/dashboard/empty-agent-guide";
import { getBusabaseDashboardRoutes as getDashboardRoutes } from "busabase-core/dashboard/routes";
import { CoreI18nProvider, type CoreLocale, coreMessagesByLocale } from "busabase-core/i18n";
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
  const nodesQuery = useQuery(orpc.nodes.list.queryOptions({}));
  const basesQuery = useQuery(orpc.bases.list.queryOptions({}));
  const changeRequestsQuery = useQuery(orpc.changeRequests.list.queryOptions({ input: {} }));
  const auditEventsQuery = useQuery(orpc.auditEvents.list.queryOptions({ input: {} }));
  const nodes = nodesQuery.data ?? [];
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
              {LL.shell.loadingDashboard()}
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
      </CoreI18nProvider>
    </SPAWrapper>
  );
}
