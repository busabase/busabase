import "server-only";

import { ORPCError } from "@orpc/server";
import { getNodeType, hasCapability } from "busabase-contract/domains";
import type { NodePO } from "../db/schema";

/**
 * Assert that `parentNode` exists and can hold children of `childNodeType` —
 * i.e. its node-type definition sets `capabilities.container` (today only
 * `folder`, which is also what the space root row's `type` is). Used by every
 * `create*`/`mergeNodeCreate`/`mergeNodeMove` call site that resolves a
 * `parentNodeId` before writing a node under it.
 *
 * Throws a structured `ORPCError` — 404 when the parent id doesn't resolve to
 * any row, 422 when it resolves but isn't container-capable — instead of a
 * plain `Error`. A plain `Error` can't be mapped to a specific HTTP status by
 * the oRPC OpenAPIHandler, so it used to fall back to a generic 500 even
 * though this is a client input problem, not a server fault. Capability-based
 * (not `type === "folder"`) so this stays correct if another container type
 * is ever registered.
 */
export const assertContainerParent = (
  parentNode: NodePO | undefined,
  childNodeType: string,
  parentNodeId: string,
): NodePO => {
  if (!parentNode) {
    throw new ORPCError("NOT_FOUND", { message: `Parent node not found: ${parentNodeId}` });
  }
  if (!hasCapability(parentNode.type, "container")) {
    const childLabel = getNodeType(childNodeType)?.label ?? childNodeType;
    const parentLabel = getNodeType(parentNode.type)?.label ?? parentNode.type;
    throw new ORPCError("INVALID_PARENT_NODE_TYPE", {
      status: 422,
      message: `${childLabel} cannot be nested under a ${parentLabel}; choose a folder or root node.`,
      data: { allowedParentTypes: ["folder"] },
    });
  }
  return parentNode;
};
