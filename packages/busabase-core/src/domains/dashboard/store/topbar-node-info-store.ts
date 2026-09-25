"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { create } from "zustand";

/**
 * Single-slot registration for the current node's identity — the sibling of
 * `topbar-node-actions-store.ts`, and deliberately the same shape (one slot,
 * unpersisted, last writer wins).
 *
 * The difference is WHAT is stored: the actions slot holds a ready-made
 * `ReactNode`, this one holds plain data. Every node-detail view used to
 * hand-roll its own in-page "big title + description + Info button + info
 * dialog" block; the topbar now renders ONE button/tooltip/dialog for all of
 * them, so a view only has to say which node it is showing.
 */
export interface TopbarNodeInfo {
  /** Carried here because the topbar has no query client of its own — the
   *  registering view already holds the one its detail query uses. */
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  /** Detail routes are keyed by slug; sidebar-style callers may not have one. */
  nodeSlug?: string;
  /** Shown as the Info button's tooltip; falls back to a generic label when empty. */
  description?: string | null;
}

export interface TopbarNodeInfoStoreState {
  info: TopbarNodeInfo | null;
  setInfo: (info: TopbarNodeInfo | null) => void;
}

export const useTopbarNodeInfoStore = create<TopbarNodeInfoStoreState>()((set) => ({
  info: null,
  setInfo: (info) => set({ info }),
}));
