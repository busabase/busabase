"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { createContext, type ReactNode, useContext } from "react";

/**
 * The dashboard's oRPC query utils, reachable from deep leaf components.
 *
 * Everything in this package takes `orpc` as a prop, and that stays the norm —
 * it makes a component's data dependencies visible in its signature. This
 * context exists for the one shape where props do not work: an action that
 * hangs off a node's toolbar, reached through half a dozen renderers
 * (`node-detail-views` → `NodeAgentPromptsButton` → `NodeAgentPromptsDialog`,
 * plus the sidebar row's own copy in `dashboard-shell`), none of which have any
 * other reason to know about the API. Threading `orpc` through all of them to
 * reach one dialog would put a prop on nine components to serve one.
 *
 * Deliberately optional (`undefined` by default): a host that never wired
 * `orpc` — the mobile WebView's chromeless render, an SSR pass — gets the same
 * graceful degradation the shell's other orpc-gated actions already use, where
 * the action is simply not offered rather than the page failing.
 */
const DashboardOrpcContext = createContext<BusabaseQueryUtils | undefined>(undefined);

export function DashboardOrpcProvider({
  children,
  orpc,
}: {
  children: ReactNode;
  orpc?: BusabaseQueryUtils;
}) {
  return <DashboardOrpcContext.Provider value={orpc}>{children}</DashboardOrpcContext.Provider>;
}

/** The active query utils, or `undefined` when no host wired them. */
export const useDashboardOrpc = (): BusabaseQueryUtils | undefined =>
  useContext(DashboardOrpcContext);
