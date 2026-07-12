"use client";

import { create } from "zustand";

/**
 * Right-hand "side panel" that can pin content (e.g. a live AirApp preview)
 * so it stays reachable while the user navigates the main canvas elsewhere.
 * Tabs persist independently of panel visibility: collapsing the panel
 * (`setOpen(false)`) only hides it — it does not clear `tabs` — so reopening
 * later restores the same set of pinned tabs.
 */

export interface SidePanelTab {
  id: string;
  type: string;
  title: string;
  payload: unknown;
}

interface SidePanelStoreState {
  isOpen: boolean;
  activeTabId: string | null;
  tabs: SidePanelTab[];
  /** Opens (and activates) `tab`. If a tab with the same `id` is already
   *  open, just activates it instead of adding a duplicate. */
  openTab: (tab: SidePanelTab) => void;
  /** Closes the tab with `id`. If it was the active tab, activates the
   *  previous tab in the list (or `null`, closing the panel, if none left). */
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Toggles panel visibility only — never touches `tabs`. */
  setOpen: (open: boolean) => void;
}

export const useSidePanelStore = create<SidePanelStoreState>((set, get) => ({
  isOpen: false,
  activeTabId: null,
  tabs: [],

  openTab: (tab) => {
    const { tabs } = get();
    const exists = tabs.some((existing) => existing.id === tab.id);
    set({
      tabs: exists ? tabs : [...tabs, tab],
      activeTabId: tab.id,
      isOpen: true,
    });
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) {
      return;
    }
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    if (activeTabId !== id) {
      set({ tabs: nextTabs });
      return;
    }
    // Activate the tab that was immediately before the closed one; if the
    // closed tab was first, fall back to the tab that slides into its slot.
    const previous = nextTabs[index > 0 ? index - 1 : 0] ?? null;
    set({
      tabs: nextTabs,
      activeTabId: previous?.id ?? null,
      isOpen: previous ? get().isOpen : false,
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setOpen: (open) => set({ isOpen: open }),
}));
