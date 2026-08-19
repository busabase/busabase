import "server-only";

import { ORPCError } from "@orpc/server";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import { and, eq } from "drizzle-orm";
import {
  getContextCredentialPermissionCeiling,
  getContextSpaceId,
  resolveActorId,
} from "../../../context";
import { getDb } from "../../../db";
import { hasNodePermission, hasWorkspacePermission } from "../../../logic/node-acl";
import { busabaseAssets, busabaseAssetUsages } from "../schema/assets";

const assetNotFound = (assetId: string) =>
  new ORPCError("NOT_FOUND", { message: `Asset not found: ${assetId}` });

/**
 * Asset authority follows mounted usages. Reads require one visible usage and
 * expose only those usages; mutations require authority on every usage.
 * Unmounted assets are visible only to workspace writers or their staging creator.
 */
export const assertAssetPermission = async (
  assetId: string,
  required: ApiKeyPermissionLevel,
  inputDb?: Awaited<ReturnType<typeof getDb>>,
): Promise<Set<string>> => {
  const db = inputDb ?? (await getDb());
  const spaceId = getContextSpaceId();
  const [asset] = await db
    .select({ id: busabaseAssets.id, createdBy: busabaseAssets.createdBy })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!asset) throw assetNotFound(assetId);

  const usages = await db
    .select({ nodeId: busabaseAssetUsages.nodeId })
    .from(busabaseAssetUsages)
    .where(and(eq(busabaseAssetUsages.assetId, assetId), eq(busabaseAssetUsages.spaceId, spaceId)));
  const nodeIds = [...new Set(usages.map((usage) => usage.nodeId))];
  if (nodeIds.length === 0) {
    const creatorMayStageForChangeRequest =
      asset.createdBy === resolveActorId("local-producer") &&
      hasApiKeyLevel("changeRequest", required) &&
      hasApiKeyLevel(getContextCredentialPermissionCeiling(), required);
    if (creatorMayStageForChangeRequest) return new Set();
    // An unmounted asset has no node to derive authority from, so somebody
    // else's staging upload is manager-only. `manage`, not `write`: a `member`
    // now carries a `write` workspace baseline, and it must not double as
    // "manager" here (same reasoning as `assertCanApproveChangeRequest`).
    if (!hasWorkspacePermission("manage")) throw assetNotFound(assetId);
    return new Set();
  }

  const visible = new Set<string>();
  for (const nodeId of nodeIds) {
    if (await hasNodePermission(nodeId, required, undefined, db)) visible.add(nodeId);
  }
  if (required === "read" ? visible.size === 0 : visible.size !== nodeIds.length) {
    throw assetNotFound(assetId);
  }
  return visible;
};
