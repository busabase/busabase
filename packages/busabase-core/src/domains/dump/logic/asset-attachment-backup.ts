import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  ExportAssetAttachmentInput,
  ExportAssetAttachmentVO,
} from "busabase-contract/domains/dump/types";
import { and, eq, ne, sql } from "drizzle-orm";
import { storage } from "openlib/storage";
import { type BusabaseDatabase, getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets } from "../../../db/schema";
import { assertAssetPermission } from "../../assets/logic/asset-permissions";
import { requireSpaceManagerForDump } from "./_guard";

/** A snapshot-owned Asset row, never a caller-provided attachment capability. */
export interface AssetAttachmentBackupAnchor {
  id: string;
  attachmentId: string;
  spaceId: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** S3 grants expire within a day; local storage retains its normal URL policy. */
export const ASSET_ATTACHMENT_BACKUP_URL_TTL_SECONDS = 24 * 60 * 60;

const assetAnchorColumns = {
  id: busabaseAssets.id,
  attachmentId: busabaseAssets.attachmentId,
  spaceId: busabaseAssets.spaceId,
  createdBy: busabaseAssets.createdBy,
  createdAt: sql<string>`to_char(${busabaseAssets.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: sql<string>`to_char(${busabaseAssets.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

const isoDate = (value: Date | string): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new ORPCError("BAD_REQUEST", { message: "Asset backup anchor has an invalid timestamp" });
  }
  return value;
};

/**
 * Copy the readable content dependency, not the other tenant's attachment PO.
 *
 * The caller supplies the Asset row already read inside its SQL snapshot and
 * that SAME transaction. No singleton getDb()/nested transaction is used here.
 * An authorized snapshot may retain the resulting descriptor/URL after its
 * source Asset is removed; missing/changed physical bytes still fail the CLI's
 * length/hash checks. SQL MVCC does not claim to snapshot object storage.
 */
export const exportAssetAttachmentSnapshotDependency = async (
  db: BusabaseDatabase,
  asset: AssetAttachmentBackupAnchor,
): Promise<ExportAssetAttachmentVO> => {
  requireSpaceManagerForDump();
  const spaceId = getContextSpaceId();
  if (asset.spaceId !== spaceId || !asset.id || !asset.attachmentId) {
    throw new ORPCError("NOT_FOUND", { message: "Asset backup dependency not found" });
  }
  // The existing ACL accepts the concrete host DB type, but only reads its
  // query interface. A snapshot transaction provides that same interface.
  await assertAssetPermission(asset.id, "read", db as Awaited<ReturnType<typeof getDb>>);

  // These are exactly the attachment fields used by normal Asset content
  // resolution. Never select the physical row's owner, metadata or timestamps.
  // Owned/null legacy registrations already belong in the raw attachments dump.
  const [content] = await db
    .select({
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      contentHash: attachments.contentHash,
    })
    .from(attachments)
    .innerJoin(busabaseAssets, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(
        eq(busabaseAssets.id, asset.id),
        eq(busabaseAssets.spaceId, spaceId),
        eq(attachments.id, asset.attachmentId),
        ne(attachments.spaceId, spaceId),
      ),
    )
    .limit(1);
  if (!content) {
    throw new ORPCError("NOT_FOUND", { message: "Asset backup dependency not found" });
  }
  if (
    !content.storageKey.startsWith("attachments/") ||
    content.storageKey.split("/").includes("..") ||
    content.storageKey.includes("\\") ||
    content.storageKey.includes("\0") ||
    !Number.isSafeInteger(content.sizeBytes) ||
    content.sizeBytes < 0
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Asset backup content cannot be restored safely",
    });
  }

  return {
    assetId: asset.id,
    attachmentId: asset.attachmentId,
    downloadUrl: await storage.generatePresignedUrl(
      content.storageKey,
      ASSET_ATTACHMENT_BACKUP_URL_TTL_SECONDS,
    ),
    materializedAttachment: {
      id: asset.attachmentId,
      spaceId,
      ...content,
      context: "busabase-backup-dependency",
      userId: asset.createdBy,
      metadata: {
        busabaseBackupDependency: {
          version: 1,
          sourceAssetId: asset.id,
          sourceAttachmentId: asset.attachmentId,
          sourceSpaceId: spaceId,
          projection: "readable-asset-content",
          originalAttachmentOwnershipOmitted: true,
        },
      },
      createdAt: isoDate(asset.createdAt),
      updatedAt: isoDate(asset.updatedAt),
    },
  };
};

/** Asset-id-only endpoint; callers cannot provide a key or a projected receipt. */
export const exportAssetAttachment = async (
  input: ExportAssetAttachmentInput,
): Promise<ExportAssetAttachmentVO> => {
  requireSpaceManagerForDump();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    const [asset] = await transaction
      .select(assetAnchorColumns)
      .from(busabaseAssets)
      .where(and(eq(busabaseAssets.id, input.assetId), eq(busabaseAssets.spaceId, spaceId)))
      .limit(1);
    if (!asset) {
      throw new ORPCError("NOT_FOUND", { message: "Asset backup dependency not found" });
    }
    return exportAssetAttachmentSnapshotDependency(transaction, asset);
  });
};
