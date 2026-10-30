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

/**
 * `location` with this node's slug swapped for `nextSlug`, or null when the
 * location does not address this node by that slug.
 *
 * Every route that addresses a node carries its slug as the second segment —
 * `/{type}/{slug}`, its `/activity`, and a Base's deeper `/base/{slug}/…`
 * family — so swapping that one segment keeps whoever is looking at the node
 * on it after a slug change, instead of stranding them on a URL that now
 * resolves to nothing. A location that addresses the node by id is left
 * alone: the id did not change. The query string is carried over untouched.
 */
export const replaceNodeRouteSlug = (
  location: string,
  type: string,
  slug: string,
  nextSlug: string,
): string | null => {
  const queryStart = location.indexOf("?");
  const pathname = queryStart === -1 ? location : location.slice(0, queryStart);
  const query = queryStart === -1 ? "" : location.slice(queryStart);
  const segments = pathname.split("/");
  const [leading, routeType, encodedSlug] = segments;
  if (leading !== "" || routeType !== type || !encodedSlug) return null;
  let routeSlug = encodedSlug;
  try {
    routeSlug = decodeURIComponent(encodedSlug);
  } catch {
    // Malformed escape — compare it as written, same as `parseNodeRoute`.
  }
  if (routeSlug !== slug) return null;
  segments[2] = encodeURIComponent(nextSlug);
  return `${segments.join("/")}${query}`;
};

/**
 * The node the sidebar should locate for `location`: a node detail route, or
 * ANY Base route. Unlike `parseNodeDetailRoute`, Bases are included — the
 * sidebar only needs the Base's slug (always the second segment), not to
 * tell its deeper routes (`/base/{slug}/{viewId}`, `/{recordId}/edit`, ...)
 * apart, and without it a Base nested past the prefetch depth never had its
 * ancestor folders opened.
 */
export const parseSidebarNodeRoute = (location: string): NodeRouteRef | null => {
  const pathname = location.split("?", 1)[0] ?? "";
  const baseMatch = pathname.match(/^\/base\/([^/]+)(?:\/.*)?$/);
  if (baseMatch) {
    const [, encodedSlug] = baseMatch;
    try {
      return { type: "base", slug: decodeURIComponent(encodedSlug) };
    } catch {
      return { type: "base", slug: encodedSlug };
    }
  }
  return parseNodeRoute(location, false) ?? parseNodeRoute(location, true);
};
