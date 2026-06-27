import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { deleteAttachmentSafely } from "open-domains/attachments/logic";
import { storage } from "openlib/storage";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import { attachments, busabaseBaseFields, busabaseBases, busabaseNodes } from "../../db/schema";
import { id } from "../../logic/kernel";
import { ensureReady } from "../../logic/store";
import { busabaseAssets, busabaseAssetUsages } from "./schema/assets";
import type { AssetDetailVO, AssetUsageVO, AssetVO } from "./types";

interface AssetRow {
  id: string;
  attachmentId: string;
  name: string;
  createdAt: Date;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
}

const toAssetVO = (row: AssetRow, usageCount: number): AssetVO => ({
  id: row.id,
  attachmentId: row.attachmentId,
  name: row.name,
  fileName: row.fileName,
  mimeType: row.mimeType,
  size: row.sizeBytes,
  url: storage.getPublicUrl(row.storageKey),
  contentHash: row.contentHash,
  usageCount,
  createdAt: row.createdAt.toISOString(),
});

const assetRowColumns = {
  id: busabaseAssets.id,
  attachmentId: busabaseAssets.attachmentId,
  name: busabaseAssets.name,
  createdAt: busabaseAssets.createdAt,
  storageKey: attachments.storageKey,
  fileName: attachments.fileName,
  mimeType: attachments.mimeType,
  sizeBytes: attachments.sizeBytes,
  contentHash: attachments.contentHash,
};

/**
 * Get-or-create the library entry for a (deduped) attachment in the current
 * space. Idempotent: a deduped re-upload resolves to the same `attachmentId`
 * and therefore the same asset. Called after an attachment upload is confirmed.
 */
export const ensureAsset = async (attachmentId: string, name: string): Promise<string> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Insert-first: the common "new asset" path is a single query. `returning` is
  // empty only when the (space, attachment) unique index conflicts — i.e. the asset
  // already exists (deduped re-upload / re-referenced file) — so we read it then.
  const assetId = id("ast");
  const [inserted] = await db
    .insert(busabaseAssets)
    .values({ id: assetId, attachmentId, name, createdBy: resolveActorId("local-producer") })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    return inserted.id;
  }
  const [existing] = await db
    .select({ id: busabaseAssets.id })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.spaceId, spaceId), eq(busabaseAssets.attachmentId, attachmentId)))
    .limit(1);
  return existing?.id ?? assetId;
};

export const listAssets = async (): Promise<AssetVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const rows: AssetRow[] = await db
    .select(assetRowColumns)
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(eq(busabaseAssets.spaceId, spaceId))
    .orderBy(desc(busabaseAssets.createdAt));

  const counts: { assetId: string; count: number }[] = await db
    .select({
      assetId: busabaseAssetUsages.assetId,
      count: sql<number>`count(*)::int`,
    })
    .from(busabaseAssetUsages)
    .where(eq(busabaseAssetUsages.spaceId, spaceId))
    .groupBy(busabaseAssetUsages.assetId);
  const countByAsset = new Map(counts.map((c) => [c.assetId, c.count]));

  return rows.map((row) => toAssetVO(row, countByAsset.get(row.id) ?? 0));
};

export const getAsset = async (assetId: string): Promise<AssetDetailVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const [row] = await db
    .select(assetRowColumns)
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!row) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  const usageRows = await db
    .select({
      nodeId: busabaseAssetUsages.nodeId,
      recordId: busabaseAssetUsages.recordId,
      fieldSlug: busabaseAssetUsages.fieldSlug,
      createdAt: busabaseAssetUsages.createdAt,
      nodeName: busabaseNodes.name,
      nodeType: busabaseNodes.type,
      nodeSlug: busabaseNodes.slug,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseNodes, eq(busabaseAssetUsages.nodeId, busabaseNodes.id))
    .where(eq(busabaseAssetUsages.assetId, assetId))
    .orderBy(desc(busabaseAssetUsages.createdAt));

  const usages: AssetUsageVO[] = usageRows.map((u) => ({
    nodeId: u.nodeId,
    nodeName: u.nodeName,
    nodeType: u.nodeType,
    nodeSlug: u.nodeSlug,
    recordId: u.recordId === "" ? null : u.recordId,
    fieldSlug: u.fieldSlug === "" ? null : u.fieldSlug,
    createdAt: u.createdAt.toISOString(),
  }));

  return { asset: toAssetVO(row, usages.length), usages };
};

/**
 * Delete an asset from the library. Refused while it is still referenced (the
 * Where-Used index doubles as the delete guard). On success removes the asset row
 * and, via `deleteAttachmentSafely`, the stored object iff no other registry row
 * (e.g. another space's deduped copy) still points at the same bytes.
 */
export const deleteAsset = async (assetId: string): Promise<{ deleted: boolean }> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const [asset] = await db
    .select({ id: busabaseAssets.id, attachmentId: busabaseAssets.attachmentId })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!asset) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  const [usageCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseAssetUsages)
    .where(eq(busabaseAssetUsages.assetId, assetId));
  if ((usageCount?.count ?? 0) > 0) {
    throw new Error(
      `Asset is still referenced by ${usageCount?.count} place(s); remove those references first.`,
    );
  }

  await db.delete(busabaseAssets).where(eq(busabaseAssets.id, assetId));
  await deleteAttachmentSafely(asset.attachmentId, db, attachments);
  return { deleted: true };
};

// --- where-used sync (Base attachment fields) ------------------------------

interface AttachmentFieldRef {
  id?: unknown;
  fileName?: unknown;
}

/** Pull `{ attachmentId, fileName }` out of an attachment cell (array of refs). */
const extractAttachmentRefs = (value: unknown): { attachmentId: string; fileName: string }[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: { attachmentId: string; fileName: string }[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const ref = item as AttachmentFieldRef;
      if (typeof ref.id === "string" && ref.id) {
        refs.push({
          attachmentId: ref.id,
          fileName: typeof ref.fileName === "string" ? ref.fileName : ref.id,
        });
      }
    }
  }
  return refs;
};

/**
 * Reconcile the where-used index for one merged Base record: for every
 * attachment-type field, ensure each referenced file has a library asset and
 * record a usage row against the Base's node. Replace semantics — stale rows for
 * this record are cleared first, so removing a file from a record drops its usage.
 * Called from the Base record merge handlers (canonical state only, never CR previews).
 */
export const syncRecordAssetUsages = async (
  baseId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  const db = await getDb();

  const [base] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, baseId))
    .limit(1);
  if (!base) {
    return;
  }

  const fieldRows = await db
    .select({ slug: busabaseBaseFields.slug, type: busabaseBaseFields.type })
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, baseId));
  const attachmentSlugs = new Set(
    fieldRows.filter((f) => f.type === "attachment").map((f) => f.slug),
  );

  const rows: {
    id: string;
    assetId: string;
    nodeId: string;
    recordId: string;
    fieldSlug: string;
  }[] = [];
  for (const [fieldSlug, value] of Object.entries(fields)) {
    if (!attachmentSlugs.has(fieldSlug)) {
      continue;
    }
    for (const ref of extractAttachmentRefs(value)) {
      const assetId = await ensureAsset(ref.attachmentId, ref.fileName);
      rows.push({ id: id("aus"), assetId, nodeId: base.nodeId, recordId, fieldSlug });
    }
  }

  // Replace usages for this record (idempotent re-merge; dropped files vanish).
  await db.delete(busabaseAssetUsages).where(eq(busabaseAssetUsages.recordId, recordId));
  if (rows.length > 0) {
    await db.insert(busabaseAssetUsages).values(rows).onConflictDoNothing();
  }
};

/** Drop every where-used row for a record (called when the record is deleted). */
export const removeRecordAssetUsages = async (recordId: string): Promise<void> => {
  const db = await getDb();
  await db.delete(busabaseAssetUsages).where(eq(busabaseAssetUsages.recordId, recordId));
};

/**
 * Reconcile the where-used index for a Doc node from its markdown body: an
 * attachment is "used" by a Doc when its storageKey appears in the body (the key
 * is embedded in any public/proxy URL the editor inserts). Whole-node usage, so
 * `recordId`/`fieldSlug` are "". Replace semantics — re-merging the Doc refreshes
 * its usages, and removing an embed drops the usage. Called from the Doc merge.
 */
export const syncDocAssetUsages = async (nodeId: string, body: string): Promise<void> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();

  // Robust-but-O(space attachments): scan every attachment and test body.includes.
  // Doc merges are infrequent so this is fine for now; if a space grows to many
  // thousands of attachments, switch to extracting candidate storageKeys from the
  // body (e.g. /attachments\/[^\s")']+/) and querying only those.
  const candidates: { id: string; storageKey: string; fileName: string }[] = await db
    .select({
      id: attachments.id,
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
    })
    .from(attachments)
    .where(eq(attachments.spaceId, spaceId));

  const rows: {
    id: string;
    assetId: string;
    nodeId: string;
    recordId: string;
    fieldSlug: string;
  }[] = [];
  for (const att of candidates) {
    if (att.storageKey && body.includes(att.storageKey)) {
      const assetId = await ensureAsset(att.id, att.fileName);
      rows.push({ id: id("aus"), assetId, nodeId, recordId: "", fieldSlug: "" });
    }
  }

  // Replace the Doc's whole-node usages (recordId/fieldSlug both "").
  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.nodeId, nodeId),
        eq(busabaseAssetUsages.recordId, ""),
        eq(busabaseAssetUsages.fieldSlug, ""),
      ),
    );
  if (rows.length > 0) {
    await db.insert(busabaseAssetUsages).values(rows).onConflictDoNothing();
  }
};
