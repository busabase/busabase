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

// Only these references can be resumed after a document load. Live previews,
// composer drafts, attachments and transcript contents stay in page memory.
const SavedAgentChatTabSchema = z
  .object({
    id: z.string(),
    type: z.literal("agent-chat"),
    title: z.string(),
    payload: z.object({
      agentSlug: z.string().min(1),
      sessionId: z.string().min(1).optional(),
    }),
  })
  .refine((tab) => tab.id === `agent-${tab.payload.agentSlug}`);

const SavedPanelContentSchema = z.object({
  scopeKey: z.string().min(1),
  tabs: z.array(SavedAgentChatTabSchema),
  activeTabId: z.string().nullable(),
});

const SavedPanelPreferencesSchema = z.object({
  isOpen: z.boolean().optional(),
  layout: z.enum(["split", "maximized"]).optional(),
  width: z.number().optional(),
});

export type SidePanelLayout = "split" | "maximized";

export interface SidePanelStoreState {
  /** Ownership of both live tabs and saved conversation references. */
  scopeKey: string | null;
  isOpen: boolean;
  layout: SidePanelLayout;
  width: number;
  activeTabId: string | null;
  tabs: SidePanelTab[];
  /** Drops space-owned content when the workspace or signed-in actor changes. */
  setScope: (scopeKey: string) => void;
  /** Opens (and activates) `tab`. If a tab with the same `id` is already
   *  open, just activates it instead of adding a duplicate. */
  openTab: (tab: SidePanelTab) => void;
  /**
   * Replaces the payload of an already-open tab, leaving its position and
   * identity alone. No-op when `id` is not open.
   *
   * `openTab` deliberately does NOT update the payload of a tab it finds
   * already open — it only re-activates it. That is right for pinning a node
   * (the payload is the node, and it has not changed), but it is exactly wrong
   * for a tab whose payload carries *instructions*: asking the same agent a
   * second question re-opens the same tab id, so the second question would be
   * silently dropped. This is the way to say "same tab, new contents".
   */
  updateTabPayload: (id: string, payload: unknown) => void;
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
 * Saves display preferences and workspace/user-scoped agent conversation
 * references. A reload reconnects the existing session through the normal API;
 * it never revives a live AirApp process or copies chat content into storage.
 * The panel gates its first render by scope and `setScope` retires saved
 * conversations when the workspace or signed-in actor changes.
 */
export const useSidePanelStore = create<SidePanelStoreState>()(
  persist(
    (set, get) => ({
      scopeKey: null,
      isOpen: false,
      layout: "split",
      width: DEFAULT_SIDE_PANEL_WIDTH,
      activeTabId: null,
      tabs: [],

      setScope: (scopeKey) => {
        if (get().scopeKey === scopeKey) return;
        set({ scopeKey, tabs: [], activeTabId: null, layout: "split" });
      },

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

      updateTabPayload: (id, payload) => {
        const { tabs } = get();
        if (!tabs.some((tab) => tab.id === id)) {
          return;
        }
        set({ tabs: tabs.map((tab) => (tab.id === id ? { ...tab, payload } : tab)) });
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
        //
        // Closing the last tab leaves the panel *open* on its empty state.
        // Auto-collapsing was right when zero tabs meant a blank panel, but the
        // empty state is now the panel's launcher — collapsing would yank away
        // the "+" the moment you got there.
        const previous = nextTabs[index > 0 ? index - 1 : 0] ?? null;
        set({
          tabs: nextTabs,
          activeTabId: previous?.id ?? null,
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

      // Same reasoning as `closeTab`: emptying the panel is not the same as
      // dismissing it. The panel stays open on its empty state.
      closeAllTabs: () => set({ tabs: [], activeTabId: null, layout: "split" }),

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
      partialize: (state) => {
        const tabs = state.scopeKey
          ? state.tabs.flatMap((tab) => {
              const saved = SavedAgentChatTabSchema.safeParse(tab);
              return saved.success ? [saved.data] : [];
            })
          : [];
        return {
          isOpen: state.isOpen,
          layout: state.layout,
          width: state.width,
          scopeKey: state.scopeKey,
          tabs,
          activeTabId: tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[0]?.id ?? null),
        };
      },
      merge: (persisted, current) => {
        const preferences = SavedPanelPreferencesSchema.safeParse(persisted);
        const content = SavedPanelContentSchema.safeParse(persisted);
        return {
          ...current,
          ...(preferences.success ? preferences.data : {}),
          width:
            preferences.success && preferences.data.width !== undefined
              ? clampSidePanelWidth(preferences.data.width)
              : current.width,
          // Legacy preferences have no owner. Never adopt unscoped or malformed
          // content, even when its tab shape happens to look valid.
          ...(content.success
            ? {
                scopeKey: content.data.scopeKey,
                tabs: content.data.tabs,
                activeTabId: content.data.tabs.some((tab) => tab.id === content.data.activeTabId)
                  ? content.data.activeTabId
                  : (content.data.tabs[0]?.id ?? null),
              }
            : {}),
        };
      },
    },
  ),
);
