import "server-only";

import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { storage } from "openlib/storage";
import type { BusabaseDatabase } from "../../../context";
import { getContextSpaceId } from "../../../context";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseBases,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
} from "../../../db/schema";
import { docBodyKey } from "../../doc/handlers";
import { folderReadmeKey } from "../../folder/handlers";
import { busabaseAssetTexts } from "../schema/asset-texts";
import type { StorageCleanupKind } from "../schema/storage-cleanup-jobs";
import { extractAssetContentIds } from "../utils/asset-content-url";
import { enqueueStorageCleanup, withStorageKeyLocks } from "./storage-cleanup-logic";

/**
 * Permanent deletion owns only assets evidenced by its subtree. It never sweeps
 * unrelated, unmounted library uploads. Canonical record heads and Doc bodies
 * supplement the reverse index for legacy records/URLs that predate that index.
 * Archived content is deliberately included in both protection scans.
 */
export const releasePurgedNodeAssets = async (
  db: BusabaseDatabase,
  subtreeIds: string[],
  lockedKeys?: ReadonlySet<string>,
): Promise<void> => {
  const spaceId = getContextSpaceId();
  if (!lockedKeys) {
    // Discover without row locks, then take every physical fence in the same
    // lexical order as uploads and derived-text writes. Taking Asset row locks
    // first would deadlock a writer holding a fence while inserting its FK.
    const assets = await db
      .select({ attachmentId: busabaseAssets.attachmentId })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.spaceId, spaceId));
    const registered = await db
      .select({ key: attachments.storageKey })
      .from(attachments)
      .where(
        or(
          eq(attachments.spaceId, spaceId),
          assets.length
            ? inArray(
                attachments.id,
                assets.map((row) => row.attachmentId),
              )
            : undefined,
        ),
      );
    const texts = await db
      .select({ key: busabaseAssetTexts.textStorageKey })
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.spaceId, spaceId));
    const nodes = await db
      .select({ id: busabaseNodes.id, type: busabaseNodes.type })
      .from(busabaseNodes)
      .where(
        and(
          eq(busabaseNodes.spaceId, spaceId),
          inArray(busabaseNodes.id, subtreeIds),
          inArray(busabaseNodes.type, ["doc", "folder"]),
        ),
      );
    const keys = new Set([
      ...registered.map((row) => row.key),
      ...texts.map((row) => row.key),
      ...nodes.map((row) => (row.type === "folder" ? folderReadmeKey(row.id) : docBodyKey(row.id))),
    ]);
    return withStorageKeyLocks(db, [...keys], (tx) =>
      releasePurgedNodeAssets(tx, subtreeIds, keys),
    );
  }
  const purged = new Set(subtreeIds);
  const ownedAssets = await db
    .select()
    .from(busabaseAssets)
    .where(eq(busabaseAssets.spaceId, spaceId))
    .orderBy(busabaseAssets.id)
    .for("update");
  const ownedAttachments = await db
    .select()
    .from(attachments)
    .where(
      or(
        eq(attachments.spaceId, spaceId),
        ownedAssets.length
          ? inArray(
              attachments.id,
              ownedAssets.map((asset) => asset.attachmentId),
            )
          : undefined,
      ),
    );
  const assetById = new Map(ownedAssets.map((row) => [row.id, row]));
  if (ownedAttachments.some((row) => !lockedKeys.has(row.storageKey))) {
    throw new ORPCError("CONFLICT", {
      message: "Files changed while preparing permanent deletion. Retry the operation.",
    });
  }
  const candidates = new Set<string>();
  const protectedAssets = new Set<string>();
  const candidateAttachments = new Set<string>();
  const protectedAttachments = new Set<string>();

  const usages = await db
    .select({ assetId: busabaseAssetUsages.assetId, nodeId: busabaseAssetUsages.nodeId })
    .from(busabaseAssetUsages)
    .where(eq(busabaseAssetUsages.spaceId, spaceId));
  for (const usage of usages) {
    (purged.has(usage.nodeId) ? candidates : protectedAssets).add(usage.assetId);
  }

  // Head snapshots are the durable truth even when an old archive removed its
  // where-used rows. Never use old history belonging only to the purged scope
  // to keep its bytes indefinitely.
  const recordHeads = await db
    .select({ nodeId: busabaseBases.nodeId, payload: busabaseCommits.payload })
    .from(busabaseRecords)
    .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
    .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
    .where(and(eq(busabaseRecords.spaceId, spaceId), isNull(busabaseNodes.deletedAt)));

  const inspectBody = (body: string, deleting: boolean) => {
    const assetSet = deleting ? candidates : protectedAssets;
    const attachmentSet = deleting ? candidateAttachments : protectedAttachments;
    for (const assetId of extractAssetContentIds(body)) {
      if (assetById.has(assetId)) assetSet.add(assetId);
    }
    for (const attachment of ownedAttachments) {
      if (body === attachment.id || body.includes(attachment.storageKey)) {
        attachmentSet.add(attachment.id);
      }
    }
  };
  const inspectFields = (value: unknown, deleting: boolean): void => {
    if (typeof value === "string") {
      inspectBody(value, deleting);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) inspectFields(item, deleting);
      return;
    }
    if (!value || typeof value !== "object") return;
    const ref = value as Record<string, unknown>;
    const explicitId =
      typeof ref.assetId === "string"
        ? ref.assetId
        : typeof ref.id === "string" && assetById.has(ref.id)
          ? ref.id
          : null;
    if (explicitId && assetById.has(explicitId)) {
      // A rich attachment cell often includes assetId, attachmentId AND URL.
      // The explicit logical identity owns that reference. Treating its copied
      // physical identity as ownership of every alias leaks retired handles.
      (deleting ? candidates : protectedAssets).add(explicitId);
      return;
    }
    for (const child of Object.values(ref)) inspectFields(child, deleting);
  };
  for (const record of recordHeads) {
    inspectFields(record.payload.fields ?? record.payload, purged.has(record.nodeId));
  }

  const docs = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "doc"),
        isNull(busabaseNodes.deletedAt),
      ),
    );
  const folders = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "folder"),
        isNull(busabaseNodes.deletedAt),
      ),
    );
  // Reads are allowed here; all external DELETEs are durably queued below.
  // An unreadable retained Doc must not be mistaken for an empty document.
  for (const doc of docs) {
    try {
      const head = await storage.getObjectMetadata(docBodyKey(doc.id));
      if (!head) {
        // A missing live copy does not prove a legacy Doc is empty. The last
        // merged body is also stored in history and may still be recoverable.
        const [snapshot] = await db
          .select({ payload: busabaseCommits.payload })
          .from(busabaseCommits)
          .leftJoin(busabaseOperations, eq(busabaseOperations.headCommitId, busabaseCommits.id))
          .where(
            and(
              eq(busabaseCommits.nodeId, doc.id),
              inArray(busabaseCommits.operation, ["doc_update", "node_create"]),
              or(eq(busabaseOperations.status, "merged"), isNull(busabaseCommits.operationId)),
            ),
          )
          .orderBy(desc(busabaseCommits.createdAt))
          .limit(1);
        if (typeof snapshot?.payload.body === "string")
          inspectBody(snapshot.payload.body, purged.has(doc.id));
        continue;
      }
      inspectBody(
        (await storage.getObject(docBodyKey(doc.id))).toString("utf8"),
        purged.has(doc.id),
      );
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Unable to verify retained document attachments. Retry permanent deletion later.",
      });
    }
  }
  // Same protection scan for folder readmes. A missing object is an empty
  // readme, not a failure — most folders never had one.
  for (const folder of folders) {
    try {
      const head = await storage.getObjectMetadata(folderReadmeKey(folder.id));
      if (!head) {
        const [snapshot] = await db
          .select({ payload: busabaseCommits.payload })
          .from(busabaseCommits)
          .leftJoin(busabaseOperations, eq(busabaseOperations.headCommitId, busabaseCommits.id))
          .where(
            and(
              eq(busabaseCommits.nodeId, folder.id),
              inArray(busabaseCommits.operation, ["folder_update", "node_create"]),
              or(eq(busabaseOperations.status, "merged"), isNull(busabaseCommits.operationId)),
            ),
          )
          .orderBy(desc(busabaseCommits.createdAt))
          .limit(1);
        if (typeof snapshot?.payload.body === "string")
          inspectBody(snapshot.payload.body, purged.has(folder.id));
        continue;
      }
      inspectBody(
        (await storage.getObject(folderReadmeKey(folder.id))).toString("utf8"),
        purged.has(folder.id),
      );
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Unable to verify retained document attachments. Retry permanent deletion later.",
      });
    }
  }

  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, spaceId),
        inArray(busabaseAssetUsages.nodeId, subtreeIds),
      ),
    );
  const removableAssets = ownedAssets.filter(
    (asset) => candidates.has(asset.id) && !asset.retainInLibrary && !protectedAssets.has(asset.id),
  );
  if (removableAssets.length)
    await db
      .select({ id: busabaseAssets.id })
      .from(busabaseAssets)
      .where(
        inArray(
          busabaseAssets.id,
          removableAssets.map((asset) => asset.id),
        ),
      )
      .orderBy(busabaseAssets.id)
      .for("update");
  // Recheck globally: ids are tenant-unique, but malformed legacy cross-space
  // usage rows must still protect their bytes rather than cascade silently.
  const removableIds: string[] = [];
  for (const asset of removableAssets) {
    const [remaining] = await db
      .select({ id: busabaseAssetUsages.id })
      .from(busabaseAssetUsages)
      .where(eq(busabaseAssetUsages.assetId, asset.id))
      .limit(1);
    if (!remaining) removableIds.push(asset.id);
  }

  const derived = removableIds.length
    ? await db
        .select()
        .from(busabaseAssetTexts)
        .where(inArray(busabaseAssetTexts.assetId, removableIds))
    : [];
  if (derived.some((row) => !lockedKeys.has(row.textStorageKey))) {
    throw new ORPCError("CONFLICT", {
      message: "File text changed while preparing permanent deletion. Retry the operation.",
    });
  }
  for (const asset of ownedAssets) {
    if (removableIds.includes(asset.id)) candidateAttachments.add(asset.attachmentId);
  }
  if (removableIds.length)
    await db.delete(busabaseAssets).where(inArray(busabaseAssets.id, removableIds));

  const cleanup = new Map<
    string,
    {
      storageKey: string;
      sizeBytes: number;
      kind: StorageCleanupKind;
      spaceId: string;
    }
  >();
  for (const text of derived) {
    if (text.writtenBy === "auto") continue;
    const [remaining] = await db
      .select({ id: busabaseAssetTexts.id })
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.textStorageKey, text.textStorageKey))
      .limit(1);
    if (!remaining)
      cleanup.set(text.textStorageKey, {
        storageKey: text.textStorageKey,
        sizeBytes: text.byteCount,
        kind: "derived_text",
        spaceId,
      });
  }

  // Group by physical identity and acquire fences in a stable order. A new
  // Asset adoption shares this fence and is rechecked before registry removal.
  const keys = [
    ...new Set(
      ownedAttachments
        .filter((row) => candidateAttachments.has(row.id) && !protectedAttachments.has(row.id))
        .map((row) => row.storageKey),
    ),
  ].sort();
  for (const key of keys) {
    await withStorageKeyLocks(db, [key], async (tx) => {
      const rows = await tx
        .select()
        .from(attachments)
        .where(eq(attachments.storageKey, key))
        .for("update");
      const removeIds: string[] = [];
      for (const attachment of rows) {
        if (!candidateAttachments.has(attachment.id) || protectedAttachments.has(attachment.id))
          continue;
        const remainingAssets = await tx
          .select({ spaceId: busabaseAssets.spaceId })
          .from(busabaseAssets)
          .where(eq(busabaseAssets.attachmentId, attachment.id));
        if (remainingAssets.some((asset) => asset.spaceId === spaceId)) continue;
        if (attachment.spaceId !== null && attachment.spaceId !== spaceId) continue;
        if (remainingAssets.length) {
          // The physical object remains available to another space. Its Assets
          // retain their own billable ownership; the purged space relinquishes it.
          if (attachment.spaceId === spaceId)
            await tx
              .update(attachments)
              .set({ spaceId: null })
              .where(eq(attachments.id, attachment.id));
        } else removeIds.push(attachment.id);
      }
      if (removeIds.length && rows.every((row) => removeIds.includes(row.id))) {
        await enqueueStorageCleanup(tx, {
          storageKey: key,
          sizeBytes: Math.max(...rows.map((row) => row.sizeBytes)),
          kind: "attachment",
          spaceId,
        });
      }
      if (removeIds.length) await tx.delete(attachments).where(inArray(attachments.id, removeIds));
    });
  }
  for (const doc of docs) {
    if (purged.has(doc.id))
      cleanup.set(docBodyKey(doc.id), {
        storageKey: docBodyKey(doc.id),
        sizeBytes: 0,
        kind: "doc",
        spaceId,
      });
  }
  for (const folder of folders) {
    if (purged.has(folder.id))
      cleanup.set(folderReadmeKey(folder.id), {
        storageKey: folderReadmeKey(folder.id),
        sizeBytes: 0,
        kind: "folder",
        spaceId,
      });
  }
  for (const job of [...cleanup.values()].sort((a, b) =>
    a.storageKey.localeCompare(b.storageKey),
  )) {
    await enqueueStorageCleanup(db, job);
  }
};
