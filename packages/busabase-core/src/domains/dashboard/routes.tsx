import { listNodeTypes } from "busabase-contract/domains";
import type { ReactNode } from "react";
import type { CoreI18nMessages } from "../../i18n";

/** A wouter route for the workbench SPA (path → element, with breadcrumb/title). */
export interface BusabaseRouteConfig {
  path: string;
  component: ReactNode;
  breadcrumb: string;
  title?: string;
}

/**
 * Workbench SPA routes — every path renders the SAME `BusabaseDashboard` element,
 * which reads the wouter location to pick the active view (inbox / base / record
 * / skill / doc …). Shared by every Busabase host (open-source `apps/busabase` + cloud
 * `busabase-dashboard`); the host's `SPARouteRenderer` consumes the result.
 */
export const getBusabaseDashboardRoutes = (
  dashboard: ReactNode,
  messages?: CoreI18nMessages,
): BusabaseRouteConfig[] => {
  // Detail routes for simple node types (skill, doc, …) come from the node-type
  // registry: any `hasDetail` type gets `/{type}/:slug`. `base` is excluded — it
  // owns the bespoke sub-routes (design / new / view / record) below.
  const detailTypeRoutes: BusabaseRouteConfig[] = listNodeTypes()
    .filter((nodeType) => nodeType.capabilities.hasDetail && nodeType.type !== "base")
    .map((nodeType) => ({
      path: `/${nodeType.type}/:slug`,
      component: dashboard,
      breadcrumb: nodeType.label,
      title: nodeType.label,
    }));

  return [
    {
      path: "/",
      component: dashboard,
      breadcrumb: messages?.routes.inbox ?? "Inbox",
      title: messages?.routes.inbox ?? "Inbox",
    },
    {
      path: "/inbox",
      component: dashboard,
      breadcrumb: messages?.routes.inbox ?? "Inbox",
      title: messages?.routes.inbox ?? "Inbox",
    },
    {
      path: "/inbox/:changeRequestId/:operationId",
      component: dashboard,
      breadcrumb: messages?.routes.operation ?? "Operation",
      title: messages?.routes.operation ?? "Operation",
    },
    {
      path: "/inbox/:changeRequestId",
      component: dashboard,
      breadcrumb: messages?.routes.changeRequest ?? "Change Request",
      title: messages?.routes.changeRequest ?? "Change Request",
    },
    {
      path: "/activity",
      component: dashboard,
      breadcrumb: messages?.routes.activity ?? "Activity",
      title: messages?.routes.activity ?? "Activity",
    },
    {
      path: "/archived",
      component: dashboard,
      breadcrumb: messages?.common.archived ?? "Archived",
      title: messages?.routes.archived ?? "Archived Bases",
    },
    {
      path: "/graph",
      component: dashboard,
      breadcrumb: messages?.routes.graph ?? "Graph",
      title: messages?.routes.graph ?? "Graph",
    },
    {
      path: "/assets",
      component: dashboard,
      breadcrumb: messages?.routes.assets ?? "Assets",
      title: messages?.routes.assets ?? "Assets",
    },
    {
      path: "/assets/:assetId",
      component: dashboard,
      breadcrumb: messages?.routes.asset ?? "Asset",
      title: messages?.routes.asset ?? "Asset",
    },
    ...detailTypeRoutes,
    {
      path: "/base/:slug",
      component: dashboard,
      breadcrumb: messages?.routes.base ?? "Base",
      title: messages?.routes.base ?? "Base",
    },
    {
      path: "/base/:slug/design",
      component: dashboard,
      breadcrumb: messages?.routes.baseDesign ?? "Base Design",
      title: messages?.routes.baseDesign ?? "Base Design",
    },
    {
      path: "/base/:slug/setup",
      component: dashboard,
      breadcrumb: messages?.routes.baseDesign ?? "Base Design",
      title: messages?.routes.baseDesign ?? "Base Design",
    },
    {
      path: "/base/:slug/new",
      component: dashboard,
      breadcrumb: messages?.routes.newRecord ?? "New Record",
      title: messages?.routes.newRecord ?? "New Record",
    },
    {
      path: "/base/:slug/:viewId",
      component: dashboard,
      breadcrumb: messages?.routes.view ?? "View",
      title: messages?.routes.view ?? "View",
    },
    {
      path: "/base/:slug/:recordId/edit",
      component: dashboard,
      breadcrumb: messages?.routes.editRecord ?? "Edit Record",
      title: messages?.routes.editRecord ?? "Edit Record",
    },
    {
      path: "/base/:slug/:recordId",
      component: dashboard,
      breadcrumb: messages?.routes.record ?? "Record",
      title: messages?.routes.record ?? "Record",
    },
  ];
};
