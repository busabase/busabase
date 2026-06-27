import type { ReactNode } from "react";
import { listNodeTypes } from "../registry";

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
export const getBusabaseDashboardRoutes = (dashboard: ReactNode): BusabaseRouteConfig[] => {
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
    { path: "/", component: dashboard, breadcrumb: "Inbox", title: "Inbox" },
    { path: "/inbox", component: dashboard, breadcrumb: "Inbox", title: "Inbox" },
    {
      path: "/inbox/:changeRequestId/:operationId",
      component: dashboard,
      breadcrumb: "Operation",
      title: "Operation",
    },
    {
      path: "/inbox/:changeRequestId",
      component: dashboard,
      breadcrumb: "Change Request",
      title: "Change Request",
    },
    { path: "/activity", component: dashboard, breadcrumb: "Activity", title: "Activity" },
    { path: "/graph", component: dashboard, breadcrumb: "Graph", title: "Graph" },
    { path: "/assets", component: dashboard, breadcrumb: "Assets", title: "Assets" },
    {
      path: "/assets/:assetId",
      component: dashboard,
      breadcrumb: "Asset",
      title: "Asset",
    },
    ...detailTypeRoutes,
    { path: "/base/:slug", component: dashboard, breadcrumb: "Base", title: "Base" },
    {
      path: "/base/:slug/design",
      component: dashboard,
      breadcrumb: "Base Design",
      title: "Base Design",
    },
    {
      path: "/base/:slug/setup",
      component: dashboard,
      breadcrumb: "Base Design",
      title: "Base Design",
    },
    {
      path: "/base/:slug/new",
      component: dashboard,
      breadcrumb: "New Record",
      title: "New Record",
    },
    { path: "/base/:slug/:viewId", component: dashboard, breadcrumb: "View", title: "View" },
    {
      path: "/base/:slug/:recordId/edit",
      component: dashboard,
      breadcrumb: "Edit Record",
      title: "Edit Record",
    },
    { path: "/base/:slug/:recordId", component: dashboard, breadcrumb: "Record", title: "Record" },
  ];
};
