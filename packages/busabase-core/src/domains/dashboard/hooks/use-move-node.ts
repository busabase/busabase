import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { NodeVO } from "busabase-contract/types";
import { toast } from "sonner";

export interface MoveNodePayload {
  nodeId: string;
  /** Omit to keep the current parent and only reorder. */
  parentNodeId?: string;
  /** New position among the target parent's children. */
  position?: number;
}

// Remove `nodeId` from wherever it lives in the tree, returning both the
// pruned tree and the detached node (or null if not found).
function removeNode(nodes: NodeVO[], nodeId: string): { tree: NodeVO[]; removed: NodeVO | null } {
  let removed: NodeVO | null = null;
  const tree = nodes.flatMap((node) => {
    if (node.id === nodeId) {
      removed = node;
      return [];
    }
    if (node.children.length > 0) {
      const child = removeNode(node.children, nodeId);
      if (child.removed) removed = child.removed;
      return [{ ...node, children: child.tree }];
    }
    return [node];
  });
  return { tree, removed };
}

// Insert `node` as a child of `parentId` (or at the root when `parentId` is
// null) at `position` (clamped, appended when omitted/out of range).
function insertNode(
  nodes: NodeVO[],
  parentId: string | null,
  node: NodeVO,
  position: number | undefined,
): NodeVO[] {
  if (parentId === null) {
    const next = [...nodes];
    const index =
      position === undefined ? next.length : Math.max(0, Math.min(position, next.length));
    next.splice(index, 0, { ...node, parentId: null, position: index });
    return next;
  }
  return nodes.map((candidate) => {
    if (candidate.id === parentId) {
      const children = [...candidate.children];
      const index =
        position === undefined ? children.length : Math.max(0, Math.min(position, children.length));
      children.splice(index, 0, { ...node, parentId, position: index });
      return { ...candidate, children };
    }
    if (candidate.children.length > 0) {
      return { ...candidate, children: insertNode(candidate.children, parentId, node, position) };
    }
    return candidate;
  });
}

/**
 * Pure re-parent/reorder over the in-memory node tree, for the optimistic
 * cache write. Mirrors what the server's `mergeNodeMove` will persist.
 */
export function applyOptimisticMove(nodes: NodeVO[], payload: MoveNodePayload): NodeVO[] {
  const { tree, removed } = removeNode(nodes, payload.nodeId);
  if (!removed) return nodes;
  const parentId = payload.parentNodeId ?? removed.parentId;
  return insertNode(tree, parentId, removed, payload.position);
}

/**
 * Move/reorder a node in the sidebar tree — calls the auto-merging
 * `nodes.move` endpoint directly (no ChangeRequest review round-trip, unlike
 * every other node mutation in this domain) and applies the result to the
 * `nodes.list` cache optimistically so the sidebar reorders immediately on
 * drop, rolling back on failure.
 */
export function useMoveNode({
  apiClient,
  queryClient,
  nodesQueryKey,
  onMoveError,
}: {
  apiClient: Pick<BusabaseDashboardApiClient, "moveNode">;
  queryClient: QueryClient;
  nodesQueryKey: QueryKey;
  /** i18n error toast message; defaults to a plain English fallback. */
  onMoveError?: string;
}) {
  return useMutation({
    mutationFn: (payload: MoveNodePayload) => apiClient.moveNode(payload),
    onMutate: async (payload: MoveNodePayload) => {
      await queryClient.cancelQueries({ queryKey: nodesQueryKey });
      const previous = queryClient.getQueryData<NodeVO[]>(nodesQueryKey);
      if (previous) {
        queryClient.setQueryData<NodeVO[]>(nodesQueryKey, applyOptimisticMove(previous, payload));
      }
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(nodesQueryKey, context.previous);
      }
      toast.error(onMoveError ?? "Couldn't move the item. Please try again.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: nodesQueryKey });
    },
  });
}
