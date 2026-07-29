import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";

/**
 * Narrow a `nodes.get` response to one node type's branch.
 *
 * `nodes.get` returns a discriminated union, so a detail view that asked for a
 * Doc has to say so before it can read `.body`. It returns `null` — rather than
 * throwing — for a different type, because that is exactly what a detail view
 * wants: a slug that resolved to some other node type renders the same
 * "not found" empty state as a slug that resolved to nothing.
 *
 * Handles `undefined` (query not settled yet) so callers can pass
 * `query.data` straight in.
 */
export const asNodeDetail = <T extends NodeDetailVO["type"]>(
  detail: NodeDetailVO | undefined | null,
  type: T,
): Extract<NodeDetailVO, { type: T }> | null =>
  detail && detail.type === type ? (detail as Extract<NodeDetailVO, { type: T }>) : null;
