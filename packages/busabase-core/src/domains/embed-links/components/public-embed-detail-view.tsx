"use client";

import type { ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { type ComponentProps, useMemo } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { BusabaseDashboard } from "../../dashboard";
import { BusabaseDashboardRouteRenderer } from "../../dashboard/components/dashboard-route-renderer";
import { getBusabaseDashboardRoutes } from "../../dashboard/routes";

const EMPTY: never[] = [];

export type PublicEmbedDetail =
  | { type: "change-request"; changeRequest: ChangeRequestVO }
  | { type: "record-detail"; record: RecordVO };

export interface PublicEmbedDetailHostProps {
  embed: PublicEmbedDetail;
  spaceId: string;
}

export interface PublicEmbedDetailViewProps extends PublicEmbedDetailHostProps {
  apiBasePath?: string;
  apiClientOptions?: ComponentProps<typeof BusabaseDashboard>["apiClientOptions"];
  locale?: string;
  provideQueryClient?: boolean;
}

export function PublicEmbedDetailView({
  apiBasePath = "/api/rpc",
  apiClientOptions,
  embed,
  locale,
  provideQueryClient = true,
  spaceId,
}: PublicEmbedDetailViewProps) {
  const changeRequest = embed.type === "change-request" ? embed.changeRequest : null;
  const record = embed.type === "record-detail" ? embed.record : null;
  const initialPath = changeRequest
    ? `/inbox/${changeRequest.id}`
    : `/base/${record?.base.slug ?? record?.base.nodeId ?? record?.base.id}/${record?.id}`;
  const dashboard = useMemo(
    () => (
      <BusabaseDashboard
        apiBasePath={apiBasePath}
        apiClientOptions={apiClientOptions}
        auditEvents={EMPTY}
        bases={changeRequest?.base ? [changeRequest.base] : record ? [record.base] : EMPTY}
        cacheSpaceKey={spaceId}
        changeRequests={changeRequest ? [changeRequest] : EMPTY}
        chromeless
        embedded
        nodes={EMPTY}
        currentUserId={null}
        locale={locale}
        provideQueryClient={provideQueryClient}
        records={record ? [record] : EMPTY}
        views={EMPTY}
        visitorKind="anonymous"
        readOnlyChangeRequestPreview={Boolean(changeRequest)}
        readOnlyRecordPreview={Boolean(record)}
      />
    ),
    [apiBasePath, apiClientOptions, changeRequest, locale, provideQueryClient, record, spaceId],
  );
  const routes = useMemo(() => getBusabaseDashboardRoutes(dashboard), [dashboard]);
  const lockedLocation = useMemo(
    () => memoryLocation({ path: initialPath, static: true }),
    [initialPath],
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <Router
        hook={lockedLocation.hook}
        searchHook={lockedLocation.searchHook}
        ssrPath={initialPath}
      >
        <BusabaseDashboardRouteRenderer
          NotFoundComponent={() => null}
          className="flex min-h-0 flex-1 flex-col"
          routes={routes}
        />
      </Router>
    </div>
  );
}
