import { nodeWebUrl } from "busabase-contract/node-web-url";

/** Keep the address in the browser's current workspace URL surface. */
export function dashboardNodeShareUrl({
  currentHref,
  spaceId,
  nodeType,
  nodeSlug,
  extraSegments,
}: {
  currentHref: string;
  spaceId?: string;
  nodeType: string;
  nodeSlug: string;
  extraSegments?: readonly string[];
}): string | null {
  const current = new URL(currentHref);
  const route = current.pathname.match(/^\/dashboard\/([^/]+)(?:\/|$)/);
  if (!route && current.pathname.startsWith("/dashboard")) return null;
  const resolvedSpaceId = spaceId ?? (route ? decodeURIComponent(route[1]) : undefined);
  if (route && !resolvedSpaceId) return null;
  const canonical = nodeWebUrl({
    webOrigin: current.origin,
    spaceId: route ? (resolvedSpaceId ?? null) : null,
    nodeType,
    nodeSlug,
    extraSegments,
  });
  return route
    ? canonical
    : canonical.replace(`${current.origin}/dashboard/`, `${current.origin}/`);
}
