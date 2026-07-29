import type { NodeDetailVO } from "busabase-contract/types";

/**
 * Narrow a `nodes.get` response to the one node type a screen was routed for.
 *
 * `GET /nodes/{nodeId}` replaced the four typed gets (`docs.get`, `files.get`,
 * `folders.get`, `fileTrees.get`) with a single discriminated union, so a detail
 * screen that asked for a Doc has to say so before it can read `.body`.
 *
 * Every `[nodeId]` route accepts an id OR a slug, and a slug is only unique
 * within its type — so `/doc/my-notes` can resolve to a Drive that happens to
 * share the slug. Returning `null` on a type mismatch (rather than throwing)
 * makes that render the screen's ordinary "not found" empty state instead of a
 * half-empty screen reading `.body` off a Folder.
 *
 * Mirrors `asNodeDetail` in busabase-core's dashboard helpers; duplicated here
 * because that helper is not part of busabase-core's public export surface and
 * this file must stay importable from React Native (pure types only — no db,
 * drizzle, or server module reaches this graph).
 */
export const asNodeDetail = <T extends NodeDetailVO["type"]>(
  detail: NodeDetailVO | undefined | null,
  type: T,
): Extract<NodeDetailVO, { type: T }> | null =>
  detail && detail.type === type ? (detail as Extract<NodeDetailVO, { type: T }>) : null;
