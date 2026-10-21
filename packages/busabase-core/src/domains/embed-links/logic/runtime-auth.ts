import "server-only";

import { ORPCError } from "@orpc/server";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import { getContextSpaceId, isPublicVisitor } from "../../../context";

/** Runtime bootstrap metadata, never the viewer's or capability creator's identity. */
export const getAirAppRuntimeAuthInfo = (): AuthInfo => {
  if (!isPublicVisitor()) {
    throw new ORPCError("FORBIDDEN", { message: "A validated runtime visitor is required" });
  }
  const spaceId = getContextSpaceId();
  const visitorId = "airapp-runtime-visitor";
  return {
    space: {
      id: spaceId,
      name: "Shared Workspace",
      slug: null,
      plan: null,
      nodeVisibilityMode: "restricted",
    },
    user: { id: visitorId, name: "Visitor", email: null, image: null },
    member: { userId: visitorId, spaceId, role: "visitor" },
    spaces: [],
    credentialPermissionLevel: "read",
    effectivePermissionLevel: "read",
  };
};
