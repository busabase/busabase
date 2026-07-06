import "server-only";

import { ORPCError } from "@orpc/server";
import { CREATABLE_NODE_TYPES } from "busabase-contract/domains";
import { fieldNameSchema } from "busabase-contract/domains/base/contract/base-schemas";
import type { NodeVO } from "busabase-contract/types";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../context";
import { getDb } from "../db";
import {
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
} from "../db/schema";
import { insertAuditEvent } from "./audit";
import { id, now } from "./kernel";
import { buildNodeTree, ensureReady } from "./seed";
import { toNodeVO } from "./vo";

export { toNodeVO };

// Schema defined locally to avoid circular deps with store.ts
const nodeOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    // In-CR temp id for this node; a later operation can set parentNodeRef to it.
    ref: z.string().min(1).optional(),
    parentNodeId: z.string().optional(),
    // Parent this node under a node an EARLIER operation in the same CR created.
    parentNodeRef: z.string().min(1).optional(),
    nodeType: z.enum(CREATABLE_NODE_TYPES),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().optional().default(""),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    fields: z
      .array(
        z.object({
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/),
          name: fieldNameSchema,
          type: z.string().optional().default("text"),
          required: z.boolean().optional().default(false),
          options: z.record(z.string(), z.unknown()).optional().default({}),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("rename"),
    nodeId: z.string(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal("delete"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("restore"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("move"),
    nodeId: z.string(),
    // Exactly one of parentNodeId / parentNodeRef (validated in createNodeChangeRequest).
    parentNodeId: z.string().optional(),
    parentNodeRef: z.string().min(1).optional(),
    position: z.number().int().optional(),
  }),
]);

export const createNodeChangeRequestInputSchema = z.object({
  message: z.string().optional().default("Update node tree"),
  submittedBy: z.string().optional().default("local-producer"),
  operations: z.array(nodeOperationInputSchema).min(1),
});

type NodeOperationInput = z.infer<typeof nodeOperationInputSchema>;

/**
 * Validate in-CR temp references up front (before any write): a `parentNodeRef`
 * must name a `ref` declared by an EARLIER operation (topological order, no
 * forward/self references), refs are unique, and an operation may not set both
 * `parentNodeId` and `parentNodeRef`. This keeps the failure at submission time
 * with a clear message instead of surfacing mid-merge.
 */
const assertValidNodeRefs = (operations: NodeOperationInput[]) => {
  const declaredRefs = new Set<string>();
  operations.forEach((operation, index) => {
    const parentNodeId = "parentNodeId" in operation ? operation.parentNodeId : undefined;
    const parentNodeRef = "parentNodeRef" in operation ? operation.parentNodeRef : undefined;
    if (parentNodeId && parentNodeRef) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Operation ${index} sets both parentNodeId and parentNodeRef — use exactly one.`,
      });
    }
    if (parentNodeRef && !declaredRefs.has(parentNodeRef)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Operation ${index} references parentNodeRef "${parentNodeRef}", which no earlier operation declares (references cannot be forward or self).`,
      });
    }
    if (operation.kind === "create" && operation.ref) {
      if (declaredRefs.has(operation.ref)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Duplicate node ref "${operation.ref}" — each ref must be unique within a change request.`,
        });
      }
      declaredRefs.add(operation.ref);
    }
  });
};

export const listNodes = async (): Promise<NodeVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [nodeRows, baseRows] = await Promise.all([
    db
      .select()
      .from(busabaseNodes)
      // Exclude archived nodes (archived base nodes are kept but must leave the
      // tree, mirroring how bases.list hides archived bases).
      .where(and(eq(busabaseNodes.spaceId, spaceId), isNull(busabaseNodes.archivedAt)))
      .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt)),
    db.select().from(busabaseBases).where(eq(busabaseBases.spaceId, spaceId)),
  ]);
  return buildNodeTree(nodeRows, baseRows);
};

/**
 * Flat list of archived folder/doc/skill nodes for the Trash view. Base nodes are
 * excluded — an archived base is surfaced (and restored) via `bases.listArchived`.
 */
export const listArchivedNodes = async (): Promise<NodeVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const nodeRows = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        isNotNull(busabaseNodes.archivedAt),
        ne(busabaseNodes.type, "base"),
      ),
    )
    .orderBy(desc(busabaseNodes.archivedAt));
  return nodeRows.map((node) => toNodeVO(node, null));
};

export const loadNodesByIds = async (nodeIds: string[]): Promise<Map<string, NodeVO>> => {
  if (nodeIds.length === 0) {
    return new Map<string, NodeVO>();
  }
  // Query nodes directly (NOT via listNodes) so this still resolves archived
  // base nodes — change-request hydration must find the node a merged
  // node_delete / base archive CR targets even after it left the tree.
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const nodeRows = await db
    .select()
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.spaceId, spaceId), inArray(busabaseNodes.id, nodeIds)));
  const baseRows = nodeRows.length
    ? await db
        .select({ id: busabaseBases.id, nodeId: busabaseBases.nodeId })
        .from(busabaseBases)
        .where(
          inArray(
            busabaseBases.nodeId,
            nodeRows.map((n) => n.id),
          ),
        )
    : [];
  const baseIdByNodeId = new Map(baseRows.map((b) => [b.nodeId, b.id]));
  return new Map(
    nodeRows.map((node) => [node.id, toNodeVO(node, baseIdByNodeId.get(node.id) ?? null)]),
  );
};

/** Collect a node id + all of its descendants (regardless of archived state). */
const collectSubtreeIds = async (
  db: Awaited<ReturnType<typeof getDb>>,
  rootId: string,
): Promise<string[]> => {
  const collected = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(inArray(busabaseNodes.parentId, frontier));
    frontier = children.map((c) => c.id);
    collected.push(...frontier);
  }
  return collected;
};

/**
 * Permanently delete an archived folder/doc/skill node (and its subtree) from the
 * Trash. Irreversible. Refused unless the node is archived, and refused if the
 * subtree contains a Base (a Base's commit history is FK-restricted and is a
 * separate concern). Deletes in dependency order — operations → commits →
 * change-requests → nodes — because operations.headCommitId restricts commits.
 */
export const purgeNode = async (nodeId: string): Promise<{ purged: boolean }> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [node] = await db
    .select()
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, spaceId)))
    .limit(1);
  if (!node) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
  }
  if (!node.archivedAt) {
    throw new ORPCError("CONFLICT", {
      message: "Only archived items can be permanently deleted. Delete it first.",
    });
  }
  const subtreeIds = await collectSubtreeIds(db, nodeId);
  const subtreeNodes = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(inArray(busabaseNodes.id, subtreeIds));
  if (subtreeNodes.some((n) => n.type === "base")) {
    throw new ORPCError("CONFLICT", {
      message:
        "Cannot permanently delete a folder that contains a Base. Restore it and remove the Base first.",
    });
  }

  // Dependency-ordered hard delete (operations reference commits via a RESTRICT
  // FK, so a single cascade from nodes could evaluate them out of order).
  const crRows = await db
    .select({ id: busabaseChangeRequests.id })
    .from(busabaseChangeRequests)
    .where(inArray(busabaseChangeRequests.nodeId, subtreeIds));
  const crIds = crRows.map((c) => c.id);
  if (crIds.length > 0) {
    await db.delete(busabaseOperations).where(inArray(busabaseOperations.changeRequestId, crIds));
  }
  await db.delete(busabaseOperations).where(inArray(busabaseOperations.nodeId, subtreeIds));
  await db.delete(busabaseCommits).where(inArray(busabaseCommits.nodeId, subtreeIds));
  if (crIds.length > 0) {
    await db.delete(busabaseChangeRequests).where(inArray(busabaseChangeRequests.id, crIds));
  }
  await db.delete(busabaseNodes).where(inArray(busabaseNodes.id, subtreeIds));
  // Permanent destructive delete (no change request) — record it so the audit
  // trail is complete (this is the one mutation that cannot be undone).
  await insertAuditEvent(db, {
    action: "node.purged",
    metadata: {
      nodeId,
      slug: node.slug,
      type: node.type,
      purgedNodeCount: subtreeIds.length,
    },
  });
  return { purged: true };
};

export const createNodeChangeRequest = async (
  input: z.input<typeof createNodeChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = createNodeChangeRequestInputSchema.parse(input);
  assertValidNodeRefs(parsed.operations);
  const submittedBy = resolveActorId(parsed.submittedBy);
  const changeRequestId = id("crq");
  const timestamp = now();

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

  for (const [position, operation] of parsed.operations.entries()) {
    const operationId = id("opr");
    const commitId = id("cmt");
    const operationKind =
      operation.kind === "create"
        ? "node_create"
        : operation.kind === "rename"
          ? "node_rename"
          : operation.kind === "delete"
            ? "node_delete"
            : operation.kind === "restore"
              ? "node_restore"
              : "node_move";
    const nodeId = operation.kind === "create" ? null : operation.nodeId;

    await db.insert(busabaseCommits).values({
      id: commitId,
      baseId: null,
      targetType: "node",
      nodeId,
      operationId: null,
      parentCommitId: null,
      fields: operation,
      operation: operationKind,
      message: parsed.message,
      author: submittedBy,
      createdAt: timestamp,
    });
    await db.insert(busabaseOperations).values({
      id: operationId,
      changeRequestId,
      baseId: null,
      targetType: "node",
      nodeId,
      operation: operationKind,
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
    metadata: { operation: "node_tree_update" },
  });

  const { getChangeRequest } = await import("./cr-lifecycle");
  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create node change request");
  }
  return changeRequest;
};
