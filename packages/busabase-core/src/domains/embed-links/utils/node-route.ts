/**
 * Which workbench routes an Embed Link for an ordinary node may show.
 *
 * The embed page mounts the workbench's own Node Detail views, which navigate
 * the way they do in the workbench: a Base switches views and opens records by
 * route, a Drive selects files by query string. Those routes stay inside the
 * embed. Anything else — another node, the Base designer, a new-record form,
 * an activity log — is not part of what the link shares, so the embed does not
 * go there (the server would refuse the writes anyway; this keeps the reader
 * from landing on a page built around them).
 *
 * Pure and isomorphic: the embed page's client router and its tests use it.
 */

import type { EmbedTargetNodeVO } from "../types";

/** Base sub-routes that edit, design or audit rather than read. */
const BASE_NON_READING_SEGMENTS = new Set(["design", "setup", "new", "activity"]);

/** The route the embed opens on: the node's own workbench detail route (`/{type}/{slug}`). */
export const embedNodeInitialPath = (node: EmbedTargetNodeVO): string =>
  `/${node.type}/${encodeURIComponent(node.slug)}`;

const pathOnly = (to: string): string => {
  const end = to.search(/[?#]/);
  return end === -1 ? to : to.slice(0, end);
};

/** Whether `to` (a router path, optionally with a query) stays on the shared node. */
export const isEmbedNodeRoute = (to: string, node: EmbedTargetNodeVO): boolean => {
  let segments: string[];
  try {
    segments = pathOnly(to).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return false;
  }
  const [type, ref, ...rest] = segments;
  if (type !== node.type || (ref !== node.slug && ref !== node.id)) return false;
  if (rest.length === 0) return true;
  // A Base reads through its views (`/base/:slug/:viewId`) and record previews
  // (`/base/:slug/:recordId`) — one segment past the Base, never an editor.
  return node.type === "base" && rest.length === 1 && !BASE_NON_READING_SEGMENTS.has(rest[0] ?? "");
};
