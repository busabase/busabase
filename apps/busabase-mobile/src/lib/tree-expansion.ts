import type { NodeVO } from "busabase-contract/types";
import { useSyncExternalStore } from "react";

/**
 * Which container nodes in the drawer's workspace tree are expanded.
 *
 * Module-level store — NOT component state, for exactly the reason
 * `contextual-nav.ts` uses one: `DrawerScaffold` is re-mounted by every screen
 * (each screen wraps its own content; there is no shared
 * `app/drawer/_layout.tsx`), so React state would be thrown away on every
 * navigation — which is the precise moment the user expects the tree to still
 * be sitting where they left it. Living outside React means a freshly mounted
 * scaffold reads back what the previous screen wrote. Closing and reopening the
 * drawer is only a `Modal` visibility flip, so that survives trivially too.
 *
 * Scoped to the running app process on purpose, mirroring web: `NavMain` keeps
 * its `openOverrides` in component state, which survives SPA navigation (the
 * sidebar is never unmounted) but resets on a full reload. A cold start on
 * mobile should likewise open the tree at its resting, collapsed state — hence
 * no AsyncStorage.
 *
 * The snapshot is an immutable `Set` that is REPLACED on every change, never
 * mutated, so `useSyncExternalStore` sees a new identity and re-renders.
 */
let expandedIds: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): ReadonlySet<string> => expandedIds;

/** Non-reactive read of the current snapshot (tests, and any non-React caller). */
export const getExpandedNodeIds = (): ReadonlySet<string> => expandedIds;

/** Flip one container node open/closed. */
export const toggleNodeExpanded = (nodeId: string) => {
  const next = new Set(expandedIds);
  if (!next.delete(nodeId)) {
    next.add(nodeId);
  }
  expandedIds = next;
  emit();
};

/**
 * Additive expand, used for the "reveal where I am" pass. Bails out — WITHOUT
 * notifying — when every id is already open, which is what keeps the effect
 * that calls it on every render from looping: no state change, no re-render.
 */
export const expandNodes = (nodeIds: readonly string[]) => {
  const missing = nodeIds.filter((nodeId) => !expandedIds.has(nodeId));
  if (missing.length === 0) return;
  const next = new Set(expandedIds);
  for (const nodeId of missing) next.add(nodeId);
  expandedIds = next;
  emit();
};

/** Test-only reset so specs don't leak the module-level value into each other. */
export const resetNodeExpansion = () => {
  expandedIds = new Set<string>();
  emit();
};

/** The currently expanded node ids. Collapsed-by-default: starts empty. */
export const useExpandedNodeIds = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/**
 * Ids of every ancestor of the first node `isActive` accepts — i.e. the chain
 * that has to be open for the active node to be visible. Excludes the active
 * node itself: being on a folder's own screen should not force that folder's
 * contents open, only reveal the folder's row (web behaves the same way — a
 * folder is expanded when the route is *inside* it).
 *
 * Pure and tree-shaped rather than a flat parent map because the drawer only
 * ever has `nodes.list`'s nested VOs to work from.
 */
export const ancestorIdsOfActiveNode = (
  nodes: readonly NodeVO[],
  isActive: (node: NodeVO) => boolean,
): string[] => {
  const walk = (list: readonly NodeVO[], trail: string[]): string[] | null => {
    for (const node of list) {
      if (isActive(node)) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
};
