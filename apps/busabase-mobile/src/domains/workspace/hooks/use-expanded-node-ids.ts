import { useSyncExternalStore } from "react";
import { getExpandedNodeIds, subscribeToNodeExpansion } from "../utils/tree-expansion";

/** The module-level expansion snapshot. Collapsed by default on cold start. */
export const useExpandedNodeIds = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribeToNodeExpansion, getExpandedNodeIds, getExpandedNodeIds);
