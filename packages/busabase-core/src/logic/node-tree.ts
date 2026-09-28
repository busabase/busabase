import "server-only";

/**
 * The space's node tree in memory — id/parent/name for every non-deleted node,
 * plus the subset the caller may read — and the two walks over it that show a
 * node's location to an agent: its ancestors and its readable folder path.
 *
 * Shared by `playbooks.search`/`get` (where a playbook lives) and `grep`'s file
 * owner attribution (which skill/drive a matched file belongs to), so both
 * describe a location the same way and neither names a folder the caller
 * cannot see.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "../db";
import { busabaseNodes } from "../db/schema";
import { buildNodeVisibilityCondition } from "./node-acl";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface NodeTree {
  byId: Map<string, TreeNode>;
  /** Ids the caller may read; `null` means every node (a space manager). */
  visibleIds: Set<string> | null;
}

/**
 * Every node's id/parent/name in the space — the minimum needed to build
 * `path` and rank by tree proximity. Small columns only; `visibleIds` is the
 * subset the caller may read, so `path` never names a folder the caller cannot
 * see.
 */
export const loadNodeTree = async (db: Db, spaceId: string): Promise<NodeTree> => {
  const rows = await db
    .select({ id: busabaseNodes.id, parentId: busabaseNodes.parentId, name: busabaseNodes.name })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.spaceId, spaceId), isNull(busabaseNodes.deletedAt)));
  const byId = new Map<string, TreeNode>(rows.map((row) => [row.id, row]));
  const visibility = buildNodeVisibilityCondition(db);
  const visibleIds = visibility
    ? new Set(
        (
          await db
            .select({ id: busabaseNodes.id })
            .from(busabaseNodes)
            .where(and(eq(busabaseNodes.spaceId, spaceId), visibility))
        ).map((row) => row.id),
      )
    : null;
  return { byId, visibleIds };
};

/** Ancestor ids of `nodeId`, CLOSEST first, root included, self excluded. Cycle- and depth-safe. */
export const ancestorsOf = (byId: Map<string, TreeNode>, nodeId: string): string[] => {
  const out: string[] = [];
  const seen = new Set<string>([nodeId]);
  let cursor = byId.get(nodeId)?.parentId ?? null;
  while (cursor && !seen.has(cursor) && out.length < 64) {
    seen.add(cursor);
    out.push(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return out;
};

/**
 * Folder names from just under the workspace root down to the node's parent.
 * The root itself has no name worth showing; a folder the caller cannot read is
 * left out rather than named.
 */
export const nodePathOf = (
  byId: Map<string, TreeNode>,
  visibleIds: Set<string> | null,
  nodeId: string,
): string[] => {
  const ancestors = ancestorsOf(byId, nodeId);
  // The last entry is the workspace root (the one node with no parent).
  const withoutRoot =
    ancestors.length > 0 && !byId.get(ancestors[ancestors.length - 1] as string)?.parentId
      ? ancestors.slice(0, -1)
      : ancestors;
  return withoutRoot
    .reverse()
    .filter((id) => visibleIds === null || visibleIds.has(id))
    .map((id) => byId.get(id)?.name ?? "")
    .filter(Boolean);
};
