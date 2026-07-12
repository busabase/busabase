import "server-only";

import {
  createDocChangeRequestInputSchema,
  createDocInputSchema,
  updateDocInputSchema,
} from "busabase-contract/domains/doc/contract";
import type { ChangeRequestVO, NodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../context";
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
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../logic/live-events";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import { ensureReady } from "../../logic/seed";
import {
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  recordMergedOperation,
  recordPendingNodeCreate,
  toNodeVO,
} from "../../logic/store";
import { syncDocAssetUsages } from "../assets/handlers";

interface DocVO {
  node: NodeVO;
  storagePrefix: string;
  body: string;
}

const docStoragePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/doc/`;
// Exported so `logic/grep.ts`'s Docs adapter (Unified Grep P2a) can address
// the exact same storage object `readDocBody` reads, without depending on
// this module's swallow-to-empty error handling below (see `readDocBody`'s
// comment) — grep's honest-coverage contract needs a genuine storage failure
// to surface as `coverage.docs.errored`, not silently read as an empty body.
export const docBodyKey = (nodeId: string) => `${docStoragePrefix(nodeId)}doc.md`;

export const writeDocBody = async (nodeId: string, body: string) => {
  await storage.uploadFileToKey(
    Buffer.from(body, "utf8"),
    docBodyKey(nodeId),
    "text/markdown; charset=utf-8",
  );
};

// Swallows a missing/failed read to an empty body — the right default for
// this module's own callers (a Doc node can legitimately have no body object
// yet). `logic/grep.ts`'s Docs adapter deliberately does NOT reuse this
// swallow (it reads via `docBodyKey` directly, without `.catch`), since a
// storage error there must surface as `coverage.docs.errored`, not a clean
// "scanned, empty, no match".
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

export const createDoc = async (
  input: z.input<typeof createDocInputSchema>,
): Promise<DocVO | ChangeRequestVO> => {
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

  // Review-first by default: propose the Doc as a pending node_create
  // ChangeRequest instead of materializing it immediately. Callers that don't
  // need human review (seed/migration scripts, an explicit no-review agent
  // task) pass `autoMerge: true` to keep today's instant-create behavior.
  if (!parsed.autoMerge) {
    return recordPendingNodeCreate({
      nodeType: "doc",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      body: parsed.body,
      message: `Create doc ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
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
  // Record the create as an auto-merged structural ChangeRequest (audit + history
  // + rollback), replacing the old bespoke `doc.created` audit action.
  await recordMergedNodeCreate({
    nodeId,
    nodeType: "doc",
    slug: node.slug,
    name: node.name,
    description: node.description,
    parentNodeId: parentNode.id,
    message: `Create doc ${node.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
  });
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
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, "doc"),
        isNull(busabaseNodes.archivedAt),
      ),
    )
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
  // Record the body edit as an auto-merged doc_update ChangeRequest (audit +
  // history + rollback), replacing the old bespoke `doc.updated` audit action —
  // the same doc_update op shape the reviewed `createDocChangeRequest` path uses.
  await recordMergedOperation({
    operation: "doc_update",
    targetType: "node",
    nodeId: node.id,
    fields: { body: parsed.body },
    message: `Update doc ${node.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
    sourceMeta: withContextSourceMeta({ subject: "doc", nodeId: node.id }),
  });
  return toDocVO(node);
};

// node_create materialization for a Doc node: the node + a seeded body file.
// `fields.body` carries a review-first `createDoc` call's initial body through
// the pending change request (see `recordPendingNodeCreate`); the Dashboard's
// generic node_create flow never sets it, so it keeps the synthesized default.
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
  await writeDocBody(nodeId, fields.body || `# ${fields.name}\n`);
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
    sourceMeta: withContextSourceMeta({ subject: "doc", nodeId: node.id }),
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
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: null,
    changeRequestId,
    submittedBy: resolveActorId(parsed.submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create doc change request");
  }
  return changeRequest;
};

// node-targeted merge handler for doc_update: write the proposed body to storage.
export const mergeDocUpdate = async (
  ctx: MergeCtx,
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
  // Pass the merge executor so the asset-usage sync runs on the SAME transaction
  // (re-acquiring getDb() inside a tx would deadlock the single pglite connection).
  await syncDocAssetUsages(node.id, body, ctx.db);
};
