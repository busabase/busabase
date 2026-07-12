import "server-only";

import { ORPCError } from "@orpc/server";
import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
} from "busabase-contract/domains/filetree/contract";
import type { ChangeRequestVO, FileTreeFileVO, FileTreeNodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { confirmUpload, requestUploadUrl } from "open-domains/attachments/logic";
import { storage } from "openlib/storage";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../context";
import { getDb } from "../../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  type busabaseOperationKindEnum,
  busabaseOperations,
  type CommitPO,
  type NodePO,
  type OperationPO,
} from "../../db/schema";
import { CURRENT_USER_ID, hashBuffer, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../logic/live-events";
import type { MaterializeArgs } from "../../logic/materialize";
import { ensureReady } from "../../logic/seed";
import {
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  recordPendingNodeCreate,
  toNodeVO,
} from "../../logic/store";
import {
  contentKindForMimeType,
  createAsset,
  deleteAssetRow,
  replaceAssetUsageRows,
  resolveAssetFile,
} from "../assets/handlers";
import { handleAssetAttachmentRepoint } from "../assets/logic/asset-texts-logic";
import type { AssetUsageOwnerType } from "../assets/schema/assets";
import {
  getFileTreeNode as getStorageFileTreeNode,
  mimeTypeForPath,
  normalizeFilePath,
} from "./logic/storage";

export interface FileTreeSeedInput {
  slug: string;
  name: string;
  description: string;
  version: string;
}

export interface FileTreeSeedFile {
  path: string;
  content: string;
}

export interface FileTreeKindConfig {
  type: "drive" | "skill" | "airapp";
  label: string;
  entryFile: string;
  seedFiles: (input: FileTreeSeedInput) => FileTreeSeedFile[];
}

interface StoredFileInput {
  path: string;
  content?: string;
  assetId?: string;
  displayName?: string;
  mimeType?: string;
}

const labelLower = (config: FileTreeKindConfig) => config.label.toLowerCase();

const labelForType = (type: string) => `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;

const operationKindForInput = (
  type: string,
  kind: "create" | "update" | "delete" | "metadata_update",
): (typeof busabaseOperationKindEnum.enumValues)[number] => {
  if (kind === "metadata_update") {
    return `${type}_metadata_update` as (typeof busabaseOperationKindEnum.enumValues)[number];
  }
  return `${type}_file_${kind}` as (typeof busabaseOperationKindEnum.enumValues)[number];
};

// Maps a file-tree kind's `type` to its Asset usage owner type. Every file-tree
// kind (drive/skill/airapp/…) is its own `AssetUsageOwnerType` so asset-usage
// rows stay correctly tagged — a prior version of this function collapsed
// anything that wasn't "skill" into "drive", silently mis-tagging every other
// file-tree kind's files as Drive files in the asset-usage index.
const usageOwnerType = (configOrType: FileTreeKindConfig | string): AssetUsageOwnerType => {
  const type = typeof configOrType === "string" ? configOrType : configOrType.type;
  if (type === "skill" || type === "drive" || type === "airapp") {
    return type;
  }
  throw new Error(`Unsupported file-tree kind for asset usage: ${type}`);
};

const normalizeUsagePath = (filePath: string) => normalizeFilePath(filePath);

/**
 * Resolves the file set to seed a new file-tree node with, given whatever
 * files the caller provided and the config's default seed template.
 *
 * "merge" (default): layers `providedFiles` on top of `config.seedFiles()`'s
 * output by path — a caller supplying just a couple of extra files (e.g. a
 * Skill's own reference doc) still gets the rest of the default scaffold
 * (SKILL.md, skill.json, ...) for any path they didn't provide themselves.
 * "replace": `providedFiles` (when non-empty) replaces the defaults
 * entirely — for a caller handing over a complete, different-shaped project
 * (e.g. an AirApp seeded with a Vite project instead of the default Hono
 * template) who does not want unrelated default files with unrelated
 * content mixed in. Only ever falls back to the config's defaults alone
 * when the caller provided no files at all.
 */
const resolveSeedFiles = (
  config: FileTreeKindConfig,
  input: FileTreeSeedInput,
  providedFiles: StoredFileInput[],
  mergeMode: "merge" | "replace",
): StoredFileInput[] => {
  if (providedFiles.length === 0) {
    return config.seedFiles(input);
  }
  if (mergeMode === "replace") {
    return providedFiles;
  }
  const providedPaths = new Set(providedFiles.map((file) => normalizeUsagePath(file.path)));
  const defaults = config
    .seedFiles(input)
    .filter((file) => !providedPaths.has(normalizeUsagePath(file.path)));
  return [...defaults, ...providedFiles];
};

const displayNameForPath = (path: string) => path.split("/").at(-1) || path;

const createAttachmentFromBuffer = async (
  path: string,
  bytes: Buffer,
  mimeType: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  const contentHash = hashBuffer(bytes);
  const fileName = displayNameForPath(path);
  const requested = await requestUploadUrl(
    {
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      contentHash,
      context: "file-tree",
      spaceId: getContextSpaceId(),
    },
    resolveActorId("local"),
    tx,
    attachments,
  );
  if (!requested.duplicate) {
    await storage.uploadFileToKey(bytes, requested.storageKey, mimeType);
  }
  const confirmed = requested.attachmentId
    ? {
        attachmentId: requested.attachmentId,
        storageKey: requested.storageKey,
        publicUrl: requested.publicUrl,
        success: true,
      }
    : await confirmUpload(
        {
          storageKey: requested.storageKey,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
          contentHash,
          context: "file-tree",
          spaceId: getContextSpaceId(),
        },
        resolveActorId("local"),
        tx,
        attachments,
      );
  return confirmed.attachmentId;
};

// After a file-tree replace keeps the existing mounted Asset's identity (see
// `upsertFileAssetAtPath`), the Asset row minted moments earlier by the
// upload-confirm flow for `incoming` is left with zero usages. Clean it up
// opportunistically — but only if it's genuinely unused; if the caller passed
// an `assetId` that's already mounted somewhere else, leave it alone.
const deleteOrphanedUploadedAsset = async (
  assetId: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  const [usage] = await tx
    .select({ id: busabaseAssetUsages.id })
    .from(busabaseAssetUsages)
    .where(eq(busabaseAssetUsages.assetId, assetId))
    .limit(1);
  if (!usage) {
    await deleteAssetRow(assetId, tx);
  }
};

const findMountedAsset = async (
  node: NodePO,
  path: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  const [row] = await tx
    .select({
      usageId: busabaseAssetUsages.id,
      assetId: busabaseAssetUsages.assetId,
      attachmentId: busabaseAssets.attachmentId,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
        eq(busabaseAssetUsages.ownerType, usageOwnerType(node.type)),
        eq(busabaseAssetUsages.nodeId, node.id),
        eq(busabaseAssetUsages.path, path),
      ),
    )
    .limit(1);
  return row ?? null;
};

const mountAssetAtPath = async (
  node: NodePO,
  path: string,
  assetId: string,
  metadata: Record<string, unknown>,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  await replaceAssetUsageRows(
    {
      ownerType: usageOwnerType(node.type),
      nodeId: node.id,
      path,
    },
    [
      {
        ownerType: usageOwnerType(node.type),
        nodeId: node.id,
        path,
        assetId,
        metadata,
      },
    ],
    tx,
  );
};

/**
 * Run the Drive Grep Retrieval staleness hook in its own nested transaction
 * (a Postgres SAVEPOINT under `tx`, via drizzle's `tx.transaction()`) so a
 * failure inside it rolls back in isolation. A plain JS try/catch around the
 * hook alone is NOT enough: a failed statement poisons the surrounding
 * Postgres transaction for every statement after it (including the
 * mount/cleanup calls right after this one in `upsertFileAssetAtPath`) until
 * a ROLLBACK — only a real savepoint lets the rest of a legitimate file
 * replace still commit. Best-effort: logs and swallows either way.
 */
const runAssetAttachmentRepointHook = async (
  assetId: string,
  newAttachmentId: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  try {
    await tx.transaction(async (savepointTx) => {
      await handleAssetAttachmentRepoint(
        assetId,
        newAttachmentId,
        savepointTx as unknown as Awaited<ReturnType<typeof getDb>>,
      );
    });
  } catch (error) {
    console.error(
      `[filetree] handleAssetAttachmentRepoint failed for asset ${assetId} (non-fatal):`,
      error,
    );
  }
};

const upsertFileAssetAtPath = async (
  node: NodePO,
  input: StoredFileInput,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  const path = normalizeUsagePath(input.path);
  const existing = await findMountedAsset(node, path, tx);

  if (input.assetId) {
    const incoming = await resolveAssetFile(input.assetId, tx);
    if (existing) {
      const attachmentChanged = existing.attachmentId !== incoming.attachmentId;
      await tx
        .update(busabaseAssets)
        .set({
          attachmentId: incoming.attachmentId,
          name: input.displayName ?? incoming.fileName,
          contentKind: contentKindForMimeType(input.mimeType ?? incoming.mimeType),
          metadata: incoming.metadata ?? {},
        })
        .where(eq(busabaseAssets.id, existing.assetId));
      // Drive Grep Retrieval staleness hook: a repointed attachment may
      // invalidate derived text (flips to `stale`) or, for a pure text-kind
      // row, auto-re-register against the new bytes (never goes stale).
      // Isolated (savepoint) + best-effort: an unrelated failure in text
      // bookkeeping must never roll back — and lose — an otherwise valid,
      // already-applied file replacement.
      if (attachmentChanged) {
        await runAssetAttachmentRepointHook(existing.assetId, incoming.attachmentId, tx);
      }
      await mountAssetAtPath(
        node,
        path,
        existing.assetId,
        { displayName: input.displayName ?? incoming.fileName },
        tx,
      );
      if (incoming.id !== existing.assetId) {
        await deleteOrphanedUploadedAsset(incoming.id, tx);
      }
      return existing.assetId;
    }
    await mountAssetAtPath(
      node,
      path,
      incoming.id,
      { displayName: input.displayName ?? incoming.fileName },
      tx,
    );
    return incoming.id;
  }

  const content = input.content ?? "";
  const mimeType = input.mimeType ?? mimeTypeForPath(path);
  const bytes = Buffer.from(content, "utf8");
  const attachmentId = await createAttachmentFromBuffer(path, bytes, mimeType, tx);
  if (existing) {
    const attachmentChanged = existing.attachmentId !== attachmentId;
    await tx
      .update(busabaseAssets)
      .set({
        attachmentId,
        name: input.displayName ?? displayNameForPath(path),
        contentKind: "text",
        metadata: {},
      })
      .where(eq(busabaseAssets.id, existing.assetId));
    // Same isolation as the asset-based path above — never let text
    // bookkeeping abort a legitimate file replace.
    if (attachmentChanged) {
      await runAssetAttachmentRepointHook(existing.assetId, attachmentId, tx);
    }
    await mountAssetAtPath(
      node,
      path,
      existing.assetId,
      { displayName: input.displayName ?? displayNameForPath(path) },
      tx,
    );
    return existing.assetId;
  }

  const assetId = await createAsset(
    attachmentId,
    input.displayName ?? displayNameForPath(path),
    {
      contentKind: "text",
      metadata: {},
    },
    tx,
  );
  await mountAssetAtPath(
    node,
    path,
    assetId,
    { displayName: input.displayName ?? displayNameForPath(path) },
    tx,
  );
  return assetId;
};

export const writeFileTreeTextFile = async (
  node: NodePO,
  filePath: string,
  content: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
) => {
  const db = tx ?? (await getDb());
  await upsertFileAssetAtPath(node, { path: filePath, content }, db);
};

const deleteFileAssetAtPath = async (
  node: NodePO,
  path: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  await replaceAssetUsageRows(
    {
      ownerType: usageOwnerType(node.type),
      nodeId: node.id,
      path: normalizeUsagePath(path),
    },
    [],
    tx,
  );
};

const listAssetUsageFiles = async (node: NodePO): Promise<FileTreeFileVO[]> => {
  const db = await getDb();
  const rows = await db
    .select({
      path: busabaseAssetUsages.path,
      metadata: busabaseAssetUsages.metadata,
      updatedAt: busabaseAssetUsages.updatedAt,
      assetId: busabaseAssets.id,
      assetName: busabaseAssets.name,
      contentKind: busabaseAssets.contentKind,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
        eq(busabaseAssetUsages.ownerType, usageOwnerType(node.type)),
        eq(busabaseAssetUsages.nodeId, node.id),
      ),
    )
    .orderBy(asc(busabaseAssetUsages.path));

  return rows
    .filter((row) => row.path)
    .map((row) => ({
      path: row.path,
      name: row.path.split("/").at(-1) ?? row.path,
      size: row.sizeBytes,
      updatedAt: row.updatedAt.toISOString(),
      mimeType: row.mimeType,
      assetId: row.assetId,
      displayName:
        typeof row.metadata.displayName === "string"
          ? row.metadata.displayName
          : row.assetName || row.fileName,
    }));
};

export const createFileTreeNode = async (
  config: FileTreeKindConfig,
  input: z.input<typeof createFileTreeInputSchema>,
): Promise<FileTreeNodeVO | ChangeRequestVO> => {
  await ensureReady();
  const db = await getDb();
  const parsed = createFileTreeInputSchema.parse(input);
  const existing = await getStorageFileTreeNode(config.type, parsed.slug);
  if (existing) {
    return getFileTreeNode(config, existing.id);
  }

  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNode] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${parentNodeId}`);
  }

  // Review-first by default: propose the node as a pending node_create
  // ChangeRequest instead of materializing it immediately. Callers that don't
  // need human review (seed/migration scripts, an explicit no-review agent
  // task) pass `autoMerge: true` to keep today's instant-create behavior.
  if (!parsed.autoMerge) {
    return recordPendingNodeCreate({
      nodeType: config.type,
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      metadata: { visibility: parsed.visibility, version: parsed.version },
      initialFiles: parsed.files,
      mergeMode: parsed.mergeMode,
      message: `Create ${labelLower(config)} ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
  }

  const nodeId = id("nod");
  const createdAt = now();
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: config.type,
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    metadata: {
      entryFile: config.entryFile,
      visibility: parsed.visibility,
      version: parsed.version,
    },
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });

  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  if (!node) {
    throw new Error(`Failed to create ${labelLower(config)} node`);
  }

  const seedFiles = resolveSeedFiles(
    config,
    {
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
    },
    parsed.files,
    parsed.mergeMode,
  );
  for (const file of seedFiles) {
    await upsertFileAssetAtPath(node, file, db);
  }

  await recordMergedNodeCreate({
    nodeId,
    nodeType: config.type,
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    parentNodeId: parentNode.id,
    message: `Create ${labelLower(config)} ${parsed.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
  });
  return getFileTreeNode(config, nodeId);
};

export const getFileTreeNode = async (
  config: FileTreeKindConfig,
  nodeIdOrSlug: string,
): Promise<FileTreeNodeVO> => {
  await ensureReady();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  const nodeMap = await loadNodesByIds([node.id]);
  const nodeVO = nodeMap.get(node.id) ?? toNodeVO(node, null);
  const files = await listAssetUsageFiles(node);
  return {
    node: nodeVO,
    entryFile: node.metadata.entryFile || config.entryFile,
    visibility: node.metadata.visibility || "private",
    version: node.metadata.version || "0.1.0",
    files,
  };
};

export const listFileTreeNodes = async (config: FileTreeKindConfig) => {
  await ensureReady();
  const db = await getDb();
  const nodes = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, config.type),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map((node) => getFileTreeNode(config, node.id)));
};

export const listFileTreeFiles = async (config: FileTreeKindConfig, nodeIdOrSlug: string) => {
  await ensureReady();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  return listAssetUsageFiles(node);
};

export const readFileTreeFile = async (
  config: FileTreeKindConfig,
  nodeIdOrSlug: string,
  filePath: string,
) => {
  await ensureReady();
  const db = await getDb();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  const path = normalizeUsagePath(filePath);
  const [row] = await db
    .select({
      assetId: busabaseAssets.id,
      assetName: busabaseAssets.name,
      contentKind: busabaseAssets.contentKind,
      usageMetadata: busabaseAssetUsages.metadata,
      storageKey: attachments.storageKey,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      contentHash: attachments.contentHash,
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
        eq(busabaseAssetUsages.ownerType, usageOwnerType(config)),
        eq(busabaseAssetUsages.nodeId, node.id),
        eq(busabaseAssetUsages.path, path),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(`${config.label} file not found: ${path}`);
  }

  const isText = row.contentKind === "text";
  const content = isText ? (await storage.getObject(row.storageKey)).toString("utf8") : "";
  return {
    nodeId: node.id,
    path,
    encoding: isText ? ("utf8" as const) : ("url" as const),
    content,
    mimeType: row.mimeType,
    assetId: row.assetId,
    displayName:
      typeof row.usageMetadata.displayName === "string"
        ? row.usageMetadata.displayName
        : row.assetName || row.fileName,
    assetUrl: storage.getPublicUrl(row.storageKey),
    contentHash: row.contentHash ?? (isText ? hashBuffer(Buffer.from(content, "utf8")) : ""),
  };
};

export const createFileTreeChangeRequest = async (
  config: FileTreeKindConfig,
  nodeIdOrSlug: string,
  input: z.input<typeof createFileTreeChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  const parsed = createFileTreeChangeRequestInputSchema.parse(input);
  const changeRequestId = id("crq");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    status: "in_review",
    submittedBy: parsed.submittedBy,
    sourceMeta: withContextSourceMeta({ subject: config.type, nodeId: node.id }),
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const [position, operation] of parsed.operations.entries()) {
    const operationId = id("opr");
    const commitId = id("cmt");
    const operationKind = operationKindForInput(config.type, operation.kind);
    const filePath =
      operation.kind === "metadata_update" ? null : normalizeUsagePath(operation.path);
    let fields: Record<string, unknown>;
    if (operation.kind === "metadata_update") {
      fields = { metadata: operation.metadata };
    } else if (operation.kind === "delete") {
      fields = {
        filePath,
        baseContentHash: operation.baseContentHash ?? null,
        nextContent: null,
        encoding: null,
        mimeType: null,
      };
    } else if ("assetId" in operation) {
      const asset = await resolveAssetFile(operation.assetId);
      fields = {
        filePath,
        baseContentHash: operation.baseContentHash ?? null,
        nextContent: null,
        encoding: "asset",
        mimeType: operation.mimeType ?? asset.mimeType,
        assetId: asset.id,
        displayName: operation.displayName ?? asset.fileName,
      };
    } else {
      fields = {
        filePath,
        baseContentHash: operation.baseContentHash ?? null,
        nextContent: operation.content,
        encoding: "utf8",
        mimeType: operation.mimeType ?? mimeTypeForPath(filePath ?? ""),
      };
    }

    await db.insert(busabaseCommits).values({
      id: commitId,
      baseId: null,
      targetType: "node",
      nodeId: node.id,
      operationId: null,
      parentCommitId: null,
      fields,
      operation: operationKind,
      message: parsed.message,
      author: parsed.submittedBy,
      createdAt: timestamp,
    });
    await db.insert(busabaseOperations).values({
      id: operationId,
      changeRequestId,
      baseId: null,
      targetType: "node",
      nodeId: node.id,
      operation: operationKind,
      status: "pending",
      targetRecordId: null,
      targetViewId: null,
      filePath,
      sourceRecordId: null,
      sourceCommitId: null,
      baseCommitId: null,
      headCommitId: commitId,
      deleteMode: "archive",
      mergedRecordId: null,
      mergedViewId: null,
      position,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  }

  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation: `${config.type}_update`, nodeId: node.id },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: null,
    changeRequestId,
    submittedBy: resolveActorId(parsed.submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error(`Failed to create ${labelLower(config)} change request`);
  }
  return changeRequest;
};

const readCurrentContentHash = async (
  node: NodePO,
  filePath: string,
  tx: Awaited<ReturnType<typeof getDb>>,
) => {
  const [row] = await tx
    .select({ contentHash: attachments.contentHash, storageKey: attachments.storageKey })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
        eq(busabaseAssetUsages.ownerType, usageOwnerType(node.type)),
        eq(busabaseAssetUsages.nodeId, node.id),
        eq(busabaseAssetUsages.path, normalizeUsagePath(filePath)),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row.contentHash ?? hashBuffer(await storage.getObject(row.storageKey));
};

export const mergeFileTreeFile = async (
  _ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  const operation = typeof item.operation === "string" ? item.operation : "";
  const [type, scope, action] = operation.split("_");
  if (node.type !== type || scope !== "file" || !item.filePath) {
    throw new Error(`Invalid file-tree file operation target: ${item.id}`);
  }
  const fields = headCommit.fields as {
    filePath?: string;
    baseContentHash?: string | null;
    nextContent?: string | null;
    nextContentBase64?: string | null;
    encoding?: "utf8" | "asset" | "base64" | null;
    mimeType?: string | null;
    assetId?: string | null;
    displayName?: string | null;
  };
  if (fields.baseContentHash) {
    const currentHash = await readCurrentContentHash(node, item.filePath, _ctx.db);
    if (currentHash !== fields.baseContentHash) {
      throw new ORPCError("CONFLICT", {
        message: `${labelForType(type)} file changed before merge: ${item.filePath}`,
      });
    }
  }
  if (action === "delete") {
    await deleteFileAssetAtPath(node, item.filePath, _ctx.db);
  } else if (fields.encoding === "base64" || fields.nextContentBase64 != null) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${labelForType(type)} legacy direct binary file commits are no longer supported. Upload binary files as Assets and merge an asset operation.`,
    });
  } else if (fields.encoding === "asset" && fields.assetId) {
    await upsertFileAssetAtPath(
      node,
      {
        path: item.filePath,
        assetId: fields.assetId,
        displayName: fields.displayName ?? undefined,
        mimeType: fields.mimeType ?? undefined,
      },
      _ctx.db,
    );
  } else {
    await upsertFileAssetAtPath(
      node,
      {
        path: item.filePath,
        content: fields.nextContent ?? "",
        mimeType: fields.mimeType ?? undefined,
      },
      _ctx.db,
    );
  }
};

export const mergeFileTreeMetadata = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  const operation = typeof item.operation === "string" ? item.operation : "";
  const [type, scope, action] = operation.split("_");
  if (node.type !== type || scope !== "metadata" || action !== "update") {
    throw new Error(`Invalid file-tree metadata operation target: ${item.id}`);
  }
  const fields = headCommit.fields as {
    metadata?: Partial<NonNullable<NodePO["metadata"]>>;
  };
  await ctx.db
    .update(busabaseNodes)
    .set({
      metadata: { ...node.metadata, ...(fields.metadata ?? {}) },
      updatedAt: ctx.timestamp,
    })
    .where(eq(busabaseNodes.id, node.id));
};

export const makeMaterializer =
  (config: FileTreeKindConfig) =>
  async (ctx: MergeCtx, args: MaterializeArgs): Promise<string> => {
    const { db, timestamp } = ctx;
    const { parentNode, fields } = args;
    const nodeId = id("nod");
    const slug = fields.slug as string;
    const name = fields.name as string;
    const description = fields.description ?? "";
    const metadata =
      typeof fields.metadata === "object" && fields.metadata !== null ? fields.metadata : {};
    const version =
      "version" in metadata && typeof metadata.version === "string" ? metadata.version : "0.1.0";
    // Carried through a review-first `createFileTreeNode` call's pending change
    // request (see `recordPendingNodeCreate`) — the Dashboard's generic
    // node_create flow never sets this, so it seeds only the config defaults.
    const initialFiles = Array.isArray(fields.initialFiles) ? fields.initialFiles : [];
    const mergeMode = fields.mergeMode ?? "merge";

    await db.insert(busabaseNodes).values({
      id: nodeId,
      parentId: parentNode.id,
      type: config.type,
      slug,
      name,
      description,
      metadata: {
        entryFile: config.entryFile,
        visibility: "private" as const,
        version,
        ...metadata,
      },
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const [node] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, nodeId))
      .limit(1);
    if (node) {
      // Mirrors createFileTreeNode's direct-write path — see resolveSeedFiles.
      const seedFiles = resolveSeedFiles(
        config,
        { slug, name, description, version },
        initialFiles,
        mergeMode,
      );
      for (const file of seedFiles) {
        await upsertFileAssetAtPath(node, file, db);
      }
    }
    return nodeId;
  };
