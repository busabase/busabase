"use client";

import type { ComponentType } from "react";
import { matchRoute, useLocation, useRouter } from "wouter";
import type { BusabaseRouteConfig } from "../routes";

interface BusabaseRouteRendererProps {
  routes: BusabaseRouteConfig[];
  NotFoundComponent: ComponentType;
  className?: string;
}

/**
 * Renders a `getBusabaseDashboardRoutes` table — and keeps the dashboard at a
 * STABLE position in the React tree while doing it.
 *
 * That stability is the whole point. Every entry in the table carries the same
 * `BusabaseDashboard` element (the dashboard reads the wouter location itself
 * to choose the active view), so crossing a route pattern must be a re-render,
 * not a remount. The obvious `<Switch><Route key={path}>…` spelling breaks that
 * silently: `<Switch>` emits a differently-keyed `<Route>` per pattern, so React
 * throws the whole subtree away and builds a new one on every navigation —
 * reloading AirApp iframes and tearing down the live SSE stream even though the
 * rendered element never changed.
 *
 * Matching by hand keeps `matchedRoute.component` at one position, which is what
 * lets React reconcile it. `routes.find` also preserves `<Switch>`'s
 * first-match-wins ordering.
 *
 * Note what this deliberately does NOT provide: wouter's `<Route>` param
 * context, so `useParams()` is unavailable to anything rendered here. Nothing in
 * the workbench uses it (the dashboard parses the location itself), but a route
 * table whose entries render DIFFERENT per-route components — busabase-cloud's
 * systemadmin panel, say — genuinely wants `<Route>` and should keep using a
 * `<Switch>`-based renderer instead of this one.
 */
export function BusabaseDashboardRouteRenderer({
  className = "flex min-h-0 flex-1 flex-col",
  NotFoundComponent,
  routes,
}: BusabaseRouteRendererProps) {
  const [location] = useLocation();
  const router = useRouter();
  const matchedRoute = routes.find((route) => matchRoute(router.parser, route.path, location)[0]);

  return (
    <div className={className}>{matchedRoute ? matchedRoute.component : <NotFoundComponent />}</div>
  );
}
