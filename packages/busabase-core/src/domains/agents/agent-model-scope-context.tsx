"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * Who/where an agent conversation is running for, independent of any single
 * component's props — the piece `agentModelCatalogScope()` needs that neither
 * `AgentDetailView` (full page) nor `AgentChatSidePanelTab` (via the generic,
 * tab-type-agnostic `SidePanelTabProps`) currently receive.
 *
 * Provided once at the dashboard root, where `cacheSpaceKey`/`currentUserId`
 * already live (see `BusabaseDashboardContent`), and read by both call sites
 * instead of growing `SidePanelTabProps` with fields every OTHER registered
 * tab type (record/doc/base preview) would have to ignore.
 */
export interface AgentModelScope {
  /** Normalized host/origin, so a locally-run and a cloud-hosted instance never share a cache. */
  host: string;
  /** The active workspace/space — mirrors `cacheSpaceKey`. */
  workspaceKey: string;
  /** The signed-in actor, or `"anonymous"` — mirrors `knownNodeCacheScope`'s fallback. */
  actorId: string;
}

const DEFAULT_SCOPE: AgentModelScope = {
  host: "local",
  workspaceKey: "local",
  actorId: "anonymous",
};

const AgentModelScopeContext = createContext<AgentModelScope>(DEFAULT_SCOPE);

export function AgentModelScopeProvider({
  children,
  workspaceKey,
  actorId,
}: {
  children: ReactNode;
  workspaceKey: string;
  actorId?: string | null;
}) {
  const value = useMemo<AgentModelScope>(
    () => ({
      host: typeof window === "undefined" ? "ssr" : window.location.origin,
      workspaceKey,
      actorId: actorId ?? "anonymous",
    }),
    [actorId, workspaceKey],
  );
  return (
    <AgentModelScopeContext.Provider value={value}>{children}</AgentModelScopeContext.Provider>
  );
}

/** The active agent model-catalog scope, or the local/anonymous default when no host wired one. */
export const useAgentModelScope = (): AgentModelScope => useContext(AgentModelScopeContext);
