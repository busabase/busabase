import "server-only";

import { ORPCError } from "@orpc/server";
import { listChangeRequestsPagedInputSchema } from "busabase-contract/contract/schemas";
import type {
  ChangeRequestVO,
  CommentVO,
  OperationVO,
  RecordVO,
  ReviewVO,
} from "busabase-contract/types";
import { and, asc, desc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getContextSpaceId, resolveActorId, resolveUserRefs } from "../context";
import { getDb } from "../db";
import type {
  BusabaseNodeType,
  ChangeRequestPO,
  CommitPO,
  NodePO,
  OperationPO,
  RecordPO,
  ReviewPO,
  ViewPO,
} from "../db/schema";
import {
  busabaseBases,
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
  busabaseReviews,
  busabaseViews,
} from "../db/schema";
import {
  mergeBaseAddField,
  mergeBaseArchive,
  mergeBaseConvertField,
  mergeBaseDeleteField,
  mergeBaseReorderFields,
  mergeBaseRestore,
  mergeBaseRestoreField,
  mergeBaseUpdateField,
  mergeRecordCreate as mergeRecordCreateBase,
  mergeRecordDelete as mergeRecordDeleteBase,
  mergeRecordRestore,
  mergeRecordUpdate as mergeRecordUpdateBase,
  mergeViewCreate as mergeViewCreateBase,
  mergeViewDelete as mergeViewDeleteBase,
  mergeViewRestore as mergeViewRestoreBase,
  mergeViewUpdate as mergeViewUpdateBase,
} from "../domains/base/handlers";
import { mergeDocUpdate } from "../domains/doc/handlers";
import { mergeFileTreeFile, mergeFileTreeMetadata } from "../domains/filetree/handlers";
import { insertAuditEvent } from "./audit";
import { projectCommitFields } from "./field-values";
import {
  CURRENT_USER_ID,
  id,
  listInputSchema,
  now,
  requireBaseId,
  rootNodeIdForSpace,
} from "./kernel";
import { publishBusabaseLiveEvent } from "./live-events";
import { getMaterializer, type MaterializeArgs, type NodeCreateFields } from "./materialize";
import { loadNodesByIds } from "./nodes";
import { ensureReady, loadBasesByIds } from "./seed";
import {
  normalizeViewConfig,
  toCommentVO,
  toCommitVO,
  toIso,
  toOperationVO,
  toReviewVO,
  toViewVO,
} from "./vo";
export { listInputSchema };

// ── Schemas ───────────────────────────────────────────────────────────────────

export const reviewInputSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

export const reviseOperationInputSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Revise operation"),
  author: z.string().optional().default("local-producer"),
  baseCommitId: z.string().optional(),
});

const changeRequestNotFound = (changeRequestId: string) =>
  new ORPCError("NOT_FOUND", {
    message: `ChangeRequest not found: ${changeRequestId}`,
  });

const changeRequestConflict = (message: string, data?: Record<string, unknown>) =>
  new ORPCError("CONFLICT", { message, ...(data ? { data } : {}) });

const changeRequestBadRequest = (message: string, data?: Record<string, unknown>) =>
  new ORPCError("BAD_REQUEST", { message, ...(data ? { data } : {}) });

// ── MergeCtx ─────────────────────────────────────────────────────────────────

export interface MergeCtx {
  db: Awaited<ReturnType<typeof getDb>>;
  timestamp: Date;
  /** Actor merging the change request — recorded for created_by / updated_by fields. */
  actorId: string;
  headCommitsById: Map<string, CommitPO>;
  targetRecordsById: Map<string, RecordPO>;
  targetViewsById: Map<string, ViewPO>;
  mergedNodeIds: string[];
  mergedRecordIds: string[];
  mergedViewIds: string[];
  // Temp-ref → real node id, populated as node_create operations materialize so
  // later operations in the SAME change request can point their parent at a node
  // this CR is itself creating (create-folder-then-fill-it in one submission).
  nodeRefs: Map<string, string>;
  // Auto-merged record fields (operationId → merged fields), set when a record
  // moved since the change request's base and a 3-way field merge resolved it.
  resolvedRecordFields: Map<string, Record<string, unknown>>;
}

// ── 3-way field merge ─────────────────────────────────────────────────────────

interface ThreeWayMergeResult {
  merged: Record<string, unknown>;
  conflicts: string[];
}

const stableFieldStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableFieldStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableFieldStringify(record[key])}`)
    .join(",")}}`;
};

const fieldValuesEqual = (left: unknown, right: unknown) =>
  stableFieldStringify(left) === stableFieldStringify(right);

const threeWayMergeFields = (
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>,
): ThreeWayMergeResult => {
  const merged: Record<string, unknown> = { ...ours };
  const conflicts: string[] = [];
  for (const key of Object.keys(theirs)) {
    if (fieldValuesEqual(theirs[key], base[key])) {
      continue;
    }
    const oursChanged = !fieldValuesEqual(ours[key], base[key]);
    if (!oursChanged || fieldValuesEqual(ours[key], theirs[key])) {
      merged[key] = theirs[key];
      continue;
    }
    conflicts.push(key);
  }
  return { merged, conflicts };
};

// ── Node merge helpers ────────────────────────────────────────────────────────

const materializeGenericNode = async (ctx: MergeCtx, args: MaterializeArgs): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: fields.nodeType as BusabaseNodeType,
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    metadata: fields.metadata || {},
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return nodeId;
};

/**
 * Resolve the parent node id for a node operation, supporting an in-CR temp ref:
 * `parentNodeRef` points at a node an EARLIER operation created (looked up in
 * `ctx.nodeRefs`). Falls back to `parentNodeId`, then the space root.
 */
const resolveParentNodeId = (
  ctx: MergeCtx,
  fields: { parentNodeId?: string; parentNodeRef?: string },
  operationId: string,
): string => {
  if (fields.parentNodeRef) {
    const resolved = ctx.nodeRefs.get(fields.parentNodeRef);
    if (!resolved) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Operation ${operationId} references parentNodeRef "${fields.parentNodeRef}", but no earlier operation in this change request created it.`,
      });
    }
    return resolved;
  }
  return fields.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
};

const mergeNodeCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const fields = headCommit.fields as NodeCreateFields;
  const parentNodeId = resolveParentNodeId(ctx, fields, item.id);
  const [parentNode] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${parentNodeId}`);
  }
  if (!fields.nodeType || !fields.slug || !fields.name) {
    throw new Error(`Node create commit missing required fields: ${item.id}`);
  }
  const materialize = getMaterializer(fields.nodeType) ?? materializeGenericNode;
  const nodeId = await materialize(ctx, { parentNode, fields });
  // Publish this node's temp ref so later operations in the CR can parent to it.
  if (fields.ref) {
    ctx.nodeRefs.set(fields.ref, nodeId);
  }
  await db
    .update(busabaseOperations)
    .set({ status: "merged", nodeId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedNodeIds.push(nodeId);
};

const mergeNodeRename = async (
  ctx: MergeCtx,
  _item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.archivedAt) {
    throw new ORPCError("CONFLICT", {
      message: "Cannot rename an archived node. Restore it first.",
    });
  }
  const fields = headCommit.fields as {
    slug?: string;
    name?: string;
    description?: string;
  };
  await ctx.db
    .update(busabaseNodes)
    .set({
      slug: fields.slug ?? node.slug,
      name: fields.name ?? node.name,
      description: fields.description ?? node.description,
      updatedAt: ctx.timestamp,
    })
    .where(eq(busabaseNodes.id, node.id));
  if (node.type === "base") {
    await ctx.db
      .update(busabaseBases)
      .set({
        slug: fields.slug ?? node.slug,
        name: fields.name ?? node.name,
        description: fields.description ?? node.description,
      })
      .where(eq(busabaseBases.nodeId, node.id));
  }
};

const mergeNodeMove = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.archivedAt) {
    throw new ORPCError("CONFLICT", {
      message: "Cannot move an archived node. Restore it first.",
    });
  }
  const fields = headCommit.fields as {
    parentNodeId?: string;
    parentNodeRef?: string;
    position?: number;
  };
  if (!fields.parentNodeId && !fields.parentNodeRef) {
    throw new Error(`Node move commit missing parentNodeId/parentNodeRef: ${item.id}`);
  }
  const parentNodeId = resolveParentNodeId(ctx, fields, item.id);
  const [parentNode] = await ctx.db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  if (!parentNode || parentNode.type !== "folder") {
    throw new Error(`Parent folder not found: ${parentNodeId}`);
  }
  await ctx.db
    .update(busabaseNodes)
    .set({
      parentId: parentNode.id,
      position: fields.position ?? node.position,
      updatedAt: ctx.timestamp,
    })
    .where(eq(busabaseNodes.id, node.id));
};

const mergeNodeDelete = async (ctx: MergeCtx, _item: OperationPO, node: NodePO) => {
  // Cascade for base nodes: soft-archive the base + its records so deleting the
  // node never leaves orphan records/fields/views behind (mirrors base archive).
  if (node.type === "base") {
    const { busabaseBases, busabaseRecords } = await import("../db/schema");
    const [base] = await ctx.db
      .select({ id: busabaseBases.id })
      .from(busabaseBases)
      .where(eq(busabaseBases.nodeId, node.id))
      .limit(1);
    if (base) {
      await ctx.db
        .update(busabaseBases)
        .set({ archivedAt: ctx.timestamp })
        .where(eq(busabaseBases.id, base.id));
      await ctx.db
        .update(busabaseRecords)
        .set({ status: "archived", archivedAt: ctx.timestamp, updatedAt: ctx.timestamp })
        // Only active records — preserve the archive time of records the user
        // already deleted individually, so a later restore can leave them deleted
        // (mirrors mergeBaseArchive). Restore matches on this batch timestamp.
        .where(and(eq(busabaseRecords.baseId, base.id), eq(busabaseRecords.status, "active")));
      // The base node row is kept (deleting it would cascade-delete the base,
      // which is FK-restricted by commits). Soft-archive it so it leaves the
      // node tree and frees its slug (partial unique index), matching the
      // bases.list / record-query hiding that is the intended delete semantics.
      await ctx.db
        .update(busabaseNodes)
        .set({ archivedAt: ctx.timestamp, updatedAt: ctx.timestamp })
        .where(eq(busabaseNodes.id, node.id));
      return;
    }
  }
  // Non-base nodes (folder / doc / skill) soft-archive instead of hard-delete so
  // the deletion is recoverable (mergeNodeRestore). Folders archive their whole
  // active subtree in one batch (shared timestamp) so children leave the tree too.
  const subtreeIds = await collectActiveSubtreeIds(ctx.db, node.id);
  await ctx.db
    .update(busabaseNodes)
    .set({ archivedAt: ctx.timestamp, updatedAt: ctx.timestamp })
    .where(inArray(busabaseNodes.id, subtreeIds));
  // A folder subtree can contain Base nodes — archive their base row + records in
  // lockstep, otherwise the base lingers in bases.list with no node in the tree.
  await setBasesArchivedForNodes(ctx, subtreeIds, ctx.timestamp, ctx.timestamp);
};

/**
 * Archive (or, with `archivedAt: null`, restore) the `busabase_bases` rows + their
 * records for any Base nodes among `nodeIds`. Keeps the base table and record
 * queries in lockstep with the node tree when a folder subtree is archived/restored.
 */
const setBasesArchivedForNodes = async (
  ctx: MergeCtx,
  nodeIds: string[],
  archivedAt: Date | null,
  batchArchivedAt: Date,
): Promise<void> => {
  if (nodeIds.length === 0) {
    return;
  }
  const baseRows = await ctx.db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(inArray(busabaseBases.nodeId, nodeIds));
  if (baseRows.length === 0) {
    return;
  }
  const baseIds = baseRows.map((b) => b.id);
  await ctx.db.update(busabaseBases).set({ archivedAt }).where(inArray(busabaseBases.id, baseIds));
  if (archivedAt) {
    // Archive: only ACTIVE records, preserving the archive time of records the
    // user already deleted individually (mirrors mergeBaseArchive).
    await ctx.db
      .update(busabaseRecords)
      .set({ status: "archived", archivedAt, updatedAt: ctx.timestamp })
      .where(and(inArray(busabaseRecords.baseId, baseIds), eq(busabaseRecords.status, "active")));
  } else {
    // Restore: only the records THIS batch archived (matched by timestamp), so
    // individually-deleted records stay deleted (mirrors mergeBaseRestore).
    await ctx.db
      .update(busabaseRecords)
      .set({ status: "active", archivedAt: null, updatedAt: ctx.timestamp })
      .where(
        and(
          inArray(busabaseRecords.baseId, baseIds),
          eq(busabaseRecords.archivedAt, batchArchivedAt),
        ),
      );
  }
};

/**
 * BFS the active (non-archived) subtree rooted at `rootId`, returning every node
 * id including the root. Used to archive/restore a folder + its descendants atomically.
 */
const collectActiveSubtreeIds = async (db: MergeCtx["db"], rootId: string): Promise<string[]> => {
  const collected = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(and(inArray(busabaseNodes.parentId, frontier), isNull(busabaseNodes.archivedAt)));
    frontier = children.map((c) => c.id);
    collected.push(...frontier);
  }
  return collected;
};

/**
 * BFS the ARCHIVED subtree rooted at `rootId`, restricted to nodes archived in the
 * same batch (`archivedAt` equal to the root's). This is what a restore walks so it
 * brings back exactly the subtree a single delete removed — NOT unrelated nodes that
 * happen to share the timestamp because they were deleted by other operations in the
 * same change request (every op in a CR shares one merge timestamp).
 */
const collectArchivedSubtreeIds = async (
  db: MergeCtx["db"],
  rootId: string,
  archivedAt: Date,
): Promise<string[]> => {
  const collected = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(
        and(inArray(busabaseNodes.parentId, frontier), eq(busabaseNodes.archivedAt, archivedAt)),
      );
    frontier = children.map((c) => c.id);
    collected.push(...frontier);
  }
  return collected;
};

const mergeNodeRestore = async (ctx: MergeCtx, _item: OperationPO, node: NodePO) => {
  const { db, timestamp } = ctx;
  if (!node.archivedAt) {
    throw new ORPCError("CONFLICT", { message: "Node is not archived" });
  }
  // A purged node's `deletedAt` is a terminal state (its row is kept, but only
  // for history) — it must never leave the tree it was hidden from, so restore
  // is refused even though `archivedAt` is still set.
  if (node.deletedAt) {
    throw new ORPCError("CONFLICT", {
      message: "Cannot restore: this item was permanently deleted.",
    });
  }
  // Guard slug reuse: if an active sibling took this slug while archived, restoring
  // would collide on the partial unique index — fail with a clear message.
  const [slugTaken] = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        node.parentId ? eq(busabaseNodes.parentId, node.parentId) : isNull(busabaseNodes.parentId),
        eq(busabaseNodes.slug, node.slug),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .limit(1);
  if (slugTaken) {
    throw new ORPCError("CONFLICT", {
      message: `Cannot restore: the slug "${node.slug}" is now used by a sibling. Rename it first.`,
    });
  }
  // Restore exactly the subtree this node's delete removed — its archived
  // descendants sharing the same archive timestamp. Scoping to the subtree (not
  // the space-wide `archivedAt` batch) means a change request that deleted several
  // unrelated nodes — which all share one merge timestamp — restores only the one
  // being un-deleted, instead of resurrecting the others too.
  const batchIds = await collectArchivedSubtreeIds(db, node.id, node.archivedAt);
  await db
    .update(busabaseNodes)
    .set({ archivedAt: null, updatedAt: timestamp })
    .where(inArray(busabaseNodes.id, batchIds));
  // Un-archive any Base nodes in the restored batch (their base row + records),
  // mirroring the archive in mergeNodeDelete. Covers both a base restored
  // directly and a base brought back as part of a folder subtree. Records are
  // restored only if they were archived by THIS batch (node.archivedAt), so
  // records the user deleted individually beforehand stay deleted.
  await setBasesArchivedForNodes(ctx, batchIds, null, node.archivedAt);
};

// ── Agent trigger ─────────────────────────────────────────────────────────────

export type AgentTaskTrigger = "changes_requested" | "ai_mention";

export const notifyAgentOfChangeRequest = (changeRequestId: string, trigger: AgentTaskTrigger) => {
  const url = process.env.BUSABASE_AGENT_WEBHOOK_URL;
  if (!url) {
    return;
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "agent.task", trigger, changeRequestId }),
  }).catch(() => {
    // Best-effort
  });
};

// ── Hydrate ───────────────────────────────────────────────────────────────────

/**
 * Batch-hydrate change requests: one query per relation (operations, commits,
 * views, reviews, bases, nodes, users) across ALL the change requests, instead
 * of the per-CR fan-out `hydrateChangeRequest` would do in a `.map()`. Output is
 * identical to calling the singular on each row — this is a pure N+1 fix.
 */
export const hydrateChangeRequests = async (
  changeRequests: ChangeRequestPO[],
): Promise<ChangeRequestVO[]> => {
  if (changeRequests.length === 0) {
    return [];
  }
  const db = await getDb();
  const changeRequestIds = changeRequests.map((changeRequest) => changeRequest.id);

  const baseMap = await loadBasesByIds([
    ...new Set(
      changeRequests
        .map((changeRequest) => changeRequest.baseId)
        .filter((baseId): baseId is string => Boolean(baseId)),
    ),
  ]);
  const nodeMap = await loadNodesByIds([
    ...new Set(
      changeRequests
        .map((changeRequest) => changeRequest.nodeId)
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    ),
  ]);

  // Every operation across all CRs in one query; grouped per CR preserving
  // (position, createdAt) order.
  const itemRows = await db
    .select()
    .from(busabaseOperations)
    .where(inArray(busabaseOperations.changeRequestId, changeRequestIds))
    .orderBy(asc(busabaseOperations.position), asc(busabaseOperations.createdAt));
  const operationsByCr = new Map<string, OperationPO[]>();
  for (const item of itemRows) {
    const list = operationsByCr.get(item.changeRequestId);
    if (list) {
      list.push(item);
    } else {
      operationsByCr.set(item.changeRequestId, [item]);
    }
  }

  // Head commits + record base-commits in one query.
  const allCommitIds = [
    ...new Set([
      ...itemRows.map((item) => item.headCommitId),
      ...itemRows
        .map((item) => item.baseCommitId)
        .filter((commitId): commitId is string => Boolean(commitId)),
    ]),
  ];
  const commitRows =
    allCommitIds.length > 0
      ? await db.select().from(busabaseCommits).where(inArray(busabaseCommits.id, allCommitIds))
      : [];
  const commitsById = new Map(commitRows.map((commit) => [commit.id, commit]));

  const viewTargetIds = [
    ...new Set(
      itemRows
        .filter(
          (item) =>
            (item.operation === "view_update" ||
              item.operation === "view_delete" ||
              item.operation === "view_restore") &&
            item.targetViewId,
        )
        .map((item) => item.targetViewId as string),
    ),
  ];
  const viewRows =
    viewTargetIds.length > 0
      ? await db.select().from(busabaseViews).where(inArray(busabaseViews.id, viewTargetIds))
      : [];
  const viewsById = new Map(viewRows.map((view) => [view.id, view]));

  const resolveBaseFields = (item: OperationPO): Record<string, unknown> | null => {
    if (item.operation === "record_update" || item.operation === "record_delete") {
      const baseCommit = item.baseCommitId ? commitsById.get(item.baseCommitId) : undefined;
      return baseCommit ? baseCommit.fields : null;
    }
    if (
      item.operation === "view_update" ||
      item.operation === "view_delete" ||
      item.operation === "view_restore"
    ) {
      const view = item.targetViewId ? viewsById.get(item.targetViewId) : undefined;
      return view
        ? {
            name: view.name,
            description: view.description,
            config: normalizeViewConfig(view.config),
          }
        : null;
    }
    return null;
  };

  // Every review across all CRs in one query; grouped per CR (createdAt desc).
  const reviewRows = await db
    .select()
    .from(busabaseReviews)
    .where(inArray(busabaseReviews.changeRequestId, changeRequestIds))
    .orderBy(desc(busabaseReviews.createdAt));
  const reviewsByCr = new Map<string, ReviewPO[]>();
  for (const review of reviewRows) {
    const list = reviewsByCr.get(review.changeRequestId);
    if (list) {
      list.push(review);
    } else {
      reviewsByCr.set(review.changeRequestId, [review]);
    }
  }

  const users = await resolveUserRefs([
    ...changeRequests.map((changeRequest) => changeRequest.submittedBy),
    ...commitRows.map((commit) => commit.author),
    ...reviewRows.map((review) => review.reviewerId),
  ]);

  return changeRequests.map((changeRequest) => {
    const operations: OperationVO[] = (operationsByCr.get(changeRequest.id) ?? []).map((item) => {
      const commit = commitsById.get(item.headCommitId);
      if (!commit) {
        throw new Error(`Invalid operation graph for ${item.id}`);
      }
      return toOperationVO(item, commit, resolveBaseFields(item), users);
    });
    const base = changeRequest.baseId ? (baseMap.get(changeRequest.baseId) ?? null) : null;
    const node = changeRequest.nodeId ? (nodeMap.get(changeRequest.nodeId) ?? null) : null;
    if (changeRequest.targetType === "base" && !base) {
      throw new Error(`Invalid changeRequest graph for ${changeRequest.id}`);
    }
    if (changeRequest.targetType === "node" && changeRequest.nodeId && !node) {
      throw new Error(`Invalid node changeRequest graph for ${changeRequest.id}`);
    }

    return {
      id: changeRequest.id,
      baseId: changeRequest.baseId,
      targetType: changeRequest.targetType,
      nodeId: changeRequest.nodeId,
      status: changeRequest.status,
      submittedBy: changeRequest.submittedBy,
      submittedByUser: users.get(changeRequest.submittedBy) ?? null,
      sourceMeta: changeRequest.sourceMeta,
      reviewPolicySnapshot: changeRequest.reviewPolicySnapshot,
      mergeSummary: changeRequest.mergeSummary,
      rejectedReason: changeRequest.rejectedReason,
      reviewedAt: toIso(changeRequest.reviewedAt),
      mergedAt: toIso(changeRequest.mergedAt),
      createdAt: changeRequest.createdAt.toISOString(),
      updatedAt: changeRequest.updatedAt.toISOString(),
      base,
      node,
      operations,
      primaryOperation: operations[0] ?? null,
      operationCount: operations.length,
      reviews: (reviewsByCr.get(changeRequest.id) ?? []).map((review) =>
        toReviewVO(review, users),
      ) as ReviewVO[],
    };
  });
};

export const hydrateChangeRequest = async (
  changeRequest: ChangeRequestPO,
): Promise<ChangeRequestVO> => {
  const [vo] = await hydrateChangeRequests([changeRequest]);
  if (!vo) {
    throw new Error(`Invalid changeRequest graph for ${changeRequest.id}`);
  }
  return vo;
};

/**
 * Batch-hydrate records: bases + head commits + users resolved once for the
 * whole set instead of per-record. Output is identical to `hydrateRecord` per
 * row — a pure N+1 fix.
 */
export const hydrateRecords = async (records: RecordPO[]): Promise<RecordVO[]> => {
  if (records.length === 0) {
    return [];
  }
  const db = await getDb();
  const baseMap = await loadBasesByIds([...new Set(records.map((record) => record.baseId))]);
  const headCommitIds = [...new Set(records.map((record) => record.headCommitId))];
  const commitRows = await db
    .select()
    .from(busabaseCommits)
    .where(inArray(busabaseCommits.id, headCommitIds));
  const commitsById = new Map(commitRows.map((commit) => [commit.id, commit]));
  const users = await resolveUserRefs([
    ...records.map((record) => record.createdBy),
    ...commitRows.map((commit) => commit.author),
  ]);

  return records.map((record) => {
    const base = baseMap.get(record.baseId);
    const headCommit = commitsById.get(record.headCommitId);
    if (!base || !headCommit) {
      throw new Error(`Invalid record graph for ${record.id}`);
    }
    return {
      id: record.id,
      baseId: record.baseId,
      headCommitId: record.headCommitId,
      parentRecordId: record.parentRecordId,
      parentCommitId: record.parentCommitId,
      status: record.status === "archived" ? "archived" : "active",
      createdBy: record.createdBy,
      createdByUser: users.get(record.createdBy) ?? null,
      archivedAt: toIso(record.archivedAt),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      base,
      headCommit: toCommitVO(headCommit, users),
    };
  });
};

export const hydrateRecord = async (record: RecordPO): Promise<RecordVO> => {
  const [vo] = await hydrateRecords([record]);
  if (!vo) {
    throw new Error(`Invalid record graph for ${record.id}`);
  }
  return vo;
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const listChangeRequests = async (input?: z.input<typeof listInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const changeRequestRows = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.spaceId, getContextSpaceId()))
    .orderBy(desc(busabaseChangeRequests.createdAt))
    .limit(parsed.limit);
  return hydrateChangeRequests(changeRequestRows);
};

// `|` separates the ISO timestamp (which contains colons) from the id.
const encodeChangeRequestCursor = (createdAt: Date, changeRequestId: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${changeRequestId}`, "utf8").toString("base64");

const decodeChangeRequestCursor = (cursor: string): { createdAt: Date; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

// The "created" inbox tab / `mine` filter is scoped to the acting user. In the
// cloud this resolves to the real user id; open-source falls back to the local
// editor — matching how `submittedBy` is stored on creation (record-ops.ts).
const mineActorId = () => resolveActorId("local-editor");

/**
 * Keyset-paginated change request list mirroring listRecordsPaged. Orders by
 * (createdAt DESC, id DESC) and walks backwards via an opaque base64 cursor.
 * `status` narrows to specific statuses (inbox tabs); `mine` narrows to the
 * acting user's submissions.
 */
export const listChangeRequestsPaged = async (
  input?: z.input<typeof listChangeRequestsPagedInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listChangeRequestsPagedInputSchema.parse(input);
  const filters: SQL[] = [eq(busabaseChangeRequests.spaceId, getContextSpaceId())];
  if (parsed.status && parsed.status.length > 0) {
    filters.push(inArray(busabaseChangeRequests.status, parsed.status));
  }
  if (parsed.mine) {
    filters.push(eq(busabaseChangeRequests.submittedBy, mineActorId()));
  }
  if (parsed.cursor) {
    const decoded = decodeChangeRequestCursor(parsed.cursor);
    if (decoded) {
      filters.push(
        or(
          lt(busabaseChangeRequests.createdAt, decoded.createdAt),
          and(
            eq(busabaseChangeRequests.createdAt, decoded.createdAt),
            lt(busabaseChangeRequests.id, decoded.id),
          ),
        ) as SQL,
      );
    }
  }

  const rows = await db
    .select()
    .from(busabaseChangeRequests)
    .where(and(...filters))
    .orderBy(desc(busabaseChangeRequests.createdAt), desc(busabaseChangeRequests.id))
    .limit(parsed.limit + 1);

  const hasMore = rows.length > parsed.limit;
  const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeChangeRequestCursor(last.createdAt, last.id) : null;

  const changeRequests = await hydrateChangeRequests(pageRows);
  return { changeRequests, nextCursor };
};

/**
 * Whole-space inbox tab counts. One grouped query by status plus a scoped count
 * for the "created" tab — so the badges are correct regardless of how many
 * change requests exist (the client used to compute these from a capped page).
 */
export const countChangeRequests = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const byStatus = await db
    .select({
      status: busabaseChangeRequests.status,
      count: sql<number>`count(*)::int`,
    })
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.spaceId, spaceId))
    .groupBy(busabaseChangeRequests.status);
  const statusCount = new Map(byStatus.map((row) => [row.status, row.count]));

  const [createdRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.spaceId, spaceId),
        eq(busabaseChangeRequests.submittedBy, mineActorId()),
      ),
    );

  return {
    review: statusCount.get("in_review") ?? 0,
    changes: statusCount.get("changes_requested") ?? 0,
    created: createdRow?.count ?? 0,
    approved: statusCount.get("approved") ?? 0,
    merged: statusCount.get("merged") ?? 0,
    rejected: (statusCount.get("rejected") ?? 0) + (statusCount.get("abandoned") ?? 0),
  };
};

export const getChangeRequest = async (changeRequestId: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  return changeRequest ? hydrateChangeRequest(changeRequest) : null;
};

export const listRecordChangeRequests = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const operationRows = await db
    .select({
      changeRequestId: busabaseOperations.changeRequestId,
      updatedAt: busabaseOperations.updatedAt,
    })
    .from(busabaseOperations)
    .where(
      or(
        eq(busabaseOperations.mergedRecordId, recordId),
        eq(busabaseOperations.targetRecordId, recordId),
        eq(busabaseOperations.sourceRecordId, recordId),
      ),
    )
    .orderBy(desc(busabaseOperations.updatedAt));
  const changeRequestIds = [
    ...new Set(operationRows.map((operation) => operation.changeRequestId)),
  ];
  if (changeRequestIds.length === 0) {
    return [];
  }

  const changeRequestRows = await db
    .select()
    .from(busabaseChangeRequests)
    .where(inArray(busabaseChangeRequests.id, changeRequestIds));
  const changeRequestsById = new Map(
    changeRequestRows.map((changeRequest) => [changeRequest.id, changeRequest]),
  );
  return hydrateChangeRequests(
    changeRequestIds
      .map((crId) => changeRequestsById.get(crId))
      .filter((changeRequest): changeRequest is ChangeRequestPO => Boolean(changeRequest)),
  );
};

export const reviseOperation = async (
  operationId: string,
  input: z.infer<typeof reviseOperationInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = reviseOperationInputSchema.parse(input);
  const [operation] = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.id, operationId))
    .limit(1);
  if (!operation) {
    throw new Error(`Operation not found: ${operationId}`);
  }

  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, operation.changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw new Error(`ChangeRequest not found: ${operation.changeRequestId}`);
  }
  // `conflict` is revisable: re-authoring is the escape hatch out of a 3-way
  // merge conflict (the revise re-baselines the op below so the next merge is clean).
  if (
    changeRequest.status !== "in_review" &&
    changeRequest.status !== "changes_requested" &&
    changeRequest.status !== "conflict"
  ) {
    throw new Error(
      `Operation is not revisable after changeRequest status: ${changeRequest.status}`,
    );
  }

  const commitId = id("cmt");
  const timestamp = now();
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: operation.baseId,
    targetType: operation.targetType,
    nodeId: operation.nodeId,
    operationId: operation.id,
    parentCommitId: operation.headCommitId,
    fields: parsed.fields,
    operation: operation.operation,
    message: parsed.message,
    author: parsed.author,
    createdAt: timestamp,
  });

  // Re-baseline a record_update op to the target record's CURRENT head so that
  // revising a conflicted CR makes the next merge see no stale divergence
  // (the 3-way branch is skipped when baseCommitId === targetRecord.headCommitId).
  // An explicit caller-supplied baseCommitId wins.
  let rebaselineCommitId = parsed.baseCommitId;
  if (!rebaselineCommitId && operation.operation === "record_update" && operation.targetRecordId) {
    const [targetRecord] = await db
      .select({ headCommitId: busabaseRecords.headCommitId })
      .from(busabaseRecords)
      .where(eq(busabaseRecords.id, operation.targetRecordId))
      .limit(1);
    rebaselineCommitId = targetRecord?.headCommitId;
  }

  await db
    .update(busabaseOperations)
    .set({
      headCommitId: commitId,
      ...(rebaselineCommitId ? { baseCommitId: rebaselineCommitId } : {}),
      updatedAt: timestamp,
    })
    .where(eq(busabaseOperations.id, operation.id));
  await db
    .update(busabaseChangeRequests)
    // Reset to in_review and clear any stale conflict summary from a prior merge.
    .set({ status: "in_review", mergeSummary: {}, updatedAt: timestamp })
    .where(eq(busabaseChangeRequests.id, operation.changeRequestId));

  await projectCommitFields({
    baseId: requireBaseId(operation.baseId, "reviseOperation"),
    commitId,
    changeRequestId: operation.changeRequestId,
    operationId: operation.id,
    fields: parsed.fields,
  });
  await insertAuditEvent(db, {
    action: "change_request.updated",
    actorId: parsed.author,
    baseId: operation.baseId,
    changeRequestId: operation.changeRequestId,
    operationId: operation.id,
    commitId,
    metadata: { operation: operation.operation, revision: true },
  });

  const updatedChangeRequest = await getChangeRequest(operation.changeRequestId);
  if (!updatedChangeRequest) {
    throw new Error("Failed to revise operation");
  }
  return updatedChangeRequest;
};

export const reviewChangeRequest = async (
  changeRequestId: string,
  input: z.infer<typeof reviewInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = reviewInputSchema.parse(input);
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw changeRequestNotFound(changeRequestId);
  }
  // Idempotent for already-merged CRs: structural CRs auto-merge on create, so a
  // caller still following the old create→review→merge flow (e.g. the CLI/skills)
  // must not error here — return the merged CR unchanged.
  if (changeRequest.status === "merged") {
    const already = await getChangeRequest(changeRequest.id);
    if (!already) {
      throw new Error("Failed to load merged changeRequest");
    }
    return already;
  }
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    throw changeRequestConflict(`ChangeRequest is not reviewable: ${changeRequest.status}`);
  }

  const operationKinds = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id));
  if (operationKinds.length === 0) {
    throw changeRequestBadRequest(`ChangeRequest has no operations: ${changeRequest.id}`);
  }
  const visibleOperationHeads = Object.fromEntries(
    operationKinds.map((item) => [item.id, item.headCommitId]),
  );
  const timestamp = now();
  await db
    .insert(busabaseReviews)
    .values({
      id: id("rev"),
      changeRequestId: changeRequest.id,
      reviewerId: resolveActorId(CURRENT_USER_ID),
      verdict: parsed.verdict,
      reason: parsed.reason ?? null,
      visibleOperationHeads,
      createdAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [busabaseReviews.changeRequestId, busabaseReviews.reviewerId],
      set: {
        verdict: parsed.verdict,
        reason: parsed.reason ?? null,
        visibleOperationHeads,
        createdAt: timestamp,
      },
    });

  await db
    .update(busabaseChangeRequests)
    .set({
      status: parsed.verdict === "approved" ? "approved" : "changes_requested",
      rejectedReason: null,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: { verdict: parsed.verdict },
  });
  if (parsed.verdict !== "approved") {
    notifyAgentOfChangeRequest(changeRequest.id, "changes_requested");
  }

  const updated = await getChangeRequest(changeRequest.id);
  if (!updated) {
    throw new Error("Failed to review changeRequest");
  }
  return updated;
};

// ── Auto-merge (structural ops) ─────────────────────────────────────────────
//
// Every content-tree mutation flows through a ChangeRequest so it is auditable,
// reviewable, and revertable. STRUCTURAL / administrative ops (folder / base /
// doc / skill scaffolding, schema convenience, destructive admin) don't need a
// human in the loop — they auto-merge here, but still leave a first-class merged
// CR. CONTENT ops (record_*) — the reviewable material busabase exists to gate —
// never take this path; they keep the human review loop.

/**
 * Reviewer id stamped on the auto-approval row so history is honest that the
 * merge was machine-driven, not a human approval. Not a real user — `reviewerId`
 * is a plain text column (no FK), and the one-vote-per-CR unique index is keyed
 * by reviewer, so this never collides with a later human vote.
 */
export const AUTO_MERGE_REVIEWER_ID = "system:auto-merge";

/** True when any operation is reviewable content (a record change). */
const changeRequestHasContentOps = (operations: OperationPO[]): boolean =>
  operations.some((op) => op.operation.startsWith("record_"));

/**
 * Approve `changeRequestId` as the system reviewer and merge it in one step — the
 * structural-op fast path that keeps `createBase` / `createDoc` / … feeling
 * instant while still recording a merged CR. Refuses to touch a CR that carries
 * any content (record) operation, so content review can never be bypassed here.
 * Returns the same `_mergeChangeRequest` result (CR now `merged`, plus any
 * materialized record/view), so callers can hydrate the created VO.
 */
export const autoApproveAndMerge = async (
  changeRequestId: string,
  reason = "Auto-merged: structural change",
) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw changeRequestNotFound(changeRequestId);
  }
  if (changeRequest.status !== "in_review" && changeRequest.status !== "changes_requested") {
    throw changeRequestConflict(`ChangeRequest is not auto-mergeable: ${changeRequest.status}`);
  }

  const operations = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id));
  if (operations.length === 0) {
    throw changeRequestBadRequest(`ChangeRequest has no operations: ${changeRequest.id}`);
  }
  // Safety net for F2: a content CR must never auto-merge, whatever the caller.
  if (changeRequestHasContentOps(operations)) {
    throw changeRequestBadRequest("Refusing to auto-merge a content (record) change request");
  }

  const timestamp = now();
  await db
    .insert(busabaseReviews)
    .values({
      id: id("rev"),
      changeRequestId: changeRequest.id,
      reviewerId: AUTO_MERGE_REVIEWER_ID,
      verdict: "approved",
      reason,
      visibleOperationHeads: {},
      createdAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [busabaseReviews.changeRequestId, busabaseReviews.reviewerId],
      set: { verdict: "approved", reason, createdAt: timestamp },
    });
  await db
    .update(busabaseChangeRequests)
    .set({
      status: "approved",
      rejectedReason: null,
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: { verdict: "approved", auto: true },
  });

  return mergeChangeRequest(changeRequest.id);
};

/**
 * Record an already-performed structural mutation as a **merged** ChangeRequest —
 * so a direct write (`createBase`/`createDoc`/`createSkill`, `createBaseField`,
 * `updateDocBody`) still leaves a first-class, auditable, history-visible CR
 * without re-running the merge (the rows already exist; the per-type materializers
 * are NOT input-parity with the direct writes — a doc's body / a base's exact
 * fields would be lost). Writes the same ledger shape the create→auto-merge path
 * produces (CR + commit + merged operation + system review + the three CR audit
 * events), so history/UI render it identically. This is what replaces the old
 * bespoke `base.created` / `doc.created` / `skill.created` / `field.created` /
 * `doc.updated` audit actions.
 */
const metadataStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const recordMergedOperation = async (args: {
  operation: OperationPO["operation"];
  targetType: "node" | "base";
  nodeId?: string | null;
  baseId?: string | null;
  fields: Record<string, unknown>;
  message: string;
  submittedBy: string;
  sourceMeta?: Record<string, unknown>;
  reviewPolicySnapshot?: Record<string, unknown>;
  mergeSummary?: Record<string, unknown>;
  auditMetadata?: Record<string, unknown>;
}): Promise<string> => {
  const db = await getDb();
  const timestamp = now();
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const nodeId = args.nodeId ?? null;
  const baseId = args.baseId ?? null;
  const mergeSummary = args.mergeSummary ?? {};

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId,
    targetType: args.targetType,
    nodeId,
    status: "merged",
    submittedBy: args.submittedBy,
    sourceMeta: { ...(args.sourceMeta ?? {}), autoMerged: true },
    reviewPolicySnapshot: args.reviewPolicySnapshot ?? { kind: "single", requiredApprovals: 1 },
    mergeSummary,
    rejectedReason: null,
    reviewedAt: timestamp,
    mergedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId,
    targetType: args.targetType,
    nodeId,
    operationId,
    parentCommitId: null,
    fields: args.fields,
    operation: args.operation,
    message: args.message,
    author: args.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId,
    targetType: args.targetType,
    nodeId,
    operation: args.operation,
    status: "merged",
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
  await db.insert(busabaseReviews).values({
    id: id("rev"),
    changeRequestId,
    reviewerId: AUTO_MERGE_REVIEWER_ID,
    verdict: "approved",
    reason: "Auto-merged: structural change",
    visibleOperationHeads: {},
    createdAt: timestamp,
  });

  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: args.submittedBy,
    baseId,
    changeRequestId,
    metadata: { operation: args.operation, autoMerged: true, ...(args.auditMetadata ?? {}) },
  });
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId,
    changeRequestId,
    metadata: { verdict: "approved", auto: true },
  });
  await insertAuditEvent(db, {
    action: "change_request.merged",
    actorId: CURRENT_USER_ID,
    baseId,
    changeRequestId,
    metadata: { operation: args.operation, ...mergeSummary },
  });
  await publishBusabaseLiveEvent({
    kind: "change_request.merged",
    spaceId: getContextSpaceId(),
    actorId: args.submittedBy,
    changeRequestId,
    baseId,
    nodeIds: [
      ...new Set([
        ...(args.targetType === "node" && nodeId ? [nodeId] : []),
        ...metadataStringArray(mergeSummary.mergedNodeIds),
      ]),
    ],
    recordIds: metadataStringArray(mergeSummary.recordIds),
    viewIds: metadataStringArray(mergeSummary.viewIds),
    operationCount: 1,
  });
  return changeRequestId;
};

/** `recordMergedOperation` specialized to a node_create (base/doc/skill/folder). */
export const recordMergedNodeCreate = async (args: {
  nodeId: string;
  baseId?: string | null;
  nodeType: string;
  slug: string;
  name: string;
  description?: string;
  parentNodeId: string;
  metadata?: Record<string, unknown>;
  message: string;
  submittedBy: string;
}): Promise<string> =>
  recordMergedOperation({
    operation: "node_create",
    targetType: "node",
    nodeId: args.nodeId,
    baseId: args.baseId ?? null,
    fields: {
      kind: "create",
      nodeType: args.nodeType,
      parentNodeId: args.parentNodeId,
      slug: args.slug,
      name: args.name,
      description: args.description ?? "",
      metadata: args.metadata ?? {},
    },
    message: args.message,
    submittedBy: args.submittedBy,
    sourceMeta: { subject: "node_tree" },
    mergeSummary: { mergedNodeIds: [args.nodeId] },
    auditMetadata: { nodeType: args.nodeType },
  });

/**
 * Create a PENDING (`in_review`) node_create ChangeRequest — the review-first
 * counterpart to `recordMergedNodeCreate`. This is what `createBase` /
 * `createDoc` / `createFileNode` / `createFileTreeNode` call by DEFAULT (no
 * `autoMerge: true`): nothing is materialized — no node/base/doc row, no
 * storage write — until a human (or an explicit `autoMerge: true` caller)
 * approves and merges it, exactly like the Dashboard's "New" modal default.
 * Reuses the generic `node_create` operation + the same per-type materializer
 * (`getMaterializer`) that the Dashboard's `nodes.createChangeRequest` path
 * merges through, so a merged CR from either path produces identical rows.
 * Returns the pending ChangeRequestVO (its `node`/`base` are null until merged).
 */
export const recordPendingNodeCreate = async (args: {
  nodeType: string;
  slug: string;
  name: string;
  description?: string;
  parentNodeId: string;
  metadata?: Record<string, unknown>;
  fields?: NodeCreateFields["fields"];
  body?: string;
  initialFiles?: NodeCreateFields["initialFiles"];
  message: string;
  submittedBy: string;
}): Promise<ChangeRequestVO> => {
  await ensureReady();
  const db = await getDb();
  const submittedBy = resolveActorId(args.submittedBy);
  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  const fields: Record<string, unknown> = {
    kind: "create",
    nodeType: args.nodeType,
    parentNodeId: args.parentNodeId,
    slug: args.slug,
    name: args.name,
    description: args.description ?? "",
    metadata: args.metadata ?? {},
    ...(args.fields ? { fields: args.fields } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.initialFiles ? { initialFiles: args.initialFiles } : {}),
  };

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: null,
    status: "in_review",
    submittedBy,
    sourceMeta: { subject: "node_tree" },
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
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "node_create",
    message: args.message,
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: null,
    operation: "node_create",
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
    actorId: submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation: "node_create", nodeType: args.nodeType },
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error(`Failed to create pending node change request: ${changeRequestId}`);
  }
  return changeRequest;
};

export const closeChangeRequest = async (changeRequestId: string, reason?: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId))
    .limit(1);
  if (!changeRequest) {
    throw changeRequestNotFound(changeRequestId);
  }
  // `conflict` is closable too — the author may abandon an unresolvable conflict.
  if (!["in_review", "changes_requested", "approved", "conflict"].includes(changeRequest.status)) {
    throw changeRequestConflict(`ChangeRequest is not closable: ${changeRequest.status}`);
  }
  const timestamp = now();
  await db
    .update(busabaseChangeRequests)
    .set({
      status: "rejected",
      rejectedReason: reason ?? "Closed by reviewer",
      reviewedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(busabaseChangeRequests.id, changeRequest.id));
  await insertAuditEvent(db, {
    action: "change_request.reviewed",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: { verdict: "closed" },
  });

  const updated = await getChangeRequest(changeRequest.id);
  if (!updated) {
    throw new Error("Failed to close changeRequest");
  }
  return updated;
};

export const listAgentTasks = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const openChangeRequests = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.spaceId, spaceId),
        inArray(busabaseChangeRequests.status, ["in_review", "changes_requested"]),
      ),
    )
    .orderBy(asc(busabaseChangeRequests.createdAt));
  if (openChangeRequests.length === 0) {
    return [];
  }

  const changeRequestIds = openChangeRequests.map((changeRequest) => changeRequest.id);
  const aiCommentRows = await db
    .select()
    .from(busabaseComments)
    .where(
      and(
        eq(busabaseComments.spaceId, spaceId),
        eq(busabaseComments.mentionsAi, true),
        inArray(busabaseComments.changeRequestId, changeRequestIds),
      ),
    )
    .orderBy(asc(busabaseComments.createdAt));
  const aiCommentsByChangeRequest = new Map<string, (typeof aiCommentRows)[0][]>();
  for (const comment of aiCommentRows) {
    if (!comment.changeRequestId) {
      continue;
    }
    const list = aiCommentsByChangeRequest.get(comment.changeRequestId) ?? [];
    list.push(comment);
    aiCommentsByChangeRequest.set(comment.changeRequestId, list);
  }

  const queued = openChangeRequests.filter(
    (changeRequest) =>
      changeRequest.status === "changes_requested" ||
      aiCommentsByChangeRequest.has(changeRequest.id),
  );
  const commentUsers = await resolveUserRefs(aiCommentRows.map((comment) => comment.authorId));

  return Promise.all(
    queued.map(async (changeRequestRow) => {
      const changeRequest = await hydrateChangeRequest(changeRequestRow);
      const latestReview =
        changeRequest.reviews.length > 0
          ? changeRequest.reviews.reduce((latest, review) =>
              review.createdAt > latest.createdAt ? review : latest,
            )
          : null;
      return {
        changeRequest,
        trigger: (changeRequestRow.status === "changes_requested"
          ? "changes_requested"
          : "ai_mention") as AgentTaskTrigger,
        reviewReason: latestReview?.reason ?? null,
        aiComments: (aiCommentsByChangeRequest.get(changeRequestRow.id) ?? []).map((comment) =>
          toCommentVO(comment, commentUsers),
        ) as CommentVO[],
      };
    }),
  );
};

// ── Merge engine ──────────────────────────────────────────────────────────────

export const mergeChangeRequest = async (changeRequestId: string) => {
  try {
    return await _mergeChangeRequest(changeRequestId);
  } catch (err) {
    if (err instanceof ORPCError && err.code === "CONFLICT") {
      // Mark the CR as conflicted so callers can inspect it, and persist the
      // conflicting field list into mergeSummary so the UI can render a diff.
      // Best-effort: if the update fails (e.g. enum not yet migrated), still re-throw original.
      try {
        const db = await getDb();
        const timestamp = now();
        const data = (err.data ?? {}) as { recordId?: string; conflicts?: unknown };
        const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
        await db
          .update(busabaseChangeRequests)
          .set({
            status: "conflict",
            mergeSummary: {
              conflict: {
                recordId: data.recordId ?? null,
                fields: conflicts,
                detectedAt: timestamp.toISOString(),
              },
            },
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(busabaseChangeRequests.id, changeRequestId),
              eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
            ),
          );
      } catch {
        // Ignore status update failure — re-throw the original CONFLICT error below.
      }
    }
    throw err;
  }
};

const _mergeChangeRequest = async (changeRequestId: string) => {
  await ensureReady();
  const db = await getDb();
  const [changeRequest] = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  if (!changeRequest) {
    throw changeRequestNotFound(changeRequestId);
  }
  // Idempotent for already-merged CRs (structural CRs auto-merge on create): a
  // caller re-merging via the old flow gets the merged CR back, not an error.
  if (changeRequest.status === "merged") {
    const already = await getChangeRequest(changeRequest.id);
    if (!already) {
      throw new Error("Failed to load merged changeRequest");
    }
    return { changeRequest: already, record: null, view: null };
  }
  if (changeRequest.status !== "approved") {
    throw changeRequestConflict("ChangeRequest must be approved before merge", {
      status: changeRequest.status,
    });
  }

  const timestamp = now();
  const operationKinds = await db
    .select()
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequest.id))
    .orderBy(asc(busabaseOperations.position), asc(busabaseOperations.createdAt));
  if (operationKinds.length === 0) {
    throw changeRequestBadRequest(`ChangeRequest has no operations: ${changeRequest.id}`);
  }

  const operationHeadCommitIds = operationKinds.map((item) => item.headCommitId);
  const headCommitRows = await db
    .select()
    .from(busabaseCommits)
    .where(inArray(busabaseCommits.id, operationHeadCommitIds));
  const headCommitsById = new Map(headCommitRows.map((commit) => [commit.id, commit]));

  // --- node-targeted change requests ----------------------------------------
  if (changeRequest.targetType === "node") {
    // A node change request can carry MANY operations (nodes.createChangeRequest),
    // and operations can depend on each other ([create folder, create base under
    // it] or [restore node, rename node]). Run the whole batch in one transaction
    // so it is all-or-nothing: a later operation failing rolls back every earlier
    // one instead of leaving the CR half-merged with the rest stuck "approved".
    // Every db touch inside MUST go through `tx` — re-acquiring the getDb()
    // singleton mid-transaction deadlocks the single pglite connection. (Storage
    // file writes are not transactional but are idempotently re-synced on retry.)
    const mergedNodeIds: string[] = [];
    await db.transaction(async (tx) => {
      const ctx: MergeCtx = {
        db: tx as unknown as MergeCtx["db"],
        timestamp,
        actorId: changeRequest.submittedBy,
        headCommitsById,
        targetRecordsById: new Map(),
        targetViewsById: new Map(),
        mergedNodeIds: [],
        mergedRecordIds: [],
        mergedViewIds: [],
        nodeRefs: new Map(),
        resolvedRecordFields: new Map(),
      };
      for (const item of operationKinds) {
        const headCommit = headCommitsById.get(item.headCommitId);
        if (!headCommit) {
          throw new Error(`Operation head commit not found: ${item.headCommitId}`);
        }

        if (item.operation === "node_create") {
          await mergeNodeCreate(ctx, item, headCommit);
          continue;
        }

        if (!item.nodeId) {
          throw new Error(`${item.operation} operation has no nodeId: ${item.id}`);
        }
        // Read through the transaction so dependent ops see prior ops' effects.
        const [node] = await tx
          .select()
          .from(busabaseNodes)
          .where(eq(busabaseNodes.id, item.nodeId))
          .limit(1);
        if (!node) {
          throw new Error(`Node not found: ${item.nodeId}`);
        }

        if (item.operation === "node_rename") {
          await mergeNodeRename(ctx, item, node, headCommit);
        } else if (item.operation === "node_move") {
          await mergeNodeMove(ctx, item, node, headCommit);
        } else if (item.operation === "node_delete") {
          await mergeNodeDelete(ctx, item, node);
        } else if (item.operation === "node_restore") {
          await mergeNodeRestore(ctx, item, node);
        } else if (/^[a-z0-9-]+_file_(create|update|delete)$/.test(item.operation)) {
          await mergeFileTreeFile(ctx, item, node, headCommit);
        } else if (/^[a-z0-9-]+_metadata_update$/.test(item.operation)) {
          await mergeFileTreeMetadata(ctx, item, node, headCommit);
        } else if (item.operation === "doc_update") {
          await mergeDocUpdate(ctx, item, node, headCommit);
        } else {
          throw new Error(`Unsupported node operation: ${item.operation}`);
        }

        await tx
          .update(busabaseOperations)
          .set({ status: "merged", updatedAt: timestamp })
          .where(eq(busabaseOperations.id, item.id));
        ctx.mergedNodeIds.push(item.nodeId);
      }

      await tx
        .update(busabaseChangeRequests)
        .set({
          status: "merged",
          mergeSummary: { mergedNodeIds: [...new Set(ctx.mergedNodeIds)] },
          mergedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(busabaseChangeRequests.id, changeRequest.id));
      mergedNodeIds.push(...ctx.mergedNodeIds);
    });

    await insertAuditEvent(db, {
      action: "change_request.merged",
      actorId: CURRENT_USER_ID,
      baseId: null,
      changeRequestId: changeRequest.id,
      metadata: { mergedNodeIds: [...new Set(mergedNodeIds)] },
    });
    await publishBusabaseLiveEvent({
      kind: "change_request.merged",
      spaceId: getContextSpaceId(),
      actorId: changeRequest.submittedBy,
      changeRequestId: changeRequest.id,
      baseId: null,
      nodeIds: [...new Set(mergedNodeIds)],
      recordIds: [],
      viewIds: [],
      operationCount: operationKinds.length,
    });
    const updated = await getChangeRequest(changeRequest.id);
    if (!updated) {
      throw new Error("Failed to load merged node changeRequest");
    }
    return { changeRequest: updated, record: null, view: null };
  }

  // --- base-targeted change requests ----------------------------------------

  // Reject merge if the base is archived (except for archive operation itself)
  if (changeRequest.baseId) {
    const { busabaseBases } = await import("../domains/base/schema");
    const [baseRow] = await db
      .select({ archivedAt: busabaseBases.archivedAt, deletedAt: busabaseBases.deletedAt })
      .from(busabaseBases)
      .where(eq(busabaseBases.id, changeRequest.baseId))
      .limit(1);
    // A purged base is a terminal state — unlike a plain archive, NOTHING can
    // merge into it, including base_restore (restoring would resurrect it into
    // `bases.list` while its row is only meant to be kept for history).
    if (baseRow?.deletedAt) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot merge into a permanently deleted base",
      });
    }
    const isBaseArchive = operationKinds.every(
      (op) => op.operation === "base_archive" || op.operation === "base_restore",
    );
    if (baseRow?.archivedAt && !isBaseArchive) {
      throw new ORPCError("FORBIDDEN", {
        message: "Cannot merge into an archived base",
      });
    }
  }

  const targetRecordIds = operationKinds
    .filter(
      (item) =>
        item.operation === "record_update" ||
        item.operation === "record_delete" ||
        item.operation === "record_restore",
    )
    .map((item) => item.targetRecordId)
    .filter((targetRecordId): targetRecordId is string => Boolean(targetRecordId));
  // Scope target records to the CR's own base so a crafted CR cannot reach a
  // record in another base/space via a leaked id.
  const targetRecordRows =
    targetRecordIds.length > 0
      ? await db
          .select()
          .from(busabaseRecords)
          .where(
            changeRequest.baseId
              ? and(
                  inArray(busabaseRecords.id, targetRecordIds),
                  eq(busabaseRecords.baseId, changeRequest.baseId),
                )
              : inArray(busabaseRecords.id, targetRecordIds),
          )
      : [];
  const targetRecordsById = new Map(targetRecordRows.map((record) => [record.id, record]));
  const targetViewIds = operationKinds
    .filter(
      (item) =>
        item.operation === "view_update" ||
        item.operation === "view_delete" ||
        item.operation === "view_restore",
    )
    .map((item) => item.targetViewId)
    .filter((targetViewId): targetViewId is string => Boolean(targetViewId));
  const targetViewRows =
    targetViewIds.length > 0
      ? await db.select().from(busabaseViews).where(inArray(busabaseViews.id, targetViewIds))
      : [];
  const targetViewsById = new Map(targetViewRows.map((view) => [view.id, view]));
  const resolvedRecordFields = new Map<string, Record<string, unknown>>();

  for (const item of operationKinds) {
    if (!headCommitsById.has(item.headCommitId)) {
      throw new Error(`Operation head commit not found: ${item.headCommitId}`);
    }

    if (
      item.operation !== "record_update" &&
      item.operation !== "record_delete" &&
      item.operation !== "record_restore"
    ) {
      if (item.operation !== "view_update" && item.operation !== "view_delete") {
        continue;
      }

      if (!item.targetViewId) {
        throw new Error(`${item.operation} item has no target view: ${item.id}`);
      }

      const targetView = targetViewsById.get(item.targetViewId);
      if (!targetView || targetView.status !== "active") {
        throw new Error(`Target view not found: ${item.targetViewId}`);
      }
      continue;
    }

    if (!item.targetRecordId) {
      throw new Error(`${item.operation} item has no target record: ${item.id}`);
    }

    const targetRecord = targetRecordsById.get(item.targetRecordId);
    if (!targetRecord) {
      throw new Error(`Target record not found: ${item.targetRecordId}`);
    }

    // Guard record ops against the target's lifecycle state (mirrors the
    // view_update/view_delete `status !== "active"` check above):
    //  - update/delete require an active record (cannot mutate an archived one)
    //  - restore requires an archived record (nothing to restore otherwise)
    if (item.operation === "record_restore") {
      if (targetRecord.status !== "archived") {
        throw new ORPCError("CONFLICT", {
          message: "Cannot restore a record that is not archived",
        });
      }
    } else if (targetRecord.status !== "active") {
      throw new ORPCError("CONFLICT", {
        message: `Cannot ${item.operation === "record_delete" ? "delete" : "update"} an archived record`,
      });
    }

    if (
      item.operation === "record_update" &&
      item.baseCommitId &&
      targetRecord.headCommitId !== item.baseCommitId
    ) {
      const proposed = headCommitsById.get(item.headCommitId);
      if (!proposed) {
        throw new Error(`Operation head commit not found: ${item.headCommitId}`);
      }
      const [baseCommit] = await db
        .select()
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, item.baseCommitId))
        .limit(1);
      const [oursCommit] = await db
        .select()
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, targetRecord.headCommitId))
        .limit(1);
      const { merged, conflicts } = threeWayMergeFields(
        baseCommit?.fields ?? {},
        oursCommit?.fields ?? {},
        proposed.fields,
      );
      if (conflicts.length > 0) {
        throw new ORPCError("CONFLICT", {
          message: `Cannot merge — the record changed since this change request. Conflicting field${
            conflicts.length === 1 ? "" : "s"
          }: ${conflicts.map((field) => `"${field}"`).join(", ")}. Revise the change request to resolve.`,
          data: { recordId: item.targetRecordId, conflicts },
        });
      }
      resolvedRecordFields.set(item.id, merged);
    }
  }

  // Apply every operation + finalize the CR in one transaction so the merge is
  // all-or-nothing — a guard throwing mid-batch (assertMergedFieldsValid, the
  // required-promotion / remove-choice / convert checks, …) rolls back the
  // operations already applied instead of half-merging. All db touches inside go
  // through `tx`; re-acquiring getDb() mid-transaction would deadlock pglite's
  // single connection (projectCommitFields / asset-usage helpers take the tx).
  const mergedRecordIds: string[] = [];
  const mergedViewIds: string[] = [];
  await db.transaction(async (tx) => {
    const ctx: MergeCtx = {
      db: tx as unknown as MergeCtx["db"],
      timestamp,
      actorId: changeRequest.submittedBy,
      headCommitsById,
      targetRecordsById,
      targetViewsById,
      mergedNodeIds: [],
      mergedRecordIds: [],
      mergedViewIds: [],
      nodeRefs: new Map(),
      resolvedRecordFields,
    };
    for (const item of operationKinds) {
      const headCommit = headCommitsById.get(item.headCommitId);
      if (!headCommit) {
        throw new Error(`Operation head commit not found: ${item.headCommitId}`);
      }

      switch (item.operation) {
        case "record_create":
        case "record_variant":
          await mergeRecordCreateBase(ctx, item, headCommit);
          break;
        case "view_create":
          await mergeViewCreateBase(ctx, item, headCommit);
          break;
        case "view_update":
          await mergeViewUpdateBase(ctx, item, headCommit);
          break;
        case "view_delete":
          await mergeViewDeleteBase(ctx, item, headCommit);
          break;
        case "view_restore":
          await mergeViewRestoreBase(ctx, item, headCommit);
          break;
        case "record_update":
          await mergeRecordUpdateBase(ctx, item, headCommit);
          break;
        case "record_delete":
          await mergeRecordDeleteBase(ctx, item, headCommit);
          break;
        case "base_add_field":
          await mergeBaseAddField(ctx, item, headCommit);
          break;
        case "base_delete_field":
          await mergeBaseDeleteField(ctx, item, headCommit);
          break;
        case "base_update_field":
          await mergeBaseUpdateField(ctx, item, headCommit);
          break;
        case "base_convert_field":
          await mergeBaseConvertField(ctx, item, headCommit);
          break;
        case "base_reorder_fields":
          await mergeBaseReorderFields(ctx, item, headCommit);
          break;
        case "base_restore_field":
          await mergeBaseRestoreField(ctx, item, headCommit);
          break;
        case "base_archive":
          await mergeBaseArchive(ctx, item, headCommit);
          break;
        case "base_restore":
          await mergeBaseRestore(ctx, item, headCommit);
          break;
        case "record_restore":
          await mergeRecordRestore(ctx, item, headCommit);
          break;
        default:
          break;
      }
    }

    await tx
      .update(busabaseChangeRequests)
      .set({
        status: "merged",
        mergedAt: timestamp,
        mergeSummary: {
          operationCount: operationKinds.length,
          recordIds: ctx.mergedRecordIds,
          viewIds: ctx.mergedViewIds,
        },
        updatedAt: timestamp,
      })
      .where(eq(busabaseChangeRequests.id, changeRequest.id));
    mergedRecordIds.push(...ctx.mergedRecordIds);
    mergedViewIds.push(...ctx.mergedViewIds);
  });

  await insertAuditEvent(db, {
    action: "change_request.merged",
    actorId: CURRENT_USER_ID,
    baseId: changeRequest.baseId,
    changeRequestId: changeRequest.id,
    metadata: {
      operationCount: operationKinds.length,
      recordIds: mergedRecordIds,
      viewIds: mergedViewIds,
    },
  });
  await publishBusabaseLiveEvent({
    kind: "change_request.merged",
    spaceId: getContextSpaceId(),
    actorId: changeRequest.submittedBy,
    changeRequestId: changeRequest.id,
    baseId: changeRequest.baseId,
    nodeIds: [],
    recordIds: [...new Set(mergedRecordIds)],
    viewIds: [...new Set(mergedViewIds)],
    operationCount: operationKinds.length,
  });

  const updatedChangeRequest = await getChangeRequest(changeRequest.id);
  const spaceId = getContextSpaceId();
  const [record] =
    mergedRecordIds.length > 0
      ? await db
          .select()
          .from(busabaseRecords)
          .where(
            and(eq(busabaseRecords.id, mergedRecordIds[0]), eq(busabaseRecords.spaceId, spaceId)),
          )
          .limit(1)
      : [];
  const [view] =
    mergedViewIds.length > 0
      ? await db
          .select()
          .from(busabaseViews)
          .where(and(eq(busabaseViews.id, mergedViewIds[0]), eq(busabaseViews.spaceId, spaceId)))
          .limit(1)
      : [];
  if (!updatedChangeRequest) {
    throw new Error("Failed to merge changeRequest");
  }
  return {
    changeRequest: updatedChangeRequest,
    record: record ? await hydrateRecord(record) : null,
    view: view ? toViewVO(view, await resolveUserRefs([view.createdBy])) : null,
  };
};

export interface BatchChangeRequestResult {
  results: Array<{ changeRequestId: string; ok: boolean; status?: string; error?: string }>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Review many change requests with the same verdict in one call (for an agent
 * clearing a review queue — "approve all of these"). Each is reviewed independently;
 * a failure (not found / not reviewable) is recorded and the rest still process, so
 * the caller gets a full per-item report instead of an all-or-nothing abort.
 */
export const reviewChangeRequests = async (
  changeRequestIds: string[],
  input: z.infer<typeof reviewInputSchema>,
): Promise<BatchChangeRequestResult> => {
  const results: BatchChangeRequestResult["results"] = [];
  for (const changeRequestId of changeRequestIds) {
    try {
      const changeRequest = await reviewChangeRequest(changeRequestId, input);
      results.push({ changeRequestId, ok: true, status: changeRequest.status });
    } catch (error) {
      results.push({ changeRequestId, ok: false, error: errorMessage(error) });
    }
  }
  return { results };
};

/**
 * Merge many change requests in one call ("merge all of these"). Each merges in its
 * OWN transaction and in the given order, with failures isolated — so a later
 * conflicting merge does not roll back the ones already merged, and the caller sees
 * exactly which succeeded. Order matters when the change requests depend on one another.
 */
export const mergeChangeRequests = async (
  changeRequestIds: string[],
): Promise<BatchChangeRequestResult> => {
  const results: BatchChangeRequestResult["results"] = [];
  for (const changeRequestId of changeRequestIds) {
    try {
      const merged = await mergeChangeRequest(changeRequestId);
      results.push({ changeRequestId, ok: true, status: merged.changeRequest.status });
    } catch (error) {
      results.push({ changeRequestId, ok: false, error: errorMessage(error) });
    }
  }
  return { results };
};
