import "server-only";

import { ORPCError } from "@orpc/server";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import { isPubliclyReadableNodeType } from "busabase-contract/domains";
import { and, eq } from "drizzle-orm";
import {
  getContextCredentialPermissionCeiling,
  getContextSpaceId,
  isAnonymousVisitor,
  resolveActorId,
} from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes } from "../../../db/schema";
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
    .select({
      nodeId: busabaseAssetUsages.nodeId,
      nodeType: busabaseNodes.type,
      archivedAt: busabaseNodes.archivedAt,
      deletedAt: busabaseNodes.deletedAt,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseAssetUsages.nodeId))
    .where(and(eq(busabaseAssetUsages.assetId, assetId), eq(busabaseAssetUsages.spaceId, spaceId)));
  const nodeIds = [...new Set(usages.map((usage) => usage.nodeId))];
  if (nodeIds.length === 0) {
    const creatorMayStageForChangeRequest =
      !isAnonymousVisitor() &&
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
    // Public runtime access does not grant generic access to AirApp source
    // assets. A shared asset may still be read through a legitimate public
    // File/Drive/Doc mount; use the actual mount type and active state, never a
    // caller hint. Public scopes can remain materialized on archived rows.
    if (
      isAnonymousVisitor() &&
      !usages.some(
        (usage) =>
          usage.nodeId === nodeId &&
          !usage.archivedAt &&
          !usage.deletedAt &&
          isPubliclyReadableNodeType(usage.nodeType),
      )
    )
      continue;
    if (await hasNodePermission(nodeId, required, undefined, db)) visible.add(nodeId);
  }
  if (required === "read" ? visible.size === 0 : visible.size !== nodeIds.length) {
    throw assetNotFound(assetId);
  }
  return visible;
};
