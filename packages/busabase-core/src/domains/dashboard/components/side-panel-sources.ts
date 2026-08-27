import type { NodeType } from "busabase-contract/domains";
import type { KnownNode } from "../helpers/known-node-cache";
import { getSidePanelTab } from "../side-panel-registry";
import { useSidePanelStore } from "../store/side-panel-store";

/**
 * What the side panel can be filled with, in one place.
 *
 * The "+" menu and the empty state are two presentations of the same offer, so
 * they read from here rather than each keeping their own list — the failure
 * mode otherwise is a card that exists in the empty state but not in the menu
 * (or worse, one that opens a tab type nothing renders).
 */

/** The node shape every pin path needs: `openTab` wants all three. */
export interface PinnableNode {
  id: string;
  type: NodeType | string;
  name: string;
}

/** Node type -> registered tab type, the convention every renderer follows. */
export const sidePanelTabTypeForNode = (nodeType: string): string => `${nodeType}-preview`;

/**
 * Whether a node can actually be shown in the panel.
 *
 * Only some node types have a registered renderer; the rest would open a tab
 * that renders nothing but a console warning. Every entry point filters through
 * this rather than assuming a node is pinnable because it exists.
 *
 * Asked at render time, not module-init time, and that matters: renderers
 * register as an import side effect of `node-detail-views` / `base-views`, so
 * this answers `false` for everything if called before those modules load.
 * Every caller here runs inside a component, by which point the dashboard has
 * already imported them.
 */
export const isPinnableNode = (nodeType: string): boolean =>
  getSidePanelTab(sidePanelTabTypeForNode(nodeType)) !== undefined;

/**
 * Mirrors `nodeSidePanelTabId` in `node-pin-button.tsx` — the two must agree or
 * pinning the same node from the topbar and from the "+" menu would produce two
 * tabs for one node instead of re-activating the one already open.
 */
const tabIdForNode = (nodeType: string, nodeId: string) => `${nodeType}-${nodeId}`;

/**
 * Pin a node, from anywhere. Idempotent: `openTab` dedupes by id, so pinning
 * something already pinned just brings its tab forward.
 */
export const pinNodeToSidePanel = (node: PinnableNode): void => {
  useSidePanelStore.getState().openTab({
    id: tabIdForNode(node.type, node.id),
    type: sidePanelTabTypeForNode(node.type),
    title: node.name,
    payload: { nodeId: node.id },
  });
};

/** Recently-visited nodes, newest first, filtered to what the panel can render. */
export const pinnableRecents = (visited: readonly KnownNode[], limit: number): KnownNode[] =>
  visited.filter((node) => isPinnableNode(node.type)).slice(0, limit);

/** Tab type for an agent conversation. Not a node, so it sits outside `*-preview`. */
export const AGENT_CHAT_TAB_TYPE = "agent-chat";

export interface AgentChatTabPayload {
  agentSlug: string;
  /**
   * The session to resume. Omitted for a fresh conversation — the renderer
   * starts one, which is why this is not required to open the tab.
   */
  sessionId?: string;
}

/**
 * Open (or re-activate) an agent conversation.
 *
 * Keyed by agent rather than by session: one tab per agent, switching sessions
 * inside it. Keying by session would let a single agent accumulate a tab per
 * conversation, which is the tab-strip clutter this panel exists to avoid.
 */
export const openAgentChatTab = (
  agentSlug: string,
  agentName: string,
  sessionId?: string,
): void => {
  useSidePanelStore.getState().openTab({
    id: `agent-${agentSlug}`,
    type: AGENT_CHAT_TAB_TYPE,
    title: agentName,
    payload: { agentSlug, sessionId } satisfies AgentChatTabPayload,
  });
};
