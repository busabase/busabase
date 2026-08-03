"use client";

import type { ReactNode } from "react";
import { create } from "zustand";

/**
 * Single-slot registration for the node-detail action cluster (Edit-if-Doc +
 * Pin-to-side-panel + "..." actions menu) that every node-detail view used to
 * hand-roll into its own in-page header. Instead, a view registers its
 * cluster once (via `useRegisterTopbarNodeActions`) and the shared dashboard
 * topbar (`dashboard/index.tsx`) renders whatever is currently registered.
 *
 * Deliberately unpersisted and holding at most one `ReactNode` — unlike
 * `side-panel-store.ts` this has no state worth surviving a reload, and only
 * one node-detail view is ever "the" visible one at a time so a single slot
 * (not a stack/map) is the right shape.
 */
export interface TopbarNodeActionsStoreState {
  actions: ReactNode | null;
  setActions: (actions: ReactNode | null) => void;
}

export const useTopbarNodeActionsStore = create<TopbarNodeActionsStoreState>()((set) => ({
  actions: null,
  setActions: (actions) => set({ actions }),
}));
