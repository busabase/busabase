import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";

export interface MoveTargetRow {
  id: string;
  name: string;
  depth: number;
}

/**
 * Flatten a node tree into the container destinations valid for a move.
 * The moved node and all descendants are excluded to prevent cycles.
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
