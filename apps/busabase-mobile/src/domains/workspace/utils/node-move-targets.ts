import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";

/** A single row in the flattened, indented folder picker. */
export interface MoveTargetRow {
  id: string;
  name: string;
  depth: number;
}

/**
 * Flatten the tree into an ordered, depth-indented list of every node eligible
 * to become the new parent (container-capable types only), pre-order so a
 * folder always appears directly above its own nested folders — the same
 * visual grouping a real folder tree implies. Excludes `excludeId` (the node
 * being moved) and every one of its descendants: re-parenting a folder under
 * its own descendant would orphan the subtree in a cycle.
 *
 * Ported as-is from the web dialog's private `flattenMoveTargets`
 * (packages/busabase-core/src/domains/dashboard/components/node-move-dialog.tsx)
 * — it isn't exported there, and the web copy lives inside a React component
 * file that can't be imported from React Native. Kept pure and tested here so
 * the two stay comparable line for line.
 */
export function flattenMoveTargets(nodes: NodeVO[], excludeId: string): MoveTargetRow[] {
  const excludedIds = new Set<string>();
  const collectDescendants = (node: NodeVO) => {
    excludedIds.add(node.id);
    for (const child of node.children) collectDescendants(child);
  };
  const findExcluded = (list: NodeVO[]): NodeVO | undefined => {
    for (const node of list) {
      if (node.id === excludeId) return node;
      const found = findExcluded(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const excludedNode = findExcluded(nodes);
  if (excludedNode) collectDescendants(excludedNode);

  const rows: MoveTargetRow[] = [];
  const visit = (list: NodeVO[], depth: number) => {
    for (const node of list) {
      if (excludedIds.has(node.id)) continue;
      if (hasCapability(node.type, "container")) {
        rows.push({ id: node.id, name: node.name, depth });
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return rows;
}
