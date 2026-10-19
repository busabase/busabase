import type { NodeType } from "busabase-contract/domains";

export interface NavigableNode {
  id: string;
  type: NodeType;
  slug: string;
}

export type MobileNodeDestination =
  | { status: "ready"; pathname: string; params: Record<string, string> }
  | { status: "unsupported"; message: string };

const NODE_DETAIL_PATHS: Readonly<Partial<Record<NodeType, string>>> = {
  airapp: "/airapp/[nodeId]",
  doc: "/doc/[nodeId]",
  drive: "/drive/[nodeId]",
  file: "/file/[nodeId]",
  folder: "/folder/[nodeId]",
  form: "/form/[nodeId]",
  html: "/html/[nodeId]",
  skill: "/skill/[nodeId]",
  whiteboard: "/whiteboard/[nodeId]",
  workflow: "/workflow/[nodeId]",
};

export const getMobileNodeDestination = (node: NavigableNode): MobileNodeDestination => {
  if (node.type === "base") {
    return { status: "ready", pathname: "/base/[slug]", params: { slug: node.slug } };
  }
  const pathname = NODE_DETAIL_PATHS[node.type];
  if (!pathname) {
    return {
      status: "unsupported",
      message: `${node.type} nodes aren't viewable on mobile yet.`,
    };
  }
  return {
    status: "ready",
    pathname,
    params: { nodeId: node.id },
  };
};

export const isMobileNodePathActive = (node: NavigableNode, pathname: string): boolean => {
  const destination = getMobileNodeDestination(node);
  if (destination.status === "unsupported") return false;
  const path =
    destination.pathname === "/base/[slug]"
      ? `/base/${destination.params.slug}`
      : destination.pathname.replace("[nodeId]", destination.params.nodeId ?? "");
  return pathname === path || pathname.startsWith(`${path}/`);
};

/**
 * The node a detail route shows, read back from its pathname: `/base/<slug>`
 * or `/<type>/<nodeId>`. Null on every other screen. Feeds `nodes.ancestors`,
 * which takes either an id or a slug, so the drawer can open the folders above
 * a node it has not loaded yet.
 */
export const parseMobileNodeRoute = (pathname: string): { type: NodeType; ref: string } | null => {
  const [, first, second] = pathname.split("/");
  if (!first || !second) return null;
  if (first === "base") return { type: "base", ref: decodeURIComponent(second) };
  const type = (Object.keys(NODE_DETAIL_PATHS) as NodeType[]).find(
    (candidate) => NODE_DETAIL_PATHS[candidate] === `/${first}/[nodeId]`,
  );
  return type ? { type, ref: decodeURIComponent(second) } : null;
};
