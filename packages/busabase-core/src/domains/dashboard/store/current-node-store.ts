"use client";

import { create } from "zustand";
import type { LoadedNode } from "../node-detail-registry";

/**
 * What the main area is currently showing — so the side panel can offer it as
 * context without the user re-describing their own screen.
 *
 * A store rather than a prop because of where it has to arrive: side-panel tabs
 * are looked up through `side-panel-registry` by tab type, and their props are
 * deliberately just `{ orpc, payload }`. Threading "the node the user is looking
 * at" down that path would mean widening that contract for every tab type, when
 * exactly one of them wants it.
 *
 * `null` whenever the main area is not on a node — the agents list, Home,
 * settings. That is the honest answer, and it is what keeps the composer from
 * offering a stale node as context for a question that has nothing to do with it.
 *
 * Unpersisted, single-slot, same shape and reasoning as
 * `topbar-node-actions-store.ts`: one main area, one current node, nothing worth
 * surviving a reload.
 */
export interface CurrentNodeStoreState {
  node: LoadedNode | null;
  setNode: (node: LoadedNode | null) => void;
}

export const useCurrentNodeStore = create<CurrentNodeStoreState>()((set) => ({
  node: null,
  setNode: (node) =>
    set((state) => {
      // Same node, same object identity out — this is fed by a route/tree effect
      // that re-runs on unrelated renders, and every new object here would
      // re-render the composer's context chip for no reason.
      const current = state.node;
      if (current?.id === node?.id && current?.name === node?.name) return state;
      return { node };
    }),
}));
