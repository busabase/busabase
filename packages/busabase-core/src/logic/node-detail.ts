import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodeType } from "busabase-contract/domains";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getContextSpaceId, isAnonymousVisitor, isEmbedVisitor, resolveUserRefs } from "../context";
import { getDb } from "../db";
import {
  busabaseAuditEvents,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  type NodePO,
} from "../db/schema";
import { collectAncestorIds } from "./ancestor-chain";
import { denyAnonymousNodeType, isAnonymousReadableNodeType } from "./anonymous-allowlist";
// Side-effect import: guarantees every builtin node type has registered its
// server-side behaviour before the dispatch below reads the registry. Importing
// the one barrel (rather than hand-listing domains here) is deliberate — see
// that module for the silent-fallback bug hand-listing caused.
import "./builtin-node-runtimes";
import { resolveVisibleNode } from "./node-resolve";
import { getNodeRuntime } from "./node-runtime";
import { ensureReady } from "./seed";
import { loadNodesByIds, toNodeVO } from "./store";

/**
 * `nodes.get` — one typed detail read for every node type, replacing
 * `docs.get`, `files.get`, `folders.get`, and `fileTrees.get`.
 *
 * ORDER MATTERS, and it is the security property of this file:
 *
 *   1. resolve the node row (id or slug) THROUGH the node-visibility ACL,
 *   2. apply the anonymous-visitor node-type gate,
 *   3. only then hand off to the owning domain's hydration.
 *
 * Never the other way round. Hydration reads a Doc body out of object storage,
 * signs an Asset URL, or walks a whole file inventory — doing any of that for a
 * node the caller cannot see is a data leak even if the response is discarded.
 * A hidden or cross-space node must look exactly like an absent one (404).
 */

/**
 * The plain node row, for a type whose detail is just that (`base`, `form`).
 * `loadNodesByIds` rather than a bare `toNodeVO` so a Base node still resolves
 * its `baseId`.
 *
 * Reached only through an explicit `genericDetail: true` registration, never as
 * a fallback — see `NodeRuntime.genericDetail`.
 */
const buildGenericDetail = async (node: NodePO): Promise<NodeDetailVO> => {
  const nodeMap = await loadNodesByIds([node.id]);
  return {
    type: node.type,
    node: nodeMap.get(node.id) ?? toNodeVO(node, null),
  } as NodeDetailVO;
};

/** Resolve identities only for the opened node, after its visibility check. */
const withAttribution = async (detail: NodeDetailVO, node: NodePO): Promise<NodeDetailVO> => {
  // A publicly readable document does not expose the workspace's member directory.
  if (isAnonymousVisitor() || isEmbedVisitor()) return detail;
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [operations, audits] = await Promise.all([
    db
      .select({ author: busabaseCommits.author, updatedAt: busabaseOperations.updatedAt })
      .from(busabaseOperations)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseOperations.headCommitId))
      .innerJoin(
        busabaseChangeRequests,
        eq(busabaseChangeRequests.id, busabaseOperations.changeRequestId),
      )
      .where(
        and(
          eq(busabaseOperations.nodeId, node.id),
          eq(busabaseOperations.spaceId, spaceId),
          eq(busabaseCommits.spaceId, spaceId),
          eq(busabaseChangeRequests.spaceId, spaceId),
          eq(busabaseOperations.status, "merged"),
          eq(busabaseChangeRequests.status, "merged"),
          // Record/field/view edits have their own timestamps and attribution;
          // only the Base's archive/restore operations change the node itself.
          or(
            eq(busabaseOperations.targetType, "node"),
            inArray(busabaseOperations.operation, ["base_archive", "base_restore"]),
          ),
        ),
      )
      // Submission time can differ from merge order; only applied edits count.
      .orderBy(desc(busabaseOperations.updatedAt), desc(busabaseOperations.id))
      .limit(1),
    db
      .select({ author: busabaseAuditEvents.actorId, updatedAt: busabaseAuditEvents.createdAt })
      .from(busabaseAuditEvents)
      .where(
        and(
          eq(busabaseAuditEvents.spaceId, spaceId),
          gte(busabaseAuditEvents.createdAt, node.updatedAt),
          inArray(busabaseAuditEvents.action, [
            "node.metadata_updated",
            "node.settings_updated",
            "node.agent_prompts_updated",
          ]),
          // JSON member extraction has no native Drizzle column accessor.
          eq(sql<string>`${busabaseAuditEvents.metadata}->>'nodeId'`, node.id),
        ),
      )
      .orderBy(desc(busabaseAuditEvents.createdAt), desc(busabaseAuditEvents.id))
      .limit(1),
  ]);
  const latest = [...operations, ...audits].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  )[0];
  // Do not attribute a later unrecorded/imported edit to an earlier author.
  const updatedBy =
    latest && latest.updatedAt >= node.updatedAt
      ? latest.author
      : node.createdAt.getTime() === node.updatedAt.getTime()
        ? node.createdBy
        : null;
  const users = await resolveUserRefs([node.createdBy, updatedBy]);
  return {
    ...detail,
    attribution: {
      createdBy: node.createdBy,
      createdByUser: (node.createdBy && users.get(node.createdBy)) || null,
      updatedBy,
      updatedByUser: (updatedBy && users.get(updatedBy)) || null,
    },
  };
};

/**
 * The ancestor chain of `nodeIdOrSlug`, ROOT-FIRST and excluding the node
 * itself (`[]` for a node sitting directly under the workspace root).
 *
 * Exists because the sidebar cannot work this out on its own. Its tree is
 * fetched depth-bounded and expanded lazily, so on a cold load — a refresh, a
 * bookmark, a shared link, a "recently visited" jump — the ancestors of a
 * deep node have simply never been fetched. Walking `parentId` client-side
 * would be one round trip per level and still could not see past the first
 * unloaded ancestor. This walks the same `parentId` chain `isDescendantOf`
 * does, server-side, in one call, so the sidebar can expand straight to the
 * active node.
 *
 * Resolution and ACL go through `resolveVisibleNode`, exactly as
 * `getNodeDetail` does, so a slug in the URL works and an invisible node is a
 * 404 rather than a leaked chain of ancestor ids.
 */
export const listNodeAncestorIds = async (
  nodeIdOrSlug: string,
  typeHint?: NodeType,
): Promise<{ ancestorIds: string[] }> => {
  await ensureReady();
  const node = await resolveVisibleNode(nodeIdOrSlug, typeHint);
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const ancestorIds = await collectAncestorIds(node.id, async (id) => {
    // The starting node is already resolved — reuse it instead of paying a
    // second lookup for a row we are holding.
    if (id === node.id) return node.parentId;
    const [row] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.id, id), eq(busabaseNodes.spaceId, spaceId)))
      .limit(1);
    return row?.parentId;
  });
  return { ancestorIds };
};

export const getNodeDetail = async (
  nodeIdOrSlug: string,
  typeHint?: NodeType,
): Promise<NodeDetailVO> => {
  await ensureReady();

  // 1. Resolution + ACL. Nothing type-specific has been read yet.
  const node = await resolveVisibleNode(nodeIdOrSlug, typeHint);

  // 2. Anonymous (public-link) visitors reach a NARROWER set of node types than
  //    members do. Before the merge this was expressed by which procedures were
  //    on the anonymous allowlist — `folders.get`/`files.get`/`docs.get` were,
  //    `fileTrees.get` deliberately was not. Skill/Drive have since opted into
  //    public read-only detail, while AirApp still requires its runtime relay.
  //    One procedure cannot carry that distinction, so the resolved type is
  //    checked before hydration for the same reason the ACL is.
  if (isAnonymousVisitor() && !isAnonymousReadableNodeType(node.type)) {
    denyAnonymousNodeType(node.type);
  }

  // 3. Type-specific hydration, resolved from the node-runtime registry rather
  //    than a table this file owns — that table was one of the ten kernel files
  //    a new node type had to edit (spec: node-type-plugin-architecture.md).
  //
  //    Each domain's hydrator is invoked with the RESOLVED node, not the
  //    caller's raw input: the slug/ambiguity/ACL decision has already been made
  //    above, and the domain's own visibility check then runs a second time on a
  //    plain id lookup. Belt and braces, and it keeps each domain's getter
  //    usable on its own (busabase-cloud's embed-links logic calls several
  //    directly).
  //
  //    FAILS CLOSED, exactly as the table it replaced did: a type that has
  //    registered no detail behaviour throws rather than returning a partial or
  //    mis-discriminated VO a client would have to guess at. `genericDetail` is
  //    an explicit opt-in precisely so this stays true.
  const runtime = getNodeRuntime(node.type);
  if (runtime?.hydrateDetail) return withAttribution(await runtime.hydrateDetail(node), node);
  if (runtime?.genericDetail) return withAttribution(await buildGenericDetail(node), node);
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: `No detail is available for node type "${node.type}"`,
  });
};
