import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";

const isWorkspaceRootNode = (node: NodeVO): boolean =>
  node.parentId === null && hasCapability(node.type, "container") && !node.baseId;

/**
 * Remove the system workspace root from the sidebar while retaining any nodes
 * promoted beside it after ACL filtering hides one of their ancestors.
 */
export const getSidebarTopLevelNodes = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => (isWorkspaceRootNode(node) ? node.children : [node]));
