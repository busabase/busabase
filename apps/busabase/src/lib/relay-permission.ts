import {
  BUSABASE_RELAY_PERMISSION_LEVEL_HEADER,
  parseBusabaseRelayPermissionLevel,
} from "busabase-contract/access-control/api-key-level";
import type { BusabaseContext } from "busabase-core/context";

/** Apply a Cloud-authenticated API-key ceiling; direct local calls stay manager-compatible. */
export const resolveRelayPermissionContext = (
  headers: Headers,
): Pick<BusabaseContext, "isSpaceManager" | "permissionLevel" | "permissionLevelIsCeiling"> => {
  const permissionLevel = parseBusabaseRelayPermissionLevel(
    headers.get(BUSABASE_RELAY_PERMISSION_LEVEL_HEADER),
  );
  return permissionLevel
    ? {
        isSpaceManager: permissionLevel === "manage",
        permissionLevel,
        permissionLevelIsCeiling: true,
      }
    : {};
};
