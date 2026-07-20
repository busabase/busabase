import type { NodeType } from "busabase-contract/domains";

export interface NavigableNode {
  id: string;
  type: NodeType;
  slug: string;
}

export type MobileNodeDestination =
  | { status: "ready"; pathname: string; params: Record<string, string> }
  | { status: "unsupported"; message: string };

export const getMobileNodeDestination = (node: NavigableNode): MobileNodeDestination => {
  if (node.type === "file") {
    return {
      status: "unsupported",
      message: "Standalone files aren't viewable on mobile yet.",
    };
  }
  if (node.type === "base") {
    return { status: "ready", pathname: "/base/[slug]", params: { slug: node.slug } };
  }
  return {
    status: "ready",
    pathname: `/${node.type}/[nodeId]`,
    params: { nodeId: node.id },
  };
};
