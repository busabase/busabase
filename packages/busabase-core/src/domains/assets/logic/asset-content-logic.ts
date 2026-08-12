import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { type BusabaseDatabase, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { attachments } from "../../../db/schema";
import { ensureReady } from "../../../logic/seed";
import { busabaseAssets } from "../schema/assets";
import { assertAssetPermission } from "./asset-permissions";

/**
 * Where an asset's bytes currently live, plus the file metadata a caller needs
 * to serve or describe them. `url` is resolved on every call — it is a property
 * of the CURRENT storage configuration (local disk route, CDN base, presigned
 * S3), never something to persist. That is the whole point of addressing assets
 * by id: the id is durable, the location is not.
 */
export interface AssetContentLocation {
  assetId: string;
  /** Resolved via `storage.getPublicUrl(storageKey)` — valid for this request only. */
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
}

/**
 * Which tenant owns this asset id, or null if no asset carries it.
 *
 * **Why a multi-tenant host needs this, and why it is not a hole.** Every other
 * busabase-core read runs INSIDE a space context and filters by it; this one
 * deliberately runs before any context exists, because on a multi-tenant host
 * (Busabase Cloud) the space is not known yet. A `/api/assets/{id}/raw`
 * request arrives as a plain browser `<img>` fetch: no `x-busabase-space`
 * header, no referrer worth trusting, nothing but a globally unique asset id.
 * The host has to learn WHICH tenant context to enter before it can ask the ACL
 * anything at all.
 *
 * So the contract of this function is narrow on purpose:
 *  - it returns a routing hint (a space id) and NOTHING about the asset;
 *  - it makes no access decision, and its result is never handed to the caller
 *    of the HTTP route — it only selects the context that `resolveAssetContent`
 *    then runs the real ACL inside;
 *  - it is not an existence oracle, because the route answers 404 identically
 *    for "no such asset" and "found, but the ACL refused".
 *
 * Note what is NOT being claimed: the asset id is not a capability. `id("ast")`
 * is a timestamp plus seven `Math.random()` base36 characters — fine as a
 * primary key, not a secret. Holding an id therefore grants nothing on its own;
 * every read still has to survive `assertAssetPermission` inside the owning
 * tenant's context. This lookup only decides WHICH tenant gets asked.
 */
export const findAssetSpaceId = async (
  db: BusabaseDatabase,
  assetId: string,
): Promise<string | null> => {
  if (!assetId) return null;
  const [row] = await db
    .select({ spaceId: busabaseAssets.spaceId })
    .from(busabaseAssets)
    .where(eq(busabaseAssets.id, assetId))
    .limit(1);
  return row?.spaceId ?? null;
};

/**
 * Resolve an asset's current byte location, after the standard asset ACL.
 *
 * Authority follows mounted usages (see `assertAssetPermission`): a read needs
 * one usage the caller can see. A Doc-embedded image gets an `ownerType: "doc"`
 * usage from `syncDocAssetUsages`, so a publicly shared Doc's images resolve for
 * an anonymous visitor exactly as far as the Doc itself does — and no further.
 *
 * Throws `ORPCError("NOT_FOUND")` for an unknown, deleted, cross-space, or
 * invisible asset (the ACL deliberately does not distinguish "does not exist"
 * from "you may not see it").
 */
export const resolveAssetContent = async (assetId: string): Promise<AssetContentLocation> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  await assertAssetPermission(assetId, "read", db);

  const [row] = await db
    .select({
      id: busabaseAssets.id,
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      contentHash: attachments.contentHash,
    })
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: `Asset not found: ${assetId}` });
  }

  return {
    assetId: row.id,
    url: storage.getPublicUrl(row.storageKey),
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
  };
};
