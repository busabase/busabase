export type PermissionLevel = "read" | "changeRequest" | "write" | "manage";

export type NodePermissionVisibility = "private" | "workspace" | "public" | null | undefined;

export interface FlatPermissionNode {
  id: string;
  parentId: string | null;
  name: string;
  visibility?: Exclude<NodePermissionVisibility, null | undefined>;
}

export interface NodePermissionAccess {
  explicitVisibility: NodePermissionVisibility;
  inheritedPrivateFrom?: string;
  isInherited: boolean;
  isLimited: boolean;
  isPrivate: boolean;
  isRestrictedSpace: boolean;
  storedVisibility: NodePermissionVisibility;
}

export interface NodePermissionPrincipal {
  id: string;
  principalId: string;
  principalType: "user" | "team" | "space";
  role: PermissionLevel;
}
