import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodeType } from "busabase-contract/domains";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getContextSpaceId, isAnonymousVisitor } from "../context";
import { getDb } from "../db";
import { busabaseNodes, type NodePO } from "../db/schema";
import { denyAnonymousNodeType, isAnonymousReadableNodeType } from "./anonymous-allowlist";
// Side-effect import: guarantees every builtin node type has registered its
// server-side behaviour before the dispatch below reads the registry. Importing
// the one barrel (rather than hand-listing domains here) is deliberate — see
// that module for the silent-fallback bug hand-listing caused.
import "./builtin-node-runtimes";
import { buildNodeVisibilityCondition } from "./node-acl";
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

const nodeNotFound = (nodeIdOrSlug: string) =>
  new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeIdOrSlug}` });

/**
 * Resolve `nodeIdOrSlug` to a single visible, ACTIVE node row.
 *
 * Active-only is not an oversight: all four retired gets filtered on
 * `archivedAt IS NULL`, so an archived node was a 404 through every one of
 * them. Trash is listed through `nodes.list({ status: "archived" })`, which is
 * where an archived node is meant to be found.
 */
const resolveVisibleNode = async (nodeIdOrSlug: string, typeHint?: NodeType): Promise<NodePO> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: a hidden node resolves to nothing — indistinguishable from absent.
  const visible = buildNodeVisibilityCondition(db);

  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  if (byId) {
    // A node id is unambiguous — one row, one type. A `type` that contradicts it
    // is a caller mistake, not something to silently ignore.
    if (typeHint && byId.type !== typeHint) {
      throw nodeNotFound(nodeIdOrSlug);
    }
    return byId;
  }

  // Not an id — treat it as a slug. A slug is only unique WITHIN a type, so a
  // slug that exists under several types is refused rather than resolved to
  // whichever row happens to sort first: picking one would silently hand the
  // caller (or an agent proposing an edit) the wrong resource.
  const bySlug = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.slug, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
        ...(typeHint ? [eq(busabaseNodes.type, typeHint)] : []),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));

  const first = bySlug[0];
  if (!first) {
    throw nodeNotFound(nodeIdOrSlug);
  }
  const types = [...new Set(bySlug.map((row) => row.type))];
  if (types.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Slug "${nodeIdOrSlug}" exists as ${types.join(" and ")}; pass \`type\` to choose one.`,
    });
  }
  return first;
};

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
  //    `fileTrees.get` deliberately was not. One procedure cannot carry that
  //    distinction, so it moves here, onto the resolved type, and it is checked
  //    before hydration for the same reason the ACL is.
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
  if (runtime?.hydrateDetail) return runtime.hydrateDetail(node);
  if (runtime?.genericDetail) return buildGenericDetail(node);
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: `No detail is available for node type "${node.type}"`,
  });
};
