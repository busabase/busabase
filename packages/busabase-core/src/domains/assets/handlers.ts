import "server-only";

import { ORPCError } from "@orpc/server";
import type { AssetDetailVO, AssetUsageVO, AssetVO } from "busabase-contract/domains/assets/types";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  confirmUpload,
  deleteAttachmentSafely,
  requestUploadUrl,
} from "open-domains/attachments/logic";
import type { ConfirmUploadDTO, RequestUploadUrlDTO } from "open-domains/attachments/types";
import { storage } from "openlib/storage";
import { getContextSpaceId, resolveActorId } from "../../context";
import { db, getDb } from "../../db";
import { attachments, busabaseBaseFields, busabaseBases, busabaseNodes } from "../../db/schema";
import { insertAuditEvent } from "../../logic/audit";
import { id } from "../../logic/kernel";
import { ensureReady } from "../../logic/seed";
import {
  autoRegisterAssetText,
  deriveAssetTextStatus,
  gcTextObjectIfUnreferenced,
} from "./logic/asset-texts-logic";
import { type AssetTextStatus, busabaseAssetTexts } from "./schema/asset-texts";
import {
  type AssetContentKind,
  type AssetUsageOwnerType,
  busabaseAssets,
  busabaseAssetUsages,
} from "./schema/assets";

interface AssetRow {
  id: string;
  attachmentId: string;
  name: string;
  contentKind: AssetContentKind;
  metadata: Record<string, unknown>;
  createdAt: Date;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string | null;
  textStatus: AssetTextStatus | null;
}

interface UpdateAssetMetadataInput {
  assetId: string;
  metadata: Record<string, unknown>;
  mode?: "merge" | "replace";
}

export const contentKindForMimeType = (mimeType: string): AssetContentKind =>
  mimeType.startsWith("text/") ||
  mimeType.includes("json") ||
  mimeType.includes("xml") ||
  mimeType.includes("yaml") ||
  mimeType.includes("javascript") ||
  mimeType.includes("typescript")
    ? "text"
    : "binary";

export interface ResolvedAssetFile {
  id: string;
  attachmentId: string;
  name: string;
  contentKind: AssetContentKind;
  metadata: Record<string, unknown>;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  storageKey: string;
  contentHash: string | null;
}

const toAssetVO = (row: AssetRow, usageCount: number): AssetVO => ({
  id: row.id,
  attachmentId: row.attachmentId,
  name: row.name,
  contentKind: row.contentKind,
  metadata: row.metadata ?? {},
  fileName: row.fileName,
  mimeType: row.mimeType,
  size: row.sizeBytes,
  url: storage.getPublicUrl(row.storageKey),
  contentHash: row.contentHash,
  usageCount,
  textStatus: deriveAssetTextStatus(row.textStatus),
  createdAt: row.createdAt.toISOString(),
});

const assetRowColumns = {
  id: busabaseAssets.id,
  attachmentId: busabaseAssets.attachmentId,
  name: busabaseAssets.name,
  contentKind: busabaseAssets.contentKind,
  metadata: busabaseAssets.metadata,
  createdAt: busabaseAssets.createdAt,
  storageKey: attachments.storageKey,
  fileName: attachments.fileName,
  mimeType: attachments.mimeType,
  sizeBytes: attachments.sizeBytes,
  contentHash: attachments.contentHash,
  textStatus: busabaseAssetTexts.status,
};

/** `assetRowColumns` needs this LEFT JOIN (0..1 `busabase_asset_texts` row) for `textStatus`. */
const withAssetTextJoin = eq(busabaseAssetTexts.assetId, busabaseAssets.id);

const sanitizeUploadError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/([^:@/\s]+):([^@/\s]+)@/g, "//***:***@");
};

const assetUploadError = (action: string, error: unknown) => {
  if (error instanceof ORPCError) return error;
  const detail = sanitizeUploadError(error);
  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: `Failed to ${action}: ${detail}`,
    data: { error: `Failed to ${action}: ${detail}` },
  });
};

export const createAsset = async (
  attachmentId: string,
  name: string,
  options?: {
    contentKind?: AssetContentKind;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  },
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<string> => {
  const db = tx ?? (await getDb());
  const assetId = id("ast");
  const [inserted] = await db
    .insert(busabaseAssets)
    .values({
      id: assetId,
      attachmentId,
      name,
      contentKind: options?.contentKind ?? "binary",
      metadata: options?.metadata ?? {},
      createdBy: options?.createdBy ?? resolveActorId("local-producer"),
    })
    .returning();
  if (!inserted) throw new Error("Failed to create asset");
  return inserted.id;
};

/**
 * Compatibility helper for old inline attachment references that carry only an
 * `attachmentId`. New file flows should call `createAsset` so each logical file
 * gets its own stable identity even when Attachment bytes are deduped.
 */
export const ensureAsset = async (
  attachmentId: string,
  name: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<string> => {
  const db = tx ?? (await getDb());
  const spaceId = getContextSpaceId();
  const [existing] = await db
    .select({ id: busabaseAssets.id })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.spaceId, spaceId), eq(busabaseAssets.attachmentId, attachmentId)))
    .limit(1);
  return existing?.id ?? createAsset(attachmentId, name, undefined, db);
};

export const requestAssetUploadUrl = async (input: RequestUploadUrlDTO) => {
  try {
    const result = await requestUploadUrl(
      { ...input, spaceId: input.spaceId ?? getContextSpaceId() },
      resolveActorId("local"),
      db,
      attachments,
    );
    if (result.duplicate && result.attachmentId) {
      const assetId = await createAsset(result.attachmentId, input.fileName, {
        contentKind: contentKindForMimeType(input.mimeType),
      });
      return { ...result, assetId };
    }
    return result;
  } catch (error) {
    throw assetUploadError("create asset upload URL", error);
  }
};

export const confirmAssetUpload = async (input: ConfirmUploadDTO) => {
  try {
    const result = await confirmUpload(
      { ...input, spaceId: input.spaceId ?? getContextSpaceId() },
      resolveActorId("local"),
      db,
      attachments,
    );
    // Surface every uploaded file as a logical Asset. Attachment rows/objects may
    // dedupe by content hash, but Asset identity is not deduped.
    const contentKind = contentKindForMimeType(input.mimeType);
    const assetId = await createAsset(result.attachmentId, input.fileName, {
      contentKind,
      metadata:
        input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
          ? (input.metadata as Record<string, unknown>)
          : {},
    });
    // Drive Grep Retrieval: text-kind uploads are greppable immediately — the
    // row points at this asset's own bytes, no writer/scan needed. `contentKind`
    // and `knownMissing: true` (assetId was JUST minted above) are already
    // known here, so binary uploads pay zero extra queries for this. Isolated
    // in its own try/catch — a text-registration hiccup (e.g. the text table
    // briefly unavailable) must never fail an otherwise-successful upload.
    try {
      await autoRegisterAssetText(assetId, undefined, {
        knownContentKind: contentKind,
        knownMissing: true,
      });
    } catch (error) {
      console.warn(
        `[assets] autoRegisterAssetText failed for asset ${assetId} (non-fatal):`,
        error,
      );
    }
    return { ...result, assetId };
  } catch (error) {
    throw assetUploadError("confirm asset upload", error);
  }
};

export const listAssets = async (): Promise<AssetVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const rows: AssetRow[] = await db
    .select(assetRowColumns)
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .leftJoin(busabaseAssetTexts, withAssetTextJoin)
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
    .leftJoin(busabaseAssetTexts, withAssetTextJoin)
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!row) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  const usageRows = await db
    .select({
      ownerType: busabaseAssetUsages.ownerType,
      nodeId: busabaseAssetUsages.nodeId,
      path: busabaseAssetUsages.path,
      recordId: busabaseAssetUsages.recordId,
      fieldSlug: busabaseAssetUsages.fieldSlug,
      blockId: busabaseAssetUsages.blockId,
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
    ownerType: u.ownerType,
    nodeId: u.nodeId,
    nodeName: u.nodeName,
    nodeType: u.nodeType,
    nodeSlug: u.nodeSlug,
    path: u.path === "" ? null : u.path,
    recordId: u.recordId === "" ? null : u.recordId,
    fieldSlug: u.fieldSlug === "" ? null : u.fieldSlug,
    blockId: u.blockId === "" ? null : u.blockId,
    createdAt: u.createdAt.toISOString(),
  }));

  return { asset: toAssetVO(row, usages.length), usages };
};

export const resolveAssetFile = async (
  assetId: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<ResolvedAssetFile> => {
  await ensureReady();
  const db = tx ?? (await getDb());
  const spaceId = getContextSpaceId();

  const [row] = await db
    .select(assetRowColumns)
    .from(busabaseAssets)
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .leftJoin(busabaseAssetTexts, withAssetTextJoin)
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!row) {
    throw new Error(`Asset not found: ${assetId}`);
  }

  return {
    id: row.id,
    attachmentId: row.attachmentId,
    name: row.name,
    contentKind: row.contentKind,
    metadata: row.metadata ?? {},
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.sizeBytes,
    url: storage.getPublicUrl(row.storageKey),
    storageKey: row.storageKey,
    contentHash: row.contentHash,
  };
};

export const updateAssetMetadata = async (
  input: UpdateAssetMetadataInput,
): Promise<AssetDetailVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [asset] = await db
    .select({ id: busabaseAssets.id, metadata: busabaseAssets.metadata })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, input.assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!asset) {
    throw new Error(`Asset not found: ${input.assetId}`);
  }
  const nextMetadata =
    input.mode === "replace" ? input.metadata : { ...(asset.metadata ?? {}), ...input.metadata };
  await db
    .update(busabaseAssets)
    .set({ metadata: nextMetadata })
    .where(eq(busabaseAssets.id, input.assetId));
  await insertAuditEvent(db, {
    action: "asset.metadata_updated",
    metadata: { assetId: input.assetId, mode: input.mode },
  });
  return getAsset(input.assetId);
};

/**
 * Delete an Asset row. Refused while it is still referenced (the Where-Used
 * index doubles as the delete guard). `attachmentId` is a loose text ref, not
 * an FK — other Asset rows (e.g. two file names deduped onto one Attachment,
 * or the row we just repointed onto this Attachment during a file-tree
 * replace) can legitimately still point at the same bytes, so the physical
 * Attachment is only removed via `deleteAttachmentSafely` once no other
 * `busabase_assets` row references it.
 */
export const deleteAssetRow = async (
  assetId: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<{ deleted: boolean }> => {
  const db = tx ?? (await getDb());
  const spaceId = getContextSpaceId();

  const [asset] = await db
    .select({ id: busabaseAssets.id, attachmentId: busabaseAssets.attachmentId })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, spaceId)))
    .limit(1);
  if (!asset) {
    return { deleted: false };
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

  // Drive Grep Retrieval: `busabase_asset_texts.assetId` cascade-deletes with
  // the asset (`onDelete: "cascade"`), but nothing else garbage-collects the
  // derived-text blob that row pointed at — capture its identity BEFORE the
  // delete cascades the row away, since nothing can look it up afterward.
  const [textRow] = await db
    .select({
      textContentHash: busabaseAssetTexts.textContentHash,
      writtenBy: busabaseAssetTexts.writtenBy,
    })
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, assetId))
    .limit(1);

  await db.delete(busabaseAssets).where(eq(busabaseAssets.id, assetId));

  // Auto-registered rows never own a separate blob (they just point at the
  // asset's own attachment bytes, cleaned up below via `deleteAttachmentSafely`)
  // — only derived (`putText`-written) text has a content-addressed object
  // that can leak once its row is gone.
  if (textRow && textRow.writtenBy !== "auto" && textRow.textContentHash) {
    await gcTextObjectIfUnreferenced(textRow.textContentHash, null, db);
  }

  const [stillSharedByOtherAsset] = await db
    .select({ id: busabaseAssets.id })
    .from(busabaseAssets)
    .where(eq(busabaseAssets.attachmentId, asset.attachmentId))
    .limit(1);
  if (!stillSharedByOtherAsset) {
    await deleteAttachmentSafely(asset.attachmentId, db, attachments);
  }

  // Direct delete (no change request) — record it so the audit trail is complete.
  await insertAuditEvent(db, {
    action: "asset.deleted",
    metadata: { assetId, attachmentId: asset.attachmentId },
  });
  return { deleted: true };
};

export const deleteAsset = async (assetId: string): Promise<{ deleted: boolean }> => {
  const result = await deleteAssetRow(assetId);
  if (!result.deleted) {
    throw new Error(`Asset not found: ${assetId}`);
  }
  return result;
};

// --- where-used sync (Base attachment fields) ------------------------------

interface AttachmentFieldRef {
  attachmentId?: unknown;
  assetId?: unknown;
  id?: unknown;
  fileName?: unknown;
}

export interface AssetUsageInput {
  assetId: string;
  ownerType: AssetUsageOwnerType;
  nodeId: string;
  path?: string;
  recordId?: string;
  fieldSlug?: string;
  blockId?: string;
  metadata?: Record<string, unknown>;
}

export const replaceAssetUsageRows = async (
  where: {
    ownerType: AssetUsageOwnerType;
    nodeId: string;
    path?: string;
    recordId?: string;
    fieldSlug?: string;
    blockId?: string;
  },
  rows: AssetUsageInput[],
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<void> => {
  const db = tx ?? (await getDb());
  const conditions = [
    eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
    eq(busabaseAssetUsages.ownerType, where.ownerType),
    eq(busabaseAssetUsages.nodeId, where.nodeId),
  ];
  if (where.path !== undefined) conditions.push(eq(busabaseAssetUsages.path, where.path));
  if (where.recordId !== undefined) {
    conditions.push(eq(busabaseAssetUsages.recordId, where.recordId));
  }
  if (where.fieldSlug !== undefined) {
    conditions.push(eq(busabaseAssetUsages.fieldSlug, where.fieldSlug));
  }
  if (where.blockId !== undefined) conditions.push(eq(busabaseAssetUsages.blockId, where.blockId));

  await db.delete(busabaseAssetUsages).where(and(...conditions));
  if (rows.length > 0) {
    await db
      .insert(busabaseAssetUsages)
      .values(
        rows.map((row) => ({
          id: id("aus"),
          assetId: row.assetId,
          ownerType: row.ownerType,
          nodeId: row.nodeId,
          path: row.path ?? "",
          recordId: row.recordId ?? "",
          fieldSlug: row.fieldSlug ?? "",
          blockId: row.blockId ?? "",
          metadata: row.metadata ?? {},
        })),
      )
      .onConflictDoNothing();
  }
};

const isAssetId = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("ast");

/** Pull asset/attachment ids out of an attachment cell (array of refs). */
const extractAttachmentRefs = (
  value: unknown,
): { assetId: string | null; attachmentId: string | null; fileName: string }[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: { assetId: string | null; attachmentId: string | null; fileName: string }[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const ref = item as AttachmentFieldRef;
      const explicitAssetId = typeof ref.assetId === "string" && ref.assetId ? ref.assetId : null;
      const assetId = explicitAssetId ?? (isAssetId(ref.id) ? ref.id : null);
      const attachmentId =
        typeof ref.attachmentId === "string" && ref.attachmentId
          ? ref.attachmentId
          : !assetId && typeof ref.id === "string" && ref.id
            ? ref.id
            : null;
      if (assetId || attachmentId) {
        const fallbackName = attachmentId ?? assetId ?? "asset";
        refs.push({
          assetId,
          attachmentId,
          fileName: typeof ref.fileName === "string" ? ref.fileName : fallbackName,
        });
      }
    }
  }
  return refs;
};

const resolveAssetRef = async (
  ref: { assetId: string | null; attachmentId: string | null; fileName: string },
  tx: Awaited<ReturnType<typeof getDb>>,
): Promise<string | null> => {
  if (ref.assetId) {
    const [asset] = await tx
      .select({ id: busabaseAssets.id })
      .from(busabaseAssets)
      .where(
        and(eq(busabaseAssets.id, ref.assetId), eq(busabaseAssets.spaceId, getContextSpaceId())),
      )
      .limit(1);
    if (asset) {
      return asset.id;
    }
  }
  return ref.attachmentId ? ensureAsset(ref.attachmentId, ref.fileName, tx) : null;
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
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<void> => {
  const db = tx ?? (await getDb());

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
    ownerType: AssetUsageOwnerType;
    path?: string;
    recordId: string;
    fieldSlug: string;
    blockId?: string;
    metadata?: Record<string, unknown>;
  }[] = [];
  for (const [fieldSlug, value] of Object.entries(fields)) {
    if (!attachmentSlugs.has(fieldSlug)) {
      continue;
    }
    for (const ref of extractAttachmentRefs(value)) {
      const assetId = await resolveAssetRef(ref, db);
      if (assetId) {
        rows.push({
          id: id("aus"),
          assetId,
          ownerType: "base",
          nodeId: base.nodeId,
          recordId,
          fieldSlug,
        });
      }
    }
  }

  // Replace usages for this record (idempotent re-merge; dropped files vanish).
  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.recordId, recordId),
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
      ),
    );
  if (rows.length > 0) {
    await db.insert(busabaseAssetUsages).values(rows).onConflictDoNothing();
  }
};

/** Drop every where-used row for a record (called when the record is deleted). */
export const removeRecordAssetUsages = async (
  recordId: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<void> => {
  const db = tx ?? (await getDb());
  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.recordId, recordId),
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
      ),
    );
};

/**
 * Reconcile the where-used index for a Doc node from its markdown body: an
 * attachment is "used" by a Doc when its storageKey appears in the body (the key
 * is embedded in any public/proxy URL the editor inserts). Whole-node usage, so
 * `recordId`/`fieldSlug` are "". Replace semantics — re-merging the Doc refreshes
 * its usages, and removing an embed drops the usage. Called from the Doc merge.
 */
export const syncDocAssetUsages = async (
  nodeId: string,
  body: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<void> => {
  const db = tx ?? (await getDb());
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
    ownerType: AssetUsageOwnerType;
    nodeId: string;
    recordId: string;
    fieldSlug: string;
    blockId?: string;
    path?: string;
    metadata?: Record<string, unknown>;
  }[] = [];
  for (const att of candidates) {
    if (att.storageKey && body.includes(att.storageKey)) {
      const assetId = await ensureAsset(att.id, att.fileName, tx);
      rows.push({ id: id("aus"), assetId, ownerType: "doc", nodeId, recordId: "", fieldSlug: "" });
    }
  }

  // Replace the Doc's whole-node usages (recordId/fieldSlug both "").
  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.nodeId, nodeId),
        eq(busabaseAssetUsages.ownerType, "doc"),
        eq(busabaseAssetUsages.recordId, ""),
        eq(busabaseAssetUsages.fieldSlug, ""),
      ),
    );
  if (rows.length > 0) {
    await db.insert(busabaseAssetUsages).values(rows).onConflictDoNothing();
  }
};
