import "server-only";

import type { AuthInfo } from "busabase-contract/contract/schemas";
import { getContextSpaceId, LOCAL_SPACE_ID, resolveActorId } from "../context";

/**
 * Auth verification info for the current request. In the open-source app there
 * are no user/member tables — every request runs as the single local owner of
 * the `local` space — so this synthesizes that local identity from the context
 * defaults. The cloud host (`apps/busabase-cloud`) overrides this handler to
 * return the real space/user/member resolved from the verified user API key.
 */
export const getAuthInfo = (): AuthInfo => {
  const spaceId = getContextSpaceId();
  const actorId = resolveActorId("local-user");
  const isLocal = spaceId === LOCAL_SPACE_ID;
  const space = {
    id: spaceId,
    name: isLocal ? "Local Workspace" : spaceId,
    slug: isLocal ? "local" : null,
    plan: isLocal ? "local" : null,
  };
  return {
    space,
    user: {
      id: actorId,
      name: isLocal ? "Local User" : actorId,
      email: null,
      image: null,
    },
    member: {
      userId: actorId,
      spaceId,
      role: "owner",
    },
    // Single-tenant: the local owner belongs to exactly one space.
    spaces: [space],
  };
};
