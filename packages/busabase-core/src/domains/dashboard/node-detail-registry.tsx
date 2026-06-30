import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";

/**
 * Per-platform (web) node-detail renderer registry. Each domain registers its
 * detail view via `registerNodeDetail(type, Component)`; the dashboard render
 * switch looks the component up by node type instead of hardcoding a branch.
 * (RN renderers are compiled in on mobile; this is the web host.)
 */

export interface NodeDetailProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
}

export type NodeDetailRenderer = (props: NodeDetailProps) => ReactNode;

const renderers = new Map<string, NodeDetailRenderer>();

export const registerNodeDetail = (type: string, renderer: NodeDetailRenderer): void => {
  renderers.set(type, renderer);
};

export const getNodeDetail = (type: string): NodeDetailRenderer | undefined => renderers.get(type);
