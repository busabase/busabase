"use client";

import { useQueries } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useCallback, useMemo, useState } from "react";

// Matches the server's own default (`DEFAULT_NODE_LIST_DEPTH` in
// packages/busabase-core/src/logic/nodes.ts) — a lazy-expanded folder eagerly
// carries 2 levels beneath it too, same as the root prefetch, so expanding a
// folder two levels deep in a row is still just one fetch per click rather
// than one per level.
const LAZY_CHILDREN_DEPTH = 2;

/**
 * Recursively merge lazily-fetched children into every node in `tree` whose
 * id has an entry in `childrenByParentId` — applied at every depth (not just
 * the top), so a folder expanded while nested inside another already-expanded
 * folder merges correctly too. Nodes untouched by any fetch keep their exact
 * previous object reference (referential-equality preserved) so unrelated
 * subtrees don't force downstream re-renders/rebuilds (e.g. dashboard-shell's
 * `nodeIndex`).
 */
function mergeLazyChildren(tree: NodeVO[], childrenByParentId: Map<string, NodeVO[]>): NodeVO[] {
  if (childrenByParentId.size === 0) return tree;
  let changed = false;
  const merged = tree.map((node) => {
    const fetchedChildren = childrenByParentId.get(node.id);
    const baseChildren = fetchedChildren ?? node.children;
    const mergedChildren =
      baseChildren.length > 0 ? mergeLazyChildren(baseChildren, childrenByParentId) : baseChildren;
    if (!fetchedChildren && mergedChildren === node.children) return node;
    changed = true;
    return { ...node, children: mergedChildren };
  });
  return changed ? merged : tree;
}

/**
 * Backs the sidebar's lazy per-folder expand beyond the host's depth-bounded
 * eager prefetch (`nodes.list({ depth: 2 })`): `onExpandNode` marks a folder
 * as "expanded", which mounts a dedicated `nodes.list({ parentId, depth: 2
 * })` query for it via `useQueries` (so any number of folders can be
 * expanded independently, each caching under its own input-keyed query).
 *
 * Every such query lives in the SAME shared `queryClient`/`orpc.nodes.list`
 * query family as the host's root query, so it is invalidated for free by
 * `useMoveNode`'s `onSettled: () => invalidateQueries({ queryKey:
 * nodesQueryKey })` (built from `orpc.nodes.list.queryOptions({}).queryKey`,
 * a prefix that matches every `nodes.list` query regardless of input) — no
 * separate invalidation wiring is needed here.
 *
 * `staleTime: Infinity` on each expanded query is what satisfies "re-expand
 * must NOT refetch unless invalidated by a mutation": once fetched, a
 * folder's children are cached until something ELSE invalidates the
 * `nodes.list` family (a move/create/delete), not merely on re-collapse.
 */
export function useLazyNodeChildren({
  orpc,
  baseNodes,
}: {
  orpc: Pick<BusabaseQueryUtils, "nodes">;
  baseNodes: NodeVO[];
}) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  const onExpandNode = useCallback((nodeId: string) => {
    setExpandedIds((prev) => (prev.has(nodeId) ? prev : new Set(prev).add(nodeId)));
  }, []);

  const expandedIdList = useMemo(() => Array.from(expandedIds), [expandedIds]);

  const results = useQueries({
    queries: expandedIdList.map((parentId) => ({
      ...orpc.nodes.list.queryOptions({
        input: { parentId, depth: LAZY_CHILDREN_DEPTH },
      }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  const { childrenByParentId, loadingNodeIds } = useMemo(() => {
    const children = new Map<string, NodeVO[]>();
    const loading = new Set<string>();
    expandedIdList.forEach((parentId, index) => {
      const result = results[index];
      if (result?.data) {
        children.set(parentId, result.data as NodeVO[]);
      } else if (result?.isFetching) {
        loading.add(parentId);
      }
    });
    return { childrenByParentId: children, loadingNodeIds: loading };
  }, [expandedIdList, results]);

  const nodes = useMemo(
    () => mergeLazyChildren(baseNodes, childrenByParentId),
    [baseNodes, childrenByParentId],
  );

  return { nodes, loadingNodeIds, onExpandNode };
}
