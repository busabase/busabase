import "server-only";

import { ORPCError } from "@orpc/server";
import {
  searchNodesByNameInputSchema,
  updateNodeMetadataInputSchema,
} from "busabase-contract/contract/schemas";
import { CREATABLE_NODE_TYPES } from "busabase-contract/domains";
import { fieldNameSchema } from "busabase-contract/domains/base/contract/base-schemas";
import {
  HtmlDocumentSchema,
  WhiteboardDocumentSchema,
  WorkflowDocumentSchema,
} from "busabase-contract/domains/rich-node/types";
import type { NodeSearchResultVO, NodeVO } from "busabase-contract/types";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { storage } from "openlib/storage";
import { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../context";
import { getDb } from "../db";
import {
  busabaseBases,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseFavorites,
  busabaseNodes,
  busabaseOperations,
} from "../db/schema";
import { docBodyKey } from "../domains/doc/handlers";
import { insertAuditEvent } from "./audit";
import { id, now, rootNodeIdForSpace } from "./kernel";
import { publishChangeRequestPendingReview } from "./live-events";
import { assertNodePermission, assertNodeVisible, buildNodeVisibilityCondition } from "./node-acl";
import { buildNodeTree, ensureReady } from "./seed";
import { toNodeSearchResultVO, toNodeVO } from "./vo";

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
  autoMerge: z.boolean().optional().default(false),
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

export interface ListNodesInput {
  parentId?: string | null;
  depth?: number;
}

const DEFAULT_NODE_LIST_DEPTH = 2;
// A depth-bounded fetch is `depth` sequential level-by-level round trips (see
// listNodesBounded below) — no `WITH RECURSIVE` precedent exists elsewhere in
// this codebase, and a handful of round trips per lazy-expand/eager-prefetch
// call is easy to review and plenty fast for a sidebar tree. The cap keeps a
// caller from turning one `nodes.list` request into an unbounded number of
// them against a pathologically deep tree.
const MAX_NODE_LIST_DEPTH = 5;

const clampDepth = (depth: number | undefined): number =>
  Math.min(Math.max(Math.trunc(depth ?? DEFAULT_NODE_LIST_DEPTH), 1), MAX_NODE_LIST_DEPTH);

const fetchBaseRowsForNodeIds = async (db: Awaited<ReturnType<typeof getDb>>, nodeIds: string[]) =>
  nodeIds.length
    ? db.select().from(busabaseBases).where(inArray(busabaseBases.nodeId, nodeIds))
    : [];

/** One level's non-archived children of `parentIds` (empty input short-circuits). */
const fetchChildNodeRows = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  parentIds: string[],
) =>
  parentIds.length
    ? db
        .select()
        .from(busabaseNodes)
        .where(
          and(
            eq(busabaseNodes.spaceId, spaceId),
            inArray(busabaseNodes.parentId, parentIds),
            isNull(busabaseNodes.archivedAt),
            buildNodeVisibilityCondition(db),
          ),
        )
        .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt))
    : [];

/** The space-root row(s) — `parentId IS NULL` (today, always exactly one per space). */
const fetchRootNodeRows = async (db: Awaited<ReturnType<typeof getDb>>, spaceId: string) =>
  db
    .select()
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.spaceId, spaceId), isNull(busabaseNodes.parentId)))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));

/**
 * Which of `ids` have at least one (non-archived) child — a single grouped
 * existence query, NOT one query per node, so annotating `hasChildren` on a
 * depth boundary stays O(1) round trips regardless of how many nodes sit at
 * that boundary.
 */
const idsWithChildren = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  ids: string[],
): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ parentId: busabaseNodes.parentId })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        inArray(busabaseNodes.parentId, ids),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .groupBy(busabaseNodes.parentId);
  return new Set(rows.map((row) => row.parentId).filter((id): id is string => id !== null));
};

/**
 * Depth-bounded fetch, `depth` levels below `parentId` (or the space root
 * when `parentId` is null): a `depth`-round-trip level-by-level BFS (bounded,
 * see MAX_NODE_LIST_DEPTH above) instead of one unbounded query.
 *
 * `parentId === null`: mirrors the legacy envelope exactly — returns the
 * single wrapped root node, with `children` populated `depth` levels beneath
 * it (so `depth: 2` = root + its children + its grandchildren).
 *
 * `parentId` given: returns that node's CHILDREN directly (not wrapped),
 * each populated `depth - 1` further levels beneath — the shape a sidebar's
 * lazy "expand this folder" wants to merge straight into `NodeVO.children`.
 *
 * Either way, `hasChildren` is exact for every returned node except the
 * deepest fetched level, where it's backfilled via `idsWithChildren`.
 */
const listNodesBounded = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  parentId: string | null,
  rawDepth: number | undefined,
): Promise<NodeVO[]> => {
  const depth = clampDepth(rawDepth);
  const rootRows = parentId === null ? await fetchRootNodeRows(db, spaceId) : [];
  const allRows = [...rootRows];
  let frontier = parentId === null ? rootRows.map((row) => row.id) : [parentId];
  let deepestLevelIds = parentId === null ? frontier : [];

  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const rows = await fetchChildNodeRows(db, spaceId, frontier);
    allRows.push(...rows);
    deepestLevelIds = rows.map((row) => row.id);
    frontier = deepestLevelIds;
  }

  const [hasChildrenIds, baseRows] = await Promise.all([
    idsWithChildren(db, spaceId, deepestLevelIds),
    fetchBaseRowsForNodeIds(
      db,
      allRows.map((row) => row.id),
    ),
  ]);

  return buildNodeTree(allRows, baseRows, {
    rootParentId: parentId,
    forceHasChildrenIds: hasChildrenIds,
  });
};

export const listNodes = async (input?: ListNodesInput): Promise<NodeVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  // Legacy full-tree call — preserved byte-for-byte (one unbounded query, no
  // level-by-level round trips) for every existing caller that hasn't opted
  // into the new bounded contract (CLI, SDK, mobile app, tests, and
  // busabase-cloud's own dashboard, none of which implement lazy-expand yet).
  // Only a caller that explicitly sets `parentId` and/or `depth` gets the
  // depth-bounded behavior below.
  if (input?.parentId === undefined && input?.depth === undefined) {
    const [nodeRows, baseRows] = await Promise.all([
      db
        .select()
        .from(busabaseNodes)
        // Exclude archived nodes (archived base nodes are kept but must leave the
        // tree, mirroring how bases.list hides archived bases) and nodes the
        // actor can't see (node ACL; a hidden folder structurally hides its
        // subtree because buildNodeTree only assembles rows that came back).
        .where(
          and(
            eq(busabaseNodes.spaceId, spaceId),
            isNull(busabaseNodes.archivedAt),
            buildNodeVisibilityCondition(db),
          ),
        )
        .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt)),
      db.select().from(busabaseBases).where(eq(busabaseBases.spaceId, spaceId)),
    ]);
    return buildNodeTree(nodeRows, baseRows);
  }

  return listNodesBounded(db, spaceId, input.parentId ?? null, input.depth);
};

/**
 * Server-authoritative ancestor check: does `nodeId`'s `parentId` chain reach
 * `potentialAncestorId`? Walks one row at a time (workspace trees are
 * shallow; no recursive-CTE precedent elsewhere in this codebase — see
 * `listNodesBounded` above). A node is never its own descendant.
 *
 * Backs the sidebar's drag-and-drop cross-branch cycle guard: with the tree
 * now lazily loaded beyond the eager-prefetch depth, a purely client-side
 * walk over whatever happens to be loaded can no longer be trusted to catch
 * "drop this folder into one of its own descendants" — the descendant in
 * question might not be loaded client-side at all.
 */
export const isDescendantOf = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  nodeId: string,
  potentialAncestorId: string,
): Promise<boolean> => {
  if (nodeId === potentialAncestorId) return false;
  const visited = new Set<string>();
  let cursorId: string | null = nodeId;
  while (cursorId) {
    if (visited.has(cursorId)) return false; // cycle guard against corrupt data
    visited.add(cursorId);
    const [row] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.id, cursorId), eq(busabaseNodes.spaceId, spaceId)))
      .limit(1);
    if (!row) return false;
    if (row.parentId === potentialAncestorId) return true;
    cursorId = row.parentId;
  }
  return false;
};

/**
 * Flat list of archived folder/doc/skill nodes for the Trash view. Base nodes are
 * excluded — an archived base is surfaced (and restored) via `bases.listArchived`.
 * Permanently-deleted (`deletedAt`) nodes are excluded too — once purged, an item
 * leaves the Trash for good even though its row is kept.
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
        isNull(busabaseNodes.deletedAt),
        ne(busabaseNodes.type, "base"),
        buildNodeVisibilityCondition(db),
      ),
    )
    .orderBy(desc(busabaseNodes.archivedAt));
  return nodeRows.map((node) => toNodeVO(node, null));
};

/**
 * Cheap name/slug-only lookup across all registered node types — the backend
 * half of the dashboard quick-jump
 * palette's `KnownNode` cache-miss path (see
 * apps/busabase/content/spec/search-quick-jump.md). Deliberately NOT bolted
 * onto `searchBusabase` (logic/search.ts), which also does 5s-budgeted
 * asset-body scanning and full-text ranking — the wrong cost profile for
 * "find a node by the name I already know." Just a plain `ilike` on
 * `name`/`slug`, scoped through the same `buildNodeVisibilityCondition` ACL
 * every other node-listing query in this file already uses, ordered
 * exact-slug-match first (case-insensitive) so a known name always sorts to
 * the top, then alphabetically.
 */
export const searchNodesByName = async (
  input: z.input<typeof searchNodesByNameInputSchema>,
): Promise<NodeSearchResultVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = searchNodesByNameInputSchema.parse(input);
  const query = parsed.query.trim();
  if (!query) return [];
  // PostgreSQL LIKE treats %, _ and \\ as pattern syntax. Search-by-name is a
  // literal substring lookup, so user input must not broaden the result set.
  const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escapedQuery}%`;

  const rows = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
        or(ilike(busabaseNodes.name, pattern), ilike(busabaseNodes.slug, pattern)),
      ),
    )
    .orderBy(desc(sql`lower(${busabaseNodes.slug}) = lower(${query})`), asc(busabaseNodes.name))
    .limit(parsed.limit);

  return rows.map(toNodeSearchResultVO);
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
 * Permanently delete an archived node (and its subtree) from the Trash.
 * Irreversible from the UI's perspective, but implemented as a SOFT delete: every
 * row in the subtree is stamped with `deletedAt` and kept forever (never a real
 * `db.delete()`), so it disappears from every list/tree/search query without
 * touching history (operations/commits/change-requests referencing it are left
 * untouched — they were only ever hard-deleted before to satisfy delete
 * ordering, which no longer applies now that nothing is physically removed).
 * This also sidesteps the Base commit history's FK-restrict on `busabaseBases`
 * that made a hard delete impossible for a Base subtree, so — unlike the old
 * hard-delete path — a subtree containing a Base is now allowed: the Base's
 * `busabase_bases` row (and any nested Bases') is soft-deleted in lockstep via
 * its 1:1 `nodeId`.
 *
 * Doc nodes are the one type backed by an object-storage blob outside this
 * table (`doc/handlers.ts`'s `docBodyKey` — a markdown object keyed by
 * nodeId, not tracked in any DB row). Nothing else in the codebase ever
 * deletes that object (`node_delete`'s soft-archive path must NOT touch it —
 * restore needs the body back), so purge — the one point genuinely never
 * reachable again — is where it's safe to free it: the full body already
 * survives forever in `busabase_commits.fields.body` history, so deleting the
 * live object here is not a loss of the "kept forever" audit guarantee above,
 * just the removal of a copy nothing will ever read again.
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
      message:
        "Only archived items can be permanently deleted. Archive it first (submit a delete-kind ChangeRequest and merge it), then purge again.",
    });
  }
  if (node.deletedAt) {
    throw new ORPCError("CONFLICT", {
      message: "This item was already permanently deleted.",
    });
  }
  const subtreeIds = await collectSubtreeIds(db, nodeId);
  const timestamp = now();

  await db
    .update(busabaseNodes)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(inArray(busabaseNodes.id, subtreeIds));

  // Free any Doc bodies' storage objects in the purged subtree — see the
  // module doc above for why this is the one safe point to do it. Best-effort
  // and non-blocking: a storage hiccup here must never fail the purge itself
  // (the DB rows are already the source of truth; `deleteObject` on either
  // provider is itself safe against a missing/already-gone key).
  const docNodeRows = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(and(inArray(busabaseNodes.id, subtreeIds), eq(busabaseNodes.type, "doc")));
  if (docNodeRows.length > 0) {
    await Promise.allSettled(docNodeRows.map((row) => storage.deleteObject(docBodyKey(row.id))));
  }

  // Soft-delete any Base(s) in the subtree in lockstep (nodeId is a 1:1 FK to the
  // node), mirroring how archive/restore keep the two tables in sync elsewhere.
  const baseRows = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(inArray(busabaseBases.nodeId, subtreeIds));
  if (baseRows.length > 0) {
    await db
      .update(busabaseBases)
      .set({ deletedAt: timestamp })
      .where(
        inArray(
          busabaseBases.id,
          baseRows.map((b) => b.id),
        ),
      );
  }

  // No change request — record it so the audit trail is complete (this is the
  // one mutation the UI treats as irreversible).
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
  const requiredLevel = parsed.autoMerge ? "write" : "changeRequest";

  // ChangeRequest-submission gate (node ACL): proposing against an existing
  // node requires `changeRequest` level on it; creating a new node requires it
  // on the target parent. A create op parented to a ref (a node THIS CR
  // creates) is covered by that earlier create op's own parent check.
  for (const operation of parsed.operations) {
    if (operation.kind === "create") {
      if (!operation.parentNodeRef) {
        await assertNodePermission(
          operation.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId()),
          requiredLevel,
          submittedBy,
        );
      }
    } else {
      await assertNodePermission(operation.nodeId, requiredLevel, submittedBy);
    }
  }

  const changeRequestId = id("crq");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: null,
    status: "in_review",
    submittedBy,
    sourceMeta: withContextSourceMeta({ subject: "node_tree" }),
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

  if (parsed.autoMerge) {
    // Only explicit "create now" / setup flows auto-merge; plain
    // nodes.createChangeRequest is review-first by default.
    const { autoApproveAndMerge } = await import("./cr-lifecycle");
    const merged = await autoApproveAndMerge(changeRequestId);
    return merged.changeRequest;
  }

  // Review-first path (the UI's default "New" flow): this CR is now sitting in
  // someone's inbox waiting on a human, so fire the pending-review signal —
  // never for the autoMerge branch above, which never becomes reviewable.
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: null,
    changeRequestId,
    submittedBy,
  });

  const { getChangeRequest } = await import("./cr-lifecycle");
  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error(`Failed to create node change request: ${changeRequestId}`);
  }
  return changeRequest;
};

export const moveNodeInputSchema = z.object({
  nodeId: z.string(),
  parentNodeId: z.string().optional(),
  position: z.number().int().optional(),
  message: z.string().optional(),
  submittedBy: z.string().optional(),
});

// Ergonomic single-node wrapper around createNodeChangeRequest's generic "move"
// operation: reordering/reparenting is a low-risk structural tweak, so it
// auto-merges immediately instead of sitting in review like content changes.
export const moveNode = async (input: z.input<typeof moveNodeInputSchema>) => {
  const parsed = moveNodeInputSchema.parse(input);
  return createNodeChangeRequest({
    message: parsed.message ?? "Reorder node",
    submittedBy: parsed.submittedBy,
    autoMerge: true,
    operations: [
      {
        kind: "move",
        nodeId: parsed.nodeId,
        parentNodeId: parsed.parentNodeId,
        position: parsed.position,
      },
    ],
  });
};

// Rich-node document keys carry structured graphs/canvases, not free-form
// fields — an invalid write here isn't just cosmetic, it silently resets the
// whole document to empty the next time `parseXxxDocument` reads it back.
// Reject bad writes up front instead of persisting them.
const RICH_NODE_DOCUMENT_SCHEMAS: Partial<Record<string, { key: string; schema: z.ZodTypeAny }>> = {
  whiteboard: { key: "whiteboardDocument", schema: WhiteboardDocumentSchema },
  workflow: { key: "workflowDocument", schema: WorkflowDocumentSchema },
  html: { key: "htmlDocument", schema: HtmlDocumentSchema },
};

/** Direct, audited top-level metadata merge for SDK-managed node identities. */
export const updateNodeMetadata = async (
  input: z.input<typeof updateNodeMetadataInputSchema>,
): Promise<NodeVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = updateNodeMetadataInputSchema.parse(input);
  const actorId = resolveActorId("local-user");

  const [node] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, parsed.nodeId),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    )
    .limit(1);
  if (!node) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${parsed.nodeId}` });
  }

  const richNodeDocument = RICH_NODE_DOCUMENT_SCHEMAS[node.type];
  if (richNodeDocument && richNodeDocument.key in parsed.metadata) {
    const result = richNodeDocument.schema.safeParse(parsed.metadata[richNodeDocument.key]);
    if (!result.success) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Invalid ${richNodeDocument.key} for node ${parsed.nodeId}: ${result.error.message}`,
      });
    }
  }

  await assertNodePermission(node.id, "write", actorId);
  const timestamp = now();
  const metadataPatch = JSON.stringify(parsed.metadata);
  const [updatedNode] = await db
    .update(busabaseNodes)
    // PostgreSQL's jsonb concatenation is an atomic top-level merge, so
    // concurrent patches to different keys cannot overwrite one another.
    .set({
      metadata: sql<typeof node.metadata>`${busabaseNodes.metadata} || ${metadataPatch}::jsonb`,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(busabaseNodes.id, node.id),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    )
    .returning();
  if (!updatedNode) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${parsed.nodeId}` });
  }

  const [base] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.nodeId, updatedNode.id),
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.deletedAt),
      ),
    )
    .limit(1);

  await insertAuditEvent(db, {
    action: "node.metadata_updated",
    actorId,
    baseId: base?.id ?? null,
    metadata: {
      nodeId: updatedNode.id,
      updatedKeys: Object.keys(parsed.metadata).sort(),
    },
  });

  return toNodeVO(updatedNode, base?.id ?? null);
};

/**
 * Toggle the current actor's favorite on a node — Notion-style "⭐ Favorites":
 * a true upsert-or-delete against the `(nodeId, actorId)` unique pair
 * (`busabase_favorites_node_actor_uniq`), never a blind insert. Race-safe at
 * the DB level, not just in-app: a concurrent double-toggle (two rapid clicks
 * before the first settles) can never create a duplicate row — the losing
 * insert is a no-op via `onConflictDoNothing`, so the pair always ends in a
 * single consistent state. Requires the node to be visible to the actor
 * first — favoriting an unknown/invisible nodeId is a clean NOT_FOUND, never
 * a silent no-op. Purely additive: never touches the node's real position in
 * the tree, only this side table.
 */
export const toggleNodeFavorite = async (
  nodeId: string,
  actorId: string,
): Promise<{ favorited: boolean }> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  await assertNodeVisible(nodeId, actorId);

  const [existing] = await db
    .select({ id: busabaseFavorites.id })
    .from(busabaseFavorites)
    .where(and(eq(busabaseFavorites.nodeId, nodeId), eq(busabaseFavorites.actorId, actorId)))
    .limit(1);

  if (existing) {
    await db.delete(busabaseFavorites).where(eq(busabaseFavorites.id, existing.id));
    return { favorited: false };
  }

  await db
    .insert(busabaseFavorites)
    .values({ id: id("fav"), spaceId, nodeId, actorId, createdAt: now() })
    .onConflictDoNothing();
  return { favorited: true };
};

/**
 * The current actor's favorited nodes, newest-favorited first, PO→VO mapped
 * via the same `toNodeVO` mapper every other node read uses. Filtered through
 * the SAME `archivedAt IS NULL` + `buildNodeVisibilityCondition` predicate
 * `listNodes`/`searchBusabase` already apply (not a second, possibly
 * diverging filter) — a favorited node that's later archived, purged, or
 * (cloud) hidden from this actor silently drops out of the list. The
 * `busabase_favorites` row itself is left untouched either way: a later
 * restore / visibility grant makes the node reappear on the next fetch,
 * since this is a read-time filter, not a destructive delete of the favorite.
 */
export const listFavoriteNodes = async (actorId: string): Promise<NodeVO[]> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const rows = await db
    .select({ node: busabaseNodes })
    .from(busabaseFavorites)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseFavorites.nodeId))
    .where(
      and(
        eq(busabaseFavorites.actorId, actorId),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db, actorId),
      ),
    )
    .orderBy(desc(busabaseFavorites.createdAt));

  const favoriteNodes = rows.map((row) => row.node);
  if (favoriteNodes.length === 0) return [];

  const baseRows = await fetchBaseRowsForNodeIds(
    db,
    favoriteNodes.map((node) => node.id),
  );
  const baseIdByNodeId = new Map(baseRows.map((base) => [base.nodeId, base.id]));
  return favoriteNodes.map((node) => toNodeVO(node, baseIdByNodeId.get(node.id) ?? null));
};
