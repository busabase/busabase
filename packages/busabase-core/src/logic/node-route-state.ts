import "server-only";

import type { NodeRouteStateVO } from "busabase-contract/contract/node-route-state-schemas";
import { isPubliclyReadableNodeType, type NodeType } from "busabase-contract/domains";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getContextSpaceId, isAnonymousVisitor } from "../context";
import { getDb } from "../db";
import { busabaseBases, busabaseNodes, type NodePO } from "../db/schema";
import { buildNodeVisibilityCondition, hasNodePermission } from "./node-acl";
import { ensureReady } from "./seed";

const unavailable = (): NodeRouteStateVO => ({ status: "unavailable" });

const toActiveState = (node: NodePO): NodeRouteStateVO =>
  isAnonymousVisitor() && !isPubliclyReadableNodeType(node.type)
    ? unavailable()
    : { status: "active", nodeId: node.id };

const toArchivedState = async (
  node: NodePO,
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<NodeRouteStateVO> => ({
  status: "archived",
  nodeId: node.id,
  type: node.type,
  name: node.name,
  slug: node.slug,
  archivedAt: node.archivedAt?.toISOString() ?? node.updatedAt.toISOString(),
  canRestore: await hasNodePermission(node.id, "manage", undefined, db),
});

/**
 * Resolves the node behind a dashboard URL without hydrating its content.
 * Resolution mirrors nodes.get: an active id wins, then an active typed slug.
 * Only when neither exists do we consider an archived tombstone.
 */
const resolveByNodeRef = async (
  nodeIdOrSlug: string,
  typeHint: NodeType | undefined,
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<NodeRouteStateVO> => {
  const spaceId = getContextSpaceId();
  const visible = buildNodeVisibilityCondition(db);
  const common = [
    eq(busabaseNodes.spaceId, spaceId),
    isNull(busabaseNodes.deletedAt),
    ...(visible ? [visible] : []),
  ];

  const [activeById] = await db
    .select()
    .from(busabaseNodes)
    .where(and(...common, eq(busabaseNodes.id, nodeIdOrSlug), isNull(busabaseNodes.archivedAt)))
    .limit(1);
  if (activeById) {
    return typeHint && activeById.type !== typeHint ? unavailable() : toActiveState(activeById);
  }

  const activeBySlug = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        ...common,
        eq(busabaseNodes.slug, nodeIdOrSlug),
        isNull(busabaseNodes.archivedAt),
        ...(typeHint ? [eq(busabaseNodes.type, typeHint)] : []),
      ),
    )
    .limit(2);
  if (activeBySlug.length === 1) return toActiveState(activeBySlug[0] as NodePO);
  if (activeBySlug.length > 1) return unavailable();

  // Public visitors may resolve an active, publicly shared route above, but
  // must not learn that a formerly shared resource still exists in Trash.
  if (isAnonymousVisitor()) return unavailable();

  const [archivedById] = await db
    .select()
    .from(busabaseNodes)
    .where(and(...common, eq(busabaseNodes.id, nodeIdOrSlug), isNotNull(busabaseNodes.archivedAt)))
    .limit(1);
  if (archivedById) {
    return typeHint && archivedById.type !== typeHint
      ? unavailable()
      : toArchivedState(archivedById, db);
  }

  const archivedBySlug = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        ...common,
        eq(busabaseNodes.slug, nodeIdOrSlug),
        isNotNull(busabaseNodes.archivedAt),
        ...(typeHint ? [eq(busabaseNodes.type, typeHint)] : []),
      ),
    )
    .limit(2);

  // Archived slugs are intentionally reusable. More than one tombstone is
  // therefore ambiguous and must not be guessed at.
  return archivedBySlug.length === 1
    ? toArchivedState(archivedBySlug[0] as NodePO, db)
    : unavailable();
};

/**
 * `/base/:ref` accepts three refs, not two: the Base's slug, its owning NODE id,
 * and the `busabase_bases` row id (see `getBase` — "Both the Base id and its
 * owning Node id are accepted so `/base/:ref` follows the same ID-or-slug rule
 * as other node routes"). Only the first two live on `busabase_nodes`, so a
 * bookmarked `/base/bse…` URL resolves to nothing here without this hop.
 *
 * Deliberately a FALLBACK, run only after the node-side lookups miss: node ids
 * and slugs keep their existing precedence, so this can never change which node
 * an already-resolving URL points at. The mapped node id then goes back through
 * `resolveByNodeRef`, which is what keeps the ACL, the archived-tombstone rules,
 * and the anonymous cutoff identical for both spellings of the same Base.
 */
const resolveOwningNodeIdOfBaseRow = async (
  baseRowId: string,
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<string | null> => {
  const [row] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(and(eq(busabaseBases.id, baseRowId), eq(busabaseBases.spaceId, getContextSpaceId())))
    .limit(1);
  return row?.nodeId ?? null;
};

export const resolveNodeRouteState = async (
  nodeIdOrSlug: string,
  typeHint?: NodeType,
): Promise<NodeRouteStateVO> => {
  await ensureReady();

  const db = await getDb();
  const direct = await resolveByNodeRef(nodeIdOrSlug, typeHint, db);
  if (direct.status !== "unavailable") return direct;

  // A Base can also be addressed by its `busabase_bases` row id. Nothing else
  // reaches this fallback, so a non-Base ref pays only the one indexed miss.
  if (typeHint && typeHint !== "base") return direct;
  const owningNodeId = await resolveOwningNodeIdOfBaseRow(nodeIdOrSlug, db);
  return owningNodeId ? resolveByNodeRef(owningNodeId, typeHint, db) : direct;
};
