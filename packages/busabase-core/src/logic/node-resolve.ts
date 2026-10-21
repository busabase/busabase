import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeType } from "busabase-contract/domains";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import { busabaseNodes, type NodePO } from "../db/schema";
import { buildNodeVisibilityCondition } from "./node-acl";

/**
 * The one "a caller handed us a node id OR a slug" resolver.
 *
 * It lives apart from `node-detail.ts` (which owns `nodes.get`) so a domain
 * handler can resolve a node ref without importing the node-detail module and
 * its builtin-runtime side-effect import, which would close an import cycle
 * through every domain's handlers.
 */

export const nodeNotFound = (nodeIdOrSlug: string) =>
  new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeIdOrSlug}` });

/**
 * Resolve `nodeIdOrSlug` to a single visible, ACTIVE node row.
 *
 * Active-only is not an oversight: all four retired gets filtered on
 * `archivedAt IS NULL`, so an archived node was a 404 through every one of
 * them. Trash is listed through `nodes.list({ status: "archived" })`, which is
 * where an archived node is meant to be found.
 *
 * `typeHint` narrows what is accepted — one type, or several (`nodes.readLines`
 * accepts every content-bearing type). An id whose row has another type is a
 * 404, and a slug is only looked up among the hinted types.
 */
export const resolveVisibleNode = async (
  nodeIdOrSlug: string,
  typeHint?: NodeType | readonly NodeType[],
): Promise<NodePO> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: a hidden node resolves to nothing — indistinguishable from absent.
  const visible = buildNodeVisibilityCondition(db);
  const hintedTypes =
    typeHint === undefined ? undefined : typeof typeHint === "string" ? [typeHint] : typeHint;

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
    if (hintedTypes && !hintedTypes.includes(byId.type as NodeType)) {
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
        ...(hintedTypes ? [inArray(busabaseNodes.type, [...hintedTypes])] : []),
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
      message: `Slug "${nodeIdOrSlug}" exists as ${types.join(" and ")}; pass \`type\` to choose one, or use the node id.`,
    });
  }
  return first;
};

/**
 * `resolveVisibleNode` for an endpoint that only works on some node types, with
 * a useful error when the ref names a node of ANOTHER type.
 *
 * A plain type-hinted lookup answers "Node not found" for a node that is right
 * there — an agent reading that concludes the node does not exist. So on a
 * miss this looks the ref up once more without the hint, and when it finds a
 * visible node, `wrongType` turns it into the error to throw (typically a 400
 * naming what the node is and which endpoint reads it). The second lookup only
 * runs on the error path and goes through the same ACL, so it cannot reveal a
 * node the caller could not already open with `nodes.get`.
 */
export const resolveVisibleNodeOfTypes = async (
  nodeIdOrSlug: string,
  types: readonly NodeType[],
  wrongType: (node: NodePO) => ORPCError<string, unknown>,
): Promise<NodePO> => {
  try {
    return await resolveVisibleNode(nodeIdOrSlug, types);
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND") throw error;
    const other = await resolveVisibleNode(nodeIdOrSlug).catch(() => null);
    if (other) throw wrongType(other);
    throw error;
  }
};
