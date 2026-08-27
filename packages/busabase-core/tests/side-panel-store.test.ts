import { beforeEach, describe, expect, it } from "vitest";
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

describe("side panel display modes", () => {
  beforeEach(() => {
    useSidePanelStore.setState({
      isOpen: false,
      layout: "split",
      width: DEFAULT_SIDE_PANEL_WIDTH,
      activeTabId: null,
      tabs: [],
    });
  });

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
});
