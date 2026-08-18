import type { NodeVO } from "busabase-contract/types";
import type {
  FlatPermissionNode,
  NodePermissionAccess,
  NodePermissionVisibility,
} from "../types/node-permissions";

export const buildPermissionNodeIndex = (
  nodes: NodeVO[] | undefined,
  map: Map<string, FlatPermissionNode> = new Map(),
): Map<string, FlatPermissionNode> => {
  if (!nodes) return map;
  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      visibility: node.explicitVisibility ?? undefined,
    });
    buildPermissionNodeIndex(node.children, map);
  }
  return map;
};

export const findInheritedPrivateNode = (
  nodeId: string,
  index: Map<string, FlatPermissionNode>,
): FlatPermissionNode | undefined => {
  const self = index.get(nodeId);
  let cursor = self?.parentId ? index.get(self.parentId) : undefined;
  while (cursor) {
    if (cursor.visibility === "private") return cursor;
    cursor = cursor.parentId ? index.get(cursor.parentId) : undefined;
  }
  return undefined;
};

export const toMutablePrincipalType = (
  principalType: "user" | "team" | "space",
): "user" | "space" => (principalType === "team" ? "user" : principalType);

interface ResolveNodePermissionAccessOptions {
  node: NodeVO;
  nodes: NodeVO[];
  spaceVisibilityMode?: "open" | "restricted" | null;
  visibilityOverride: NodePermissionVisibility;
}

export const resolveNodePermissionAccess = ({
  node,
  nodes,
  spaceVisibilityMode,
  visibilityOverride,
}: ResolveNodePermissionAccessOptions): NodePermissionAccess => {
  const index = buildPermissionNodeIndex(nodes);
  const storedVisibility = index.get(node.id)?.visibility ?? node.explicitVisibility ?? undefined;
  const explicitVisibility =
    visibilityOverride === undefined ? storedVisibility : visibilityOverride;
  const inheritedPrivateFrom = findInheritedPrivateNode(node.id, index)?.name;
  const isPrivate = explicitVisibility === "private";
  const isInherited = !isPrivate && !!inheritedPrivateFrom;
  const isRestrictedSpace = spaceVisibilityMode === "restricted";

  return {
    explicitVisibility,
    inheritedPrivateFrom,
    isInherited,
    isLimited: isPrivate || isInherited || isRestrictedSpace,
    isPrivate,
    isRestrictedSpace,
    storedVisibility,
  };
};
