import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useCallback, useMemo } from "react";
import { NODE_TREE_PREFETCH_DEPTH } from "../utils/node-tree-depth";
import { useLazyNodeChildren } from "./use-lazy-node-children";
import type { MoveNodePayload } from "./use-move-node";
import { useMoveNode } from "./use-move-node";

// Re-exported so existing importers of this hook can keep reading the depth
// from here too; the canonical definition lives in `../utils/node-tree-depth`
// (see that file for why — a server-only SSR loader needs the value without
// pulling in this file's React/react-query imports).
export { NODE_TREE_PREFETCH_DEPTH };

/**
 * The sidebar node tree, fetched depth-bounded with per-folder lazy expansion,
 * plus the drag-and-drop/"Move to…" mutation and cycle-rejection check that
 * operate on it — the one thing every Busabase-dashboard host (the
 * open-source app, Cloud) needs identically, wired here once instead of at
 * each call site.
 *
 * This existed as ~25 lines of byte-identical wiring duplicated between the
 * local and hosted implementations before this hook: same depth-bounded input,
 * same query-key derivation, same `useLazyNodeChildren` call, same
 * `checkIsDescendant` closure, same `useMoveNode` call. The two hosts differ
 * only in what's genuinely host-specific — how
 * `orpc`/`apiClient`/`queryClient` are constructed, an optional SSR seed, and
 * an i18n error string — which is exactly what stayed as parameters instead of
 * being pulled in here.
 */
export function useNodeTree({
  orpc,
  apiClient,
  queryClient,
  onMoveError,
  initialData,
}: {
  orpc: Pick<BusabaseQueryUtils, "nodes">;
  apiClient: Pick<BusabaseDashboardApiClient, "moveNode">;
  queryClient: QueryClient;
  /** i18n error toast text for a failed move; omit for `useMoveNode`'s plain-English default. */
  onMoveError?: string;
  /**
   * Seeds the root query without a network round-trip — an SSR-rendered
   * host's own initial props. MUST be fetched at exactly `{ parentId: null,
   * depth: NODE_TREE_PREFETCH_DEPTH }` (i.e. the same shape this hook's own
   * query uses): a seed fetched at a different depth than the query it seeds
   * renders one tree on the server, then visibly reshapes on the first
   * client refetch. Omit for a host with no SSR seed (e.g. the local app).
   */
  initialData?: NodeVO[];
}) {
  // Depth-bounded eager prefetch: root + `NODE_TREE_PREFETCH_DEPTH` levels.
  // Anything deeper loads lazily per-folder via `useLazyNodeChildren` below,
  // on first expand.
  const nodesListInput = useMemo(
    () => ({ parentId: null as string | null, depth: NODE_TREE_PREFETCH_DEPTH }),
    [],
  );
  const nodesListQueryOptions = orpc.nodes.list.queryOptions({ input: nodesListInput });
  const nodesQuery = useQuery({
    ...nodesListQueryOptions,
    ...(initialData ? { initialData } : {}),
  });
  // EXACT key of the query above — required for `useMoveNode`'s optimistic
  // get/setQueryData (which need an exact cache-entry match, not a partial
  // one).
  const nodesQueryKey = nodesListQueryOptions.queryKey;
  // Deliberately the BROADER `{}` (no input) key instead: a move must
  // invalidate the root tree AND every lazily-fetched folder — each of which
  // is its own `nodes.list` query — in one call. A partial key with no
  // `input` matches every `nodes.list` variant regardless of its own input.
  const nodesInvalidateQueryKey = orpc.nodes.list.queryOptions({}).queryKey;
  const moveNodeMutation = useMoveNode({
    apiClient,
    queryClient,
    nodesQueryKey,
    invalidateQueryKey: nodesInvalidateQueryKey,
    onMoveError,
  });
  const baseNodes = nodesQuery.data ?? initialData ?? [];
  const { nodes, loadingNodeIds, onExpandNode } = useLazyNodeChildren({ orpc, baseNodes });
  // Server-authoritative "is `nodeId` a descendant of `potentialAncestorId`"
  // check, consulted before COMMITTING a cross-branch drag-and-drop drop — the
  // full tree may not be loaded client-side (a folder that hasn't been
  // expanded yet), so a local ancestor-chain walk can't rule out every cycle
  // on its own.
  const checkIsDescendant = useCallback(
    async (params: { nodeId: string; potentialAncestorId: string }) => {
      const result = await orpc.nodes.isDescendant.call(params);
      return result.isDescendant;
    },
    [orpc],
  );
  const onMoveNode = useCallback(
    (payload: MoveNodePayload, options?: { onSuccess?: () => void; onError?: () => void }) =>
      moveNodeMutation.mutate(payload, options),
    [moveNodeMutation],
  );

  return {
    nodes,
    loadingNodeIds,
    onExpandNode,
    checkIsDescendant,
    onMoveNode,
    /** The raw root query, for a host that folds its `error`/`isPending` into a broader loading/error state. */
    nodesQuery,
  };
}
