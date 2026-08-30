import { getNodeType, type NodeType } from "busabase-contract/domains";

/** A node addressed by the url: `/{type}/{slug}`. */
export interface NodeRouteRef {
  /** Narrowed, not merely parsed: a shape that is not a real node type is rejected below. */
  type: NodeType;
  slug: string;
}

/**
 * `/{type}/{slug}` and `/{type}/{slug}/activity` — the two url shapes that
 * address a single node, parsed in one place.
 *
 * `base` is excluded from both: a Base owns a whole family of deeper routes
 * (`/base/{slug}/{viewId}`, `/{recordId}/edit`, `/design`, ...) that this
 * two-segment shape would silently mis-read, and every caller resolves Bases
 * through their own dedicated route match instead.
 *
 * A type with no detail screen is rejected for the same reason: `/inbox/{id}`
 * and `/agents/{slug}` are the same SHAPE but are not nodes, so matching on
 * shape alone would hand callers a node ref for a route that has no node
 * behind it.
 */
const parseNodeRoute = (location: string, expectActivity: boolean): NodeRouteRef | null => {
  const pathname = location.split("?", 1)[0] ?? "";
  const match = pathname.match(
    expectActivity ? /^\/([^/]+)\/([^/]+)\/activity$/ : /^\/([^/]+)\/([^/]+)$/,
  );
  if (!match) return null;
  const [, rawType, encodedSlug] = match;
  if (rawType === "base") return null;
  const definition = getNodeType(rawType);
  if (!definition?.capabilities.hasDetail) return null;
  const type = definition.type;
  try {
    return { type, slug: decodeURIComponent(encodedSlug) };
  } catch {
    // A malformed percent-escape is still a usable slug — the server resolves
    // it (and 404s) far better than throwing away the whole route here.
    return { type, slug: encodedSlug };
  }
};

/** The node a `/{type}/{slug}` location addresses, or null if it addresses none. */
export const parseNodeDetailRoute = (location: string): NodeRouteRef | null =>
  parseNodeRoute(location, false);

/** The node a `/{type}/{slug}/activity` location addresses, or null. */
export const parseNodeActivityRoute = (location: string): NodeRouteRef | null =>
  parseNodeRoute(location, true);
