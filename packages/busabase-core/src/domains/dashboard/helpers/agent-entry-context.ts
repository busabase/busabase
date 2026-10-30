import type { LoadedNode } from "../node-detail-registry";

export interface AgentEntryContextState {
  path: string;
  scopeKey: string;
  node: LoadedNode | null;
  origin: LoadedNode | null;
}

const isAgentArea = (path: string) => path === "/agents" || path.startsWith("/agents/");

/** Only the immediately preceding node page can seed an Agent-area visit. */
export function nextAgentEntryContext(
  previous: AgentEntryContextState | null,
  current: Omit<AgentEntryContextState, "origin">,
): AgentEntryContextState {
  const sameScope = previous?.scopeKey === current.scopeKey;
  const origin =
    !isAgentArea(current.path) || !sameScope
      ? null
      : isAgentArea(previous.path)
        ? previous.origin
        : previous.node;
  return { ...current, origin };
}
