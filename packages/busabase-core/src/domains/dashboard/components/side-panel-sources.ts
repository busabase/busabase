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
  /**
   * Text to drop into the composer without sending it (Ask Agent). One-shot:
   * the tab clears it via `consumeAgentChatDraft` the moment it lands, so a
   * remount cannot replay it into the user's next draft.
   */
  draft?: { id: string; text: string };
}

/** The tab id for an agent — one per agent, whatever node the question is about. */
export const agentChatTabId = (agentSlug: string): string => `agent-${agentSlug}`;

/**
 * Open (or re-activate) an agent conversation.
 *
 * Keyed by agent rather than by session: one tab per agent, switching sessions
 * inside it. Keying by session would let a single agent accumulate a tab per
 * conversation, which is the tab-strip clutter this panel exists to avoid.
 *
 * `openTab` alone is not enough for a *second* Ask Agent click: it finds the id
 * already open and only re-activates it, keeping the first click's payload. So
 * this follows up with `updateTabPayload` — same tab, new session/draft.
 */
export const openAgentChatTab = (
  agentSlug: string,
  agentName: string,
  options: { sessionId?: string; draft?: { id: string; text: string } } = {},
): void => {
  const id = agentChatTabId(agentSlug);
  const payload: AgentChatTabPayload = {
    agentSlug,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.draft ? { draft: options.draft } : {}),
  };
  const store = useSidePanelStore.getState();
  store.openTab({ id, type: AGENT_CHAT_TAB_TYPE, title: agentName, payload });
  store.updateTabPayload(id, payload);
};

/**
 * Retire a draft the tab has already put in the composer.
 *
 * Without this, the draft would live in the payload forever and re-apply on any
 * remount — the panel keeps inactive tabs mounted, but "forever" is a long time
 * to be one unmount away from pasting an old prompt into someone's half-typed
 * message.
 */
export const consumeAgentChatDraft = (agentSlug: string, draftId: string): void => {
  const id = agentChatTabId(agentSlug);
  const tab = useSidePanelStore.getState().tabs.find((candidate) => candidate.id === id);
  if (!tab) return;
  const payload = tab.payload as AgentChatTabPayload;
  if (payload.draft?.id !== draftId) return;
  const { draft: _draft, ...rest } = payload;
  useSidePanelStore.getState().updateTabPayload(id, rest satisfies AgentChatTabPayload);
};
