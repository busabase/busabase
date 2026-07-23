import { useEffect } from "react";
import type { LoadedNode, NodeDetailProps } from "../node-detail-registry";

/** Reports only nodes whose detail request succeeded; missing routes stay out of Recent. */
export const useReportLoadedNode = (
  node: LoadedNode | null | undefined,
  onNodeLoaded: NodeDetailProps["onNodeLoaded"],
): void => {
  useEffect(() => {
    if (node) onNodeLoaded?.(node);
  }, [node, onNodeLoaded]);
};
