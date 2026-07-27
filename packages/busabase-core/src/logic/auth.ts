import "server-only";

import type { AuthInfo } from "busabase-contract/contract/schemas";
import {
  getContextRestrictedVisibility,
  getContextSpaceId,
  LOCAL_SPACE_ID,
  resolveActorId,
} from "../context";

/**
 * Auth verification info for the current request. In the open-source app there
 * are no user/member tables — every request runs as the single local owner of
 * the `local` space — so this synthesizes that local identity from the context
 * defaults. The cloud host (`apps/busabase-cloud`) overrides this handler on its
 * PUBLIC REST surface (`/api/v1/auth`) to return the real space/user/member
 * resolved from the verified user API key.
 *
 * Note it is NOT overridden on the cloud's internal RPC mount
 * (`/api/rpc/core/*`, which is what the mobile app talks to): that path runs
 * this exact function inside `withBusabaseContext`, so anything a client needs
 * from the host has to be read off the request context here. That is why
 * `nodeVisibilityMode` comes from `getContextRestrictedVisibility()` rather
 * than being hard-coded "open" — open source never sets the flag (so it stays
 * "open", unchanged), while a cloud space configured as Restricted reports it.
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
    nodeVisibilityMode: getContextRestrictedVisibility()
      ? ("restricted" as const)
      : ("open" as const),
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
