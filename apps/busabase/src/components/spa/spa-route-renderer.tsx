"use client";

import type { BusabaseRouteConfig as RouteConfig } from "busabase-core/dashboard/routes";
import type { ComponentType } from "react";
import { matchRoute, useLocation, useRouter } from "wouter";

interface SPARouteRendererProps {
  routes: RouteConfig[];
  NotFoundComponent: ComponentType;
  className?: string;
}

export function SPARouteRenderer({
  className = "min-h-screen",
  NotFoundComponent,
  routes,
}: SPARouteRendererProps) {
  const [location] = useLocation();
  const router = useRouter();
  const matchedRoute = routes.find((route) => matchRoute(router.parser, route.path, location)[0]);

  return (
    <div className={className}>{matchedRoute ? matchedRoute.component : <NotFoundComponent />}</div>
  );
}
