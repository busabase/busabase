import "server-only";

import {
  createSkillChangeRequestInputSchema,
  createSkillInputSchema,
} from "busabase-contract/domains/skill/contract";
import type { SkillVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId } from "../../context";
import { getDb } from "../../db";
import {
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  type CommitPO,
  type NodePO,
  type OperationPO,
} from "../../db/schema";
// Skill handlers consume the kernel substrate (node tree + CR lifecycle + storage
// helpers + id/now) from the kernel residue. This is a one-way import — the kernel
// never imports skill handlers — so there is no cycle. The kernel keeps the skill
// storage helpers because the seed + merge dispatcher also use them.
import { hashText, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import {
  ensureReady,
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  toNodeVO,
} from "../../logic/store";
import {
  deleteSkillFile,
  getSkillNode,
  listSkillStorageFiles,
  normalizeSkillFilePath,
  readSkillTextFile,
  resolveSkillStoragePrefix,
  skillStoragePrefix,
  writeSkillTextFile,
} from "./logic/storage";

export const createSkill = async (input: z.input<typeof createSkillInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createSkillInputSchema.parse(input);
  const existing = await getSkillNode(parsed.slug);
  if (existing) {
    return getSkill(existing.id);
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
  const storagePrefix = skillStoragePrefix(nodeId);
  const createdAt = now();
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "skill",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    metadata: {
      storagePrefix,
      entryFile: "SKILL.md",
      visibility: parsed.visibility,
      version: parsed.version,
    },
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });

  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  /* v8 ignore start -- unreachable invariant: the node row was just inserted above */
  if (!node) {
    throw new Error("Failed to create skill node");
  }
  /* v8 ignore stop */

  const inputPaths = new Set(parsed.files.map((file) => normalizeSkillFilePath(file.path)));
  const defaultSkillMd = `---\nname: ${parsed.slug}\ndescription: ${parsed.description || parsed.name}\n---\n\n# ${parsed.name}\n\nUse this skill when you need to ${parsed.description || "run this workflow"}.\n`;
  const defaultManifest = JSON.stringify(
    {
      name: parsed.slug,
      description: parsed.description,
      version: parsed.version,
    },
    null,
    2,
  );

  if (!inputPaths.has("SKILL.md")) {
    await writeSkillTextFile(node, "SKILL.md", defaultSkillMd);
  }
  if (!inputPaths.has("skill.json")) {
    await writeSkillTextFile(node, "skill.json", `${defaultManifest}\n`);
  }
  for (const file of parsed.files) {
    await writeSkillTextFile(node, file.path, file.content);
  }

  // Direct create (no change request) — record it so the audit trail is complete.
  await insertAuditEvent(db, {
    action: "skill.created",
    metadata: { nodeId, slug: parsed.slug, name: parsed.name },
  });
  return getSkill(nodeId);
};

export const getSkill = async (nodeIdOrSlug: string): Promise<SkillVO> => {
  await ensureReady();
  const node = await getSkillNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Skill not found: ${nodeIdOrSlug}`);
  }
  const nodeMap = await loadNodesByIds([node.id]);
  const nodeVO = nodeMap.get(node.id) ?? toNodeVO(node, null);
  const files = await listSkillStorageFiles(node);
  return {
    node: nodeVO,
    storagePrefix: resolveSkillStoragePrefix(node),
    entryFile: node.metadata.entryFile || "SKILL.md",
    visibility: node.metadata.visibility || "private",
    version: node.metadata.version || "0.1.0",
    files,
  };
};

export const listSkills = async () => {
  await ensureReady();
  const db = await getDb();
  const nodes = await db
    .select()
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.type, "skill"), isNull(busabaseNodes.archivedAt)))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map((node) => getSkill(node.id)));
};

export const listSkillFiles = async (nodeIdOrSlug: string) => {
  await ensureReady();
  const node = await getSkillNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Skill not found: ${nodeIdOrSlug}`);
  }
  return listSkillStorageFiles(node);
};

export const readSkillFile = async (nodeIdOrSlug: string, filePath: string) => {
  await ensureReady();
  const node = await getSkillNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Skill not found: ${nodeIdOrSlug}`);
  }
  const path = normalizeSkillFilePath(filePath);
  const content = await readSkillTextFile(node, path);
  return {
    nodeId: node.id,
    path,
    content,
    contentHash: hashText(content),
  };
};

export const createSkillChangeRequest = async (
  nodeIdOrSlug: string,
  input: z.input<typeof createSkillChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const node = await getSkillNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Skill not found: ${nodeIdOrSlug}`);
  }
  const parsed = createSkillChangeRequestInputSchema.parse(input);
  const changeRequestId = id("crq");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    status: "in_review",
    submittedBy: parsed.submittedBy,
    sourceMeta: { subject: "skill", nodeId: node.id },
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
    const operationKind =
      operation.kind === "delete"
        ? "skill_file_delete"
        : operation.kind === "metadata_update"
          ? "skill_metadata_update"
          : operation.kind === "create"
            ? "skill_file_create"
            : "skill_file_update";
    const filePath =
      operation.kind === "metadata_update" ? null : normalizeSkillFilePath(operation.path);
    const fields =
      operation.kind === "metadata_update"
        ? { metadata: operation.metadata }
        : {
            filePath,
            baseContentHash: operation.baseContentHash ?? null,
            nextContent: operation.kind === "delete" ? null : operation.content,
          };

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
    metadata: { operation: "skill_update", nodeId: node.id },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  /* v8 ignore start -- unreachable invariant: the change request was just created above */
  if (!changeRequest) {
    throw new Error("Failed to create skill change request");
  }
  /* v8 ignore stop */
  return changeRequest;
};

// --- skill domain: file-tree + metadata merge handlers ----------------------
export const mergeSkillFile = async (
  _ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.type !== "skill" || !item.filePath) {
    throw new Error(`Invalid skill file operation target: ${item.id}`);
  }
  const fields = headCommit.fields as {
    filePath?: string;
    baseContentHash?: string | null;
    nextContent?: string | null;
  };
  if (fields.baseContentHash) {
    const currentContent = await readSkillTextFile(node, item.filePath).catch(() => "");
    if (hashText(currentContent) !== fields.baseContentHash) {
      throw new Error(`Skill file changed before merge: ${item.filePath}`);
    }
  }
  if (item.operation === "skill_file_delete") {
    await deleteSkillFile(node, item.filePath);
  } else {
    await writeSkillTextFile(node, item.filePath, fields.nextContent ?? "");
  }
};

export const mergeSkillMetadata = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.type !== "skill") {
    throw new Error(`Invalid skill metadata operation target: ${item.id}`);
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

// node_create materialization for a Skill node: the node + seeded storage files.
export const materializeSkillNode = async (
  ctx: MergeCtx,
  args: MaterializeArgs,
): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "skill",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    metadata: {
      storagePrefix: skillStoragePrefix(nodeId),
      entryFile: "SKILL.md",
      visibility: "private" as const,
      version: "0.1.0",
      ...fields.metadata,
    },
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  if (node) {
    await writeSkillTextFile(
      node,
      "SKILL.md",
      `---\nname: ${fields.slug}\ndescription: ${fields.description ?? fields.name}\n---\n\n# ${fields.name}\n`,
    );
    await writeSkillTextFile(
      node,
      "skill.json",
      `${JSON.stringify({ name: fields.slug, description: fields.description ?? "" }, null, 2)}\n`,
    );
  }
  return nodeId;
};

registerMaterializer("skill", materializeSkillNode);
