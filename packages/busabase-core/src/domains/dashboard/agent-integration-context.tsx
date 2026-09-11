"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { AgentIntegrationTarget } from "./components/agent-install-panel";

/**
 * Which Busabase this dashboard IS — edition and target space — reachable from
 * deep leaf components.
 *
 * The install dialog and the template centre take this as a prop, and for them
 * that stays the norm: a host renders those directly, so one prop hop makes the
 * dependency visible. The Agent-prompts surface is the other shape, the same one
 * `orpc-context` was written for: it is reached through `node-detail-views` →
 * `NodeAgentPromptsButton` → `NodeAgentPromptsDialog`, plus `base-table`,
 * `record-views`, `base-views`, `rich-node-shell` and `AirAppDetailView`, none
 * of which have any reason to know about editions. Threading a prop through
 * nine components to reach one dialog is how a host quietly loses it.
 *
 * Deliberately optional (`undefined` by default): a host that never wired this —
 * the mobile WebView's chromeless render, an SSR pass — gets the graceful
 * degradation `renderPromptForDispatch` is built around, where the copied prompt
 * simply carries no connection check rather than carrying a wrong one.
 */
const AgentIntegrationContext = createContext<AgentIntegrationTarget | undefined>(undefined);

export function AgentIntegrationProvider({
  children,
  agentIntegration,
}: {
  children: ReactNode;
  agentIntegration?: AgentIntegrationTarget;
}) {
  return (
    <AgentIntegrationContext.Provider value={agentIntegration}>
      {children}
    </AgentIntegrationContext.Provider>
  );
}

/** The active host's edition/space, or `undefined` when no host wired one. */
export const useAgentIntegrationTarget = (): AgentIntegrationTarget | undefined =>
  useContext(AgentIntegrationContext);
