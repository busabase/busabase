"use client";

import type { BusabaseRouteConfig as RouteConfig } from "busabase-core/dashboard/routes";
import type { ComponentType } from "react";
import { Route, Switch } from "wouter";

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
  return (
    <div className={className}>
      <Switch>
        {routes.map((route) => (
          <Route key={route.path} path={route.path}>
            {route.component}
          </Route>
        ))}
        <Route>
          <NotFoundComponent />
        </Route>
      </Switch>
    </div>
  );
}
