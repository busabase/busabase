import type { NodeVO } from "busabase-contract/types";

export interface NodeShareMarker {
  icon: "globe" | "lock";
  tone: "default" | "muted";
  labelKey: "sharedMarker" | "sharedViaAncestorMarker" | "restrictedMarker";
}

/**
 * Which always-visible tree-row marker a node gets, if any — same priority as
 * web's `buildNavItem` (dashboard-shell.tsx): a node's own live public share
 * wins over everything, then exposure inherited from a shared ancestor (one
 * step fainter — `tone: "muted"` — so it doesn't read as its own grant), then
 * an explicit access restriction. A node that is neither shared nor
 * restricted gets no marker.
 *
 * The globe always outranks the lock: a node that is BOTH restricted to the
 * space AND carrying a live public link is the alarming combination (you
 * believe it's locked, anonymous visitors can read it), and the marker that
 * must survive is the one announcing the exposure.
 */
export function resolveNodeShareMarker(
  node: Pick<NodeVO, "shared" | "sharedViaAncestor" | "explicitVisibility">,
): NodeShareMarker | null {
  if (node.shared) return { icon: "globe", tone: "default", labelKey: "sharedMarker" };
  if (node.sharedViaAncestor) {
    return { icon: "globe", tone: "muted", labelKey: "sharedViaAncestorMarker" };
  }
  if (node.explicitVisibility === "private") {
    return { icon: "lock", tone: "default", labelKey: "restrictedMarker" };
  }
  return null;
}
