// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIDE_PANEL_WIDTH,
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  useSidePanelStore,
} from "../src/domains/dashboard/store/side-panel-store";

const airAppTab = {
  id: "airapp-node-1",
  type: "airapp-preview",
  title: "Example AirApp",
  payload: { nodeId: "node-1" },
};

const agentTab = {
  id: "agent-buda:research",
  type: "agent-chat",
  title: "Research",
  payload: { agentSlug: "buda:research", sessionId: "session-a" },
};

const storageKey = "busabase-side-panel-prefs";
const reloadStore = async () => {
  const saved = localStorage.getItem(storageKey);
  useSidePanelStore.setState(useSidePanelStore.getInitialState(), true);
  if (saved !== null) localStorage.setItem(storageKey, saved);
  await useSidePanelStore.persist.rehydrate();
};

afterEach(() => localStorage.clear());

describe("side panel display modes", () => {
  beforeEach(() => {
    useSidePanelStore.setState({
      scopeKey: null,
      isOpen: false,
      layout: "split",
      width: DEFAULT_SIDE_PANEL_WIDTH,
      activeTabId: null,
      tabs: [],
    });
  });

  it("keeps mounted tab state when the workspace and actor stay the same", () => {
    const store = useSidePanelStore.getState();
    store.setScope("space-a:user-a");
    store.openTab(airAppTab);
    store.setLayout("maximized");
    const tabs = useSidePanelStore.getState().tabs;

    store.setScope("space-a:user-a");

    expect(useSidePanelStore.getState()).toMatchObject({
      activeTabId: airAppTab.id,
      layout: "maximized",
    });
    expect(useSidePanelStore.getState().tabs).toBe(tabs);
  });

  it.each(["space-b:user-a", "space-a:user-b"])(
    "retires pinned content on a workspace or actor switch to %s, preserving display preferences",
    (scopeKey) => {
      const store = useSidePanelStore.getState();
      store.setScope("space-a:user-a");
      store.openTab(airAppTab);
      store.openTab({
        id: "agent-buda:research",
        type: "agent-chat",
        title: "Research",
        payload: { agentSlug: "buda:research", sessionId: "session-a" },
      });
      store.setWidth(560);
      store.setLayout("maximized");

      store.setScope(scopeKey);

      expect(useSidePanelStore.getState()).toMatchObject({
        scopeKey,
        tabs: [],
        activeTabId: null,
        layout: "split",
        isOpen: true,
        width: 560,
      });
    },
  );

  it("opens a pinned AirApp in split mode and can maximize then restore", () => {
    const store = useSidePanelStore.getState();
    store.openTab(airAppTab);

    expect(useSidePanelStore.getState()).toMatchObject({
      isOpen: true,
      layout: "split",
      activeTabId: airAppTab.id,
      tabs: [airAppTab],
    });

    useSidePanelStore.getState().setLayout("maximized");
    expect(useSidePanelStore.getState().layout).toBe("maximized");

    useSidePanelStore.getState().setLayout("split");
    expect(useSidePanelStore.getState().layout).toBe("split");
  });

  it("restores split mode when the panel is collapsed or its last tab closes", () => {
    useSidePanelStore.getState().openTab(airAppTab);
    useSidePanelStore.getState().setLayout("maximized");
    useSidePanelStore.getState().setOpen(false);

    expect(useSidePanelStore.getState()).toMatchObject({ isOpen: false, layout: "split" });

    useSidePanelStore.getState().openTab(airAppTab);
    useSidePanelStore.getState().setLayout("maximized");
    useSidePanelStore.getState().closeTab(airAppTab.id);
    expect(useSidePanelStore.getState()).toMatchObject({
      layout: "split",
      activeTabId: null,
      tabs: [],
    });
  });

  /**
   * Emptying the panel is not dismissing it. Closing the last tab used to set
   * `isOpen: false`, which made sense while zero tabs rendered nothing — the
   * panel now has an empty state that is how you put the next thing in it, so
   * collapsing would take away the "+" at the moment you reached for it.
   */
  it("stays open on its empty state when the last tab closes", () => {
    useSidePanelStore.getState().openTab(airAppTab);
    expect(useSidePanelStore.getState().isOpen).toBe(true);

    useSidePanelStore.getState().closeTab(airAppTab.id);
    expect(useSidePanelStore.getState()).toMatchObject({ isOpen: true, tabs: [] });
  });

  it("stays open when every tab is closed at once", () => {
    useSidePanelStore.getState().openTab(airAppTab);
    useSidePanelStore.getState().openTab({ ...airAppTab, id: "doc-2", type: "doc-preview" });

    useSidePanelStore.getState().closeAllTabs();
    expect(useSidePanelStore.getState()).toMatchObject({
      isOpen: true,
      tabs: [],
      activeTabId: null,
      layout: "split",
    });
  });

  /**
   * Collapsing is still the way to dismiss the panel, and it must survive the
   * panel being empty — otherwise the two changes above would leave no way to
   * get rid of an empty panel at all.
   */
  it("still collapses on an explicit close, empty or not", () => {
    useSidePanelStore.getState().openTab(airAppTab);
    useSidePanelStore.getState().closeTab(airAppTab.id);
    useSidePanelStore.getState().setOpen(false);

    expect(useSidePanelStore.getState()).toMatchObject({ isOpen: false, tabs: [] });
  });

  it("clamps resized widths to the supported split-panel range", () => {
    useSidePanelStore.getState().setWidth(MIN_SIDE_PANEL_WIDTH - 100);
    expect(useSidePanelStore.getState().width).toBe(MIN_SIDE_PANEL_WIDTH);

    useSidePanelStore.getState().setWidth(MAX_SIDE_PANEL_WIDTH + 100);
    expect(useSidePanelStore.getState().width).toBe(MAX_SIDE_PANEL_WIDTH);
  });

  it("resumes only scoped agent references, without saving drafts or live preview payloads", async () => {
    const store = useSidePanelStore.getState();
    store.setScope("space-a:user-a");
    store.openTab({
      ...agentTab,
      payload: {
        ...agentTab.payload,
        draft: { id: "draft-private", text: "Unsent private question" },
        attachments: ["private.pdf"],
        transcript: "Private transcript",
      },
    });
    store.openTab(airAppTab);
    store.setWidth(560);

    const saved = localStorage.getItem(storageKey);
    expect(saved).not.toContain("Unsent private question");
    expect(saved).not.toContain("private.pdf");
    expect(saved).not.toContain("Private transcript");
    expect(saved).not.toContain("airapp-preview");

    await reloadStore();
    useSidePanelStore.getState().setScope("space-a:user-a");

    expect(useSidePanelStore.getState()).toMatchObject({
      scopeKey: "space-a:user-a",
      isOpen: true,
      width: 560,
      tabs: [agentTab],
      activeTabId: agentTab.id,
    });
  });

  it("restores the active agent tab and the session selected after it opened", async () => {
    const store = useSidePanelStore.getState();
    store.setScope("space-a:user-a");
    store.openTab(agentTab);
    store.openTab({
      id: "agent-buda:writer",
      type: "agent-chat",
      title: "Writer",
      payload: { agentSlug: "buda:writer", sessionId: "session-writer" },
    });
    store.setActiveTab(agentTab.id);
    store.updateTabPayload(agentTab.id, { ...agentTab.payload, sessionId: "older-session" });

    await reloadStore();

    expect(useSidePanelStore.getState()).toMatchObject({
      activeTabId: agentTab.id,
      tabs: [
        { ...agentTab, payload: { ...agentTab.payload, sessionId: "older-session" } },
        { id: "agent-buda:writer" },
      ],
    });
  });

  it("restores a collapsed conversation and keeps an explicitly closed conversation closed", async () => {
    const store = useSidePanelStore.getState();
    store.setScope("space-a:user-a");
    store.openTab(agentTab);
    store.setOpen(false);
    await reloadStore();
    expect(useSidePanelStore.getState()).toMatchObject({ isOpen: false, tabs: [agentTab] });

    useSidePanelStore.getState().closeTab(agentTab.id);
    await reloadStore();
    expect(useSidePanelStore.getState()).toMatchObject({ tabs: [], activeTabId: null });
  });

  it.each(["space-b:user-a", "space-a:user-b"])(
    "does not resurrect saved chats after switching ownership to %s and back",
    async (scopeKey) => {
      const store = useSidePanelStore.getState();
      store.setScope("space-a:user-a");
      store.openTab(agentTab);
      await reloadStore();

      useSidePanelStore.getState().setScope(scopeKey);
      await reloadStore();
      useSidePanelStore.getState().setScope("space-a:user-a");
      expect(useSidePanelStore.getState()).toMatchObject({ tabs: [], activeTabId: null });
    },
  );

  it.each([
    { tabs: [agentTab], activeTabId: agentTab.id },
    { scopeKey: "space-a:user-a", tabs: [airAppTab], activeTabId: airAppTab.id },
    {
      scopeKey: "space-a:user-a",
      tabs: [{ ...agentTab, id: "agent-different" }],
      activeTabId: "agent-different",
    },
    {
      scopeKey: "space-a:user-a",
      tabs: [{ ...agentTab, payload: { agentSlug: 42 } }],
      activeTabId: agentTab.id,
    },
  ])("ignores malformed or unscoped saved content: %j", async (content) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ state: { isOpen: true, width: 560, ...content }, version: 0 }),
    );
    await reloadStore();
    expect(useSidePanelStore.getState()).toMatchObject({
      isOpen: true,
      width: 560,
      scopeKey: null,
      tabs: [],
      activeTabId: null,
    });
  });
});
