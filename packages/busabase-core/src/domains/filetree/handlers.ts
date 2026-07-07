import "server-only";

import { ORPCError } from "@orpc/server";
import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
} from "busabase-contract/domains/filetree/contract";
import type { FileTreeNodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import {
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
import type { MaterializeArgs } from "../../logic/materialize";
import {
  ensureReady,
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  toNodeVO,
} from "../../logic/store";
import {
  deleteTextFile,
  getFileTreeNode as getStorageFileTreeNode,
  listStorageFiles,
  mimeTypeForPath,
  normalizeFilePath,
  readFile,
  resolveStoragePrefix,
  storagePrefix,
  writeFile,
  writeTextFile,
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
  type: string;
  label: string;
  entryFile: string;
  seedFiles: (input: FileTreeSeedInput) => FileTreeSeedFile[];
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

const TEXT_FILE_EXTENSIONS = new Set([
  "c",
  "conf",
  "cpp",
  "cts",
  "bash",
  "css",
  "csv",
  "env",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "mts",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "srt",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const extensionForPath = (filePath: string) => filePath.split(".").pop()?.toLowerCase() ?? "";

const shouldReadAsText = (filePath: string, _content: Buffer) => {
  const ext = extensionForPath(filePath);
  if (TEXT_FILE_EXTENSIONS.has(ext)) {
    return true;
  }
  return false;
};

const decodeBase64Content = (contentBase64: string) => {
  const normalized = contentBase64.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid base64 file content" });
  }
  return Buffer.from(normalized, "base64");
};

const fileContentFromInput = (input: {
  content?: string;
  contentBase64?: string;
  mimeType?: string;
}) => {
  if (input.contentBase64 !== undefined) {
    return {
      content: decodeBase64Content(input.contentBase64),
      contentBase64: input.contentBase64.trim(),
      encoding: "base64" as const,
      mimeType: input.mimeType,
    };
  }
  return {
    content: Buffer.from(input.content ?? "", "utf8"),
    contentBase64: null,
    encoding: "utf8" as const,
    mimeType: input.mimeType,
  };
};

export const createFileTreeNode = async (
  config: FileTreeKindConfig,
  input: z.input<typeof createFileTreeInputSchema>,
) => {
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
      storagePrefix: storagePrefix(nodeId),
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

  const inputPaths = new Set(parsed.files.map((file) => normalizeFilePath(file.path)));
  for (const seedFile of config.seedFiles({
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
  })) {
    if (!inputPaths.has(normalizeFilePath(seedFile.path))) {
      await writeTextFile(node, seedFile.path, seedFile.content);
    }
  }
  for (const file of parsed.files) {
    const fileContent = fileContentFromInput(file);
    await writeFile(node, file.path, fileContent.content, fileContent.mimeType);
  }

  // Record the create as an auto-merged structural ChangeRequest (audit +
  // history + rollback), matching folder/base/doc creation and replacing the
  // old bespoke file-tree created audit events.
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
  const files = await listStorageFiles(node);
  return {
    node: nodeVO,
    storagePrefix: resolveStoragePrefix(node),
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
    .where(and(eq(busabaseNodes.type, config.type), isNull(busabaseNodes.archivedAt)))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map((node) => getFileTreeNode(config, node.id)));
};

export const listFileTreeFiles = async (config: FileTreeKindConfig, nodeIdOrSlug: string) => {
  await ensureReady();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  return listStorageFiles(node);
};

export const readFileTreeFile = async (
  config: FileTreeKindConfig,
  nodeIdOrSlug: string,
  filePath: string,
) => {
  await ensureReady();
  const node = await getStorageFileTreeNode(config.type, nodeIdOrSlug);
  if (!node) {
    throw new Error(`${config.label} not found: ${nodeIdOrSlug}`);
  }
  const path = normalizeFilePath(filePath);
  const bytes = await readFile(node, path);
  const readAsText = shouldReadAsText(path, bytes);
  return {
    nodeId: node.id,
    path,
    encoding: readAsText ? ("utf8" as const) : ("base64" as const),
    content: readAsText ? bytes.toString("utf8") : "",
    contentBase64: bytes.toString("base64"),
    mimeType: mimeTypeForPath(path),
    contentHash: hashBuffer(bytes),
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
    sourceMeta: { subject: config.type, nodeId: node.id },
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
      operation.kind === "metadata_update" ? null : normalizeFilePath(operation.path);
    let fields: Record<string, unknown>;
    if (operation.kind === "metadata_update") {
      fields = { metadata: operation.metadata };
    } else if (operation.kind === "delete") {
      fields = {
        filePath,
        baseContentHash: operation.baseContentHash ?? null,
        nextContent: null,
        nextContentBase64: null,
        encoding: null,
        mimeType: null,
      };
    } else {
      const fileContent = fileContentFromInput(operation);
      fields = {
        filePath,
        baseContentHash: operation.baseContentHash ?? null,
        nextContent: fileContent.encoding === "utf8" ? operation.content : null,
        nextContentBase64: fileContent.encoding === "base64" ? fileContent.contentBase64 : null,
        encoding: fileContent.encoding,
        mimeType: fileContent.mimeType ?? null,
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

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error(`Failed to create ${labelLower(config)} change request`);
  }
  return changeRequest;
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
    encoding?: "utf8" | "base64" | null;
    mimeType?: string | null;
  };
  if (fields.baseContentHash) {
    const currentContent = await readFile(node, item.filePath).catch(() => Buffer.alloc(0));
    if (hashBuffer(currentContent) !== fields.baseContentHash) {
      throw new ORPCError("CONFLICT", {
        message: `${labelForType(type)} file changed before merge: ${item.filePath}`,
      });
    }
  }
  if (action === "delete") {
    await deleteTextFile(node, item.filePath);
  } else if (fields.encoding === "base64" && fields.nextContentBase64 !== null) {
    await writeFile(
      node,
      item.filePath,
      decodeBase64Content(fields.nextContentBase64 ?? ""),
      fields.mimeType ?? undefined,
    );
  } else {
    await writeTextFile(node, item.filePath, fields.nextContent ?? "");
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

    await db.insert(busabaseNodes).values({
      id: nodeId,
      parentId: parentNode.id,
      type: config.type,
      slug,
      name,
      description,
      metadata: {
        storagePrefix: storagePrefix(nodeId),
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
      for (const file of config.seedFiles({ slug, name, description, version })) {
        await writeTextFile(node, file.path, file.content);
      }
    }
    return nodeId;
  };
