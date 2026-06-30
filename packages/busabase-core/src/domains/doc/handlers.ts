import "server-only";

import {
  createDocChangeRequestInputSchema,
  createDocInputSchema,
  updateDocInputSchema,
} from "busabase-contract/domains/doc/contract";
import type { NodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
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
// Doc handlers consume the kernel substrate one-way (no cycle). Doc is storage-backed,
// so it owns no DB tables — its body lives in object storage.
import { id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import {
  ensureReady,
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  toNodeVO,
} from "../../logic/store";
import { syncDocAssetUsages } from "../assets/handlers";

interface DocVO {
  node: NodeVO;
  storagePrefix: string;
  body: string;
}

const docStoragePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/doc/`;
const docBodyKey = (nodeId: string) => `${docStoragePrefix(nodeId)}doc.md`;

const writeDocBody = async (nodeId: string, body: string) => {
  await storage.uploadFileToKey(
    Buffer.from(body, "utf8"),
    docBodyKey(nodeId),
    "text/markdown; charset=utf-8",
  );
};

const readDocBody = async (nodeId: string) =>
  (await storage.getObject(docBodyKey(nodeId)).catch(() => Buffer.from(""))).toString("utf8");

const getDocNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .limit(1);
  const [node] =
    byId && byId.type === "doc"
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, "doc"),
              isNull(busabaseNodes.archivedAt),
            ),
          )
          .limit(1);
  return node ?? null;
};

const toDocVO = async (node: NodePO): Promise<DocVO> => {
  const nodeMap = await loadNodesByIds([node.id]);
  const nodeVO = nodeMap.get(node.id) ?? toNodeVO(node, null);
  return {
    node: nodeVO,
    storagePrefix: docStoragePrefix(node.id),
    body: await readDocBody(node.id),
  };
};

export const createDoc = async (input: z.input<typeof createDocInputSchema>): Promise<DocVO> => {
  await ensureReady();
  const db = await getDb();
  const parsed = createDocInputSchema.parse(input);
  const existing = await getDocNode(parsed.slug);
  if (existing) {
    return toDocVO(existing);
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
    type: "doc",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });
  await writeDocBody(nodeId, parsed.body || `# ${parsed.name}\n`);

  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  if (!node) {
    throw new Error("Failed to create doc node");
  }
  return toDocVO(node);
};

export const getDoc = async (nodeIdOrSlug: string): Promise<DocVO> => {
  await ensureReady();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Doc not found: ${nodeIdOrSlug}`);
  }
  return toDocVO(node);
};

export const listDocs = async (): Promise<DocVO[]> => {
  await ensureReady();
  const db = await getDb();
  const nodes = await db
    .select()
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.type, "doc"), isNull(busabaseNodes.archivedAt)))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map(toDocVO));
};

export const updateDocBody = async (
  nodeIdOrSlug: string,
  input: z.input<typeof updateDocInputSchema>,
): Promise<DocVO> => {
  await ensureReady();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Doc not found: ${nodeIdOrSlug}`);
  }
  const parsed = updateDocInputSchema.parse(input);
  await writeDocBody(node.id, parsed.body);
  return toDocVO(node);
};

// node_create materialization for a Doc node: the node + a seeded body file.
export const materializeDocNode = async (ctx: MergeCtx, args: MaterializeArgs): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "doc",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await writeDocBody(nodeId, `# ${fields.name}\n`);
  return nodeId;
};

registerMaterializer("doc", materializeDocNode);

// Doc edits are approval-first like everything in Busabase: a change request carrying a
// doc_update op whose commit holds the proposed body; merge writes it to storage.
export const createDocChangeRequest = async (
  nodeIdOrSlug: string,
  input: z.input<typeof createDocChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw new Error(`Doc not found: ${nodeIdOrSlug}`);
  }
  const parsed = createDocChangeRequestInputSchema.parse(input);
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    status: "in_review",
    submittedBy: parsed.submittedBy,
    sourceMeta: { subject: "doc", nodeId: node.id },
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    operationId: null,
    parentCommitId: null,
    fields: { body: parsed.body },
    operation: "doc_update",
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
    operation: "doc_update",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    filePath: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));

  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation: "doc_update", nodeId: node.id },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create doc change request");
  }
  return changeRequest;
};

// node-targeted merge handler for doc_update: write the proposed body to storage.
export const mergeDocUpdate = async (
  _ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.type !== "doc") {
    throw new Error(`Invalid doc operation target: ${item.id}`);
  }
  const fields = headCommit.fields as { body?: string };
  const body = fields.body ?? "";
  await writeDocBody(node.id, body);
  await syncDocAssetUsages(node.id, body);
};
