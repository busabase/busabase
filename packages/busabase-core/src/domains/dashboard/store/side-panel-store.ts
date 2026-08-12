"use client";

import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Right-hand "side panel" that can pin content (e.g. a live AirApp preview)
 * so it stays reachable while the user navigates the main canvas elsewhere.
 * Tabs persist independently of panel visibility: collapsing the panel
 * (`setOpen(false)`) only hides it — it does not clear `tabs` — so reopening
 * later restores the same set of pinned tabs.
 */

/**
 * DTO/VO for `openTab`'s payload — single source of truth for the tab shape
 * (mirrors the repo's Zod-schema-first convention). `openTab` parses every
 * call through this schema so callers get both compile-time typing and a
 * runtime guard, instead of trusting an untyped object literal.
 */
export const SidePanelTabSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string(),
  payload: z.unknown(),
});

export type SidePanelTab = z.infer<typeof SidePanelTabSchema>;

export type SidePanelLayout = "split" | "maximized";

export interface SidePanelStoreState {
  isOpen: boolean;
  layout: SidePanelLayout;
  width: number;
  activeTabId: string | null;
  tabs: SidePanelTab[];
  /** Opens (and activates) `tab`. If a tab with the same `id` is already
   *  open, just activates it instead of adding a duplicate. */
  openTab: (tab: SidePanelTab) => void;
  /** Closes the tab with `id`. If it was the active tab, activates the
   *  previous tab in the list (or `null`, closing the panel, if none left). */
  closeTab: (id: string) => void;
  /** Closes every tab except `id`, activating `id`. */
  closeOtherTabs: (id: string) => void;
  /** Closes every open tab and collapses the panel. */
  closeAllTabs: () => void;
  /** Moves the tab `draggedId` to sit just before/after `targetId` (drag-to-reorder). */
  reorderTabs: (draggedId: string, targetId: string) => void;
  setActiveTab: (id: string) => void;
  /** Toggles panel visibility only — never touches `tabs`. */
  setOpen: (open: boolean) => void;
  setLayout: (layout: SidePanelLayout) => void;
  setWidth: (width: number) => void;
}

export const DEFAULT_SIDE_PANEL_WIDTH = 420;
export const MIN_SIDE_PANEL_WIDTH = 320;
export const MAX_SIDE_PANEL_WIDTH = 760;
/** Drag past (MIN - this) on release auto-closes the panel instead of
 *  clamping back to the minimum width (collapse-by-drag). */
export const SIDE_PANEL_RESIZE_CLOSE_THRESHOLD = 48;

export const clampSidePanelWidth = (width: number) =>
  Math.min(MAX_SIDE_PANEL_WIDTH, Math.max(MIN_SIDE_PANEL_WIDTH, width));

/**
 * Persists `isOpen` / `layout` / `width` only — deliberately NOT `tabs` /
 * `activeTabId`. Those reference live pinned content (e.g. a running AirApp
 * preview); resurrecting them from a stale localStorage snapshot after a
 * reload would point at content that no longer exists or has moved on.
 */
export const useSidePanelStore = create<SidePanelStoreState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      layout: "split",
      width: DEFAULT_SIDE_PANEL_WIDTH,
      activeTabId: null,
      tabs: [],

      openTab: (input) => {
        const tab = SidePanelTabSchema.parse(input);
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
          layout: previous ? get().layout : "split",
        });
      },

      closeOtherTabs: (id) => {
        const { tabs } = get();
        const keep = tabs.find((tab) => tab.id === id);
        if (!keep) {
          return;
        }
        set({ tabs: [keep], activeTabId: keep.id });
      },

      closeAllTabs: () => set({ tabs: [], activeTabId: null, isOpen: false, layout: "split" }),

      reorderTabs: (draggedId, targetId) => {
        if (draggedId === targetId) {
          return;
        }
        const { tabs } = get();
        const fromIndex = tabs.findIndex((tab) => tab.id === draggedId);
        const toIndex = tabs.findIndex((tab) => tab.id === targetId);
        if (fromIndex === -1 || toIndex === -1) {
          return;
        }
        const nextTabs = [...tabs];
        const [dragged] = nextTabs.splice(fromIndex, 1);
        if (!dragged) {
          return;
        }
        nextTabs.splice(toIndex, 0, dragged);
        set({ tabs: nextTabs });
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      setOpen: (open) => set({ isOpen: open, ...(!open ? { layout: "split" as const } : {}) }),

      setLayout: (layout) => set({ layout, isOpen: true }),

      setWidth: (width) => set({ width: clampSidePanelWidth(width) }),
    }),
    {
      name: "busabase-side-panel-prefs",
      partialize: (state) => ({
        isOpen: state.isOpen,
        layout: state.layout,
        width: state.width,
      }),
    },
  ),
);
