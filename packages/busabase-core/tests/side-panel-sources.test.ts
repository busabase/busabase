/**
 * The rules every side-panel entry point shares.
 *
 * The "+" menu, the empty state and the search dialog's pin mode all fill the
 * panel, and each of them can reach a node the panel has no renderer for. What
 * is asserted here is that they cannot: the filter lives in one place, so a new
 * entry point inherits it rather than re-deriving it (and getting it wrong).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  isPinnableNode,
  openAgentChatTab,
  pinNodeToSidePanel,
  pinnableRecents,
  sidePanelTabTypeForNode,
} from "../src/domains/dashboard/components/side-panel-sources";
import type { KnownNode } from "../src/domains/dashboard/helpers/known-node-cache";
import { registerSidePanelTab } from "../src/domains/dashboard/side-panel-registry";
import { useSidePanelStore } from "../src/domains/dashboard/store/side-panel-store";

// The registry is populated as an import side effect of the detail views,
// which are not loaded here — register just what these assertions need.
const Noop = () => null;
registerSidePanelTab("doc-preview", Noop);
registerSidePanelTab("base-preview", Noop);

const knownNode = (id: string, type: string, name: string): KnownNode => ({
  id,
  type: type as KnownNode["type"],
  name,
  slug: name,
  path: `/${type}/${name}`,
  lastVisitedAt: new Date().toISOString(),
});

beforeEach(() => {
  useSidePanelStore.setState({ tabs: [], activeTabId: null, isOpen: false, layout: "split" });
});

describe("side panel sources", () => {
  it("maps a node type to its registered renderer name", () => {
    expect(sidePanelTabTypeForNode("doc")).toBe("doc-preview");
  });

  it("treats a node type with no registered renderer as not pinnable", () => {
    expect(isPinnableNode("doc")).toBe(true);
    // A real node type, deliberately never given a side-panel renderer.
    expect(isPinnableNode("workflow")).toBe(false);
  });

  it("pins a node as a tab the panel can actually render", () => {
    pinNodeToSidePanel({ id: "n1", type: "doc", name: "Roadmap" });

    expect(useSidePanelStore.getState()).toMatchObject({
      isOpen: true,
      activeTabId: "doc-n1",
      tabs: [{ id: "doc-n1", type: "doc-preview", title: "Roadmap", payload: { nodeId: "n1" } }],
    });
  });

  it("re-activates rather than duplicating when the same node is pinned twice", () => {
    pinNodeToSidePanel({ id: "n1", type: "doc", name: "Roadmap" });
    pinNodeToSidePanel({ id: "n2", type: "base", name: "Tasks" });
    pinNodeToSidePanel({ id: "n1", type: "doc", name: "Roadmap" });

    const state = useSidePanelStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe("doc-n1");
  });

  /**
   * The tab id must match `nodeSidePanelTabId` in `node-pin-button.tsx`, or the
   * topbar pin and the "+" menu would each open their own tab for one node.
   */
  it("uses the same tab id as the topbar pin button", () => {
    pinNodeToSidePanel({ id: "abc", type: "base", name: "Tasks" });
    expect(useSidePanelStore.getState().tabs[0]?.id).toBe("base-abc");
  });

  it("drops recents the panel cannot render, and keeps the newest first", () => {
    const recents = pinnableRecents(
      [
        knownNode("1", "doc", "First"),
        knownNode("2", "workflow", "Not renderable"),
        knownNode("3", "base", "Third"),
      ],
      10,
    );

    expect(recents.map((node) => node.name)).toEqual(["First", "Third"]);
  });

  it("honours the recents limit after filtering, not before", () => {
    // A naive `.slice(limit)` before filtering would return one item here.
    const recents = pinnableRecents(
      [knownNode("1", "workflow", "Skipped"), knownNode("2", "doc", "Kept")],
      1,
    );

    expect(recents.map((node) => node.name)).toEqual(["Kept"]);
  });

  it("keys an agent tab by agent, so a second session reuses the same tab", () => {
    openAgentChatTab("claude", "Claude Code", "session-1");
    openAgentChatTab("claude", "Claude Code", "session-2");

    const state = useSidePanelStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "agent-claude", type: "agent-chat" });
  });
});
