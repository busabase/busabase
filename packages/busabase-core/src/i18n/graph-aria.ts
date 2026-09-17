import type { AriaLabelConfig } from "@xyflow/react";
import { fmt } from "./fmt";
import type { CoreI18nMessages } from "./messages";

export const getGraphAriaLabels = (messages: CoreI18nMessages): Partial<AriaLabelConfig> => ({
  "node.a11yDescription.default": messages.graph.nodeInstructions,
  "node.a11yDescription.keyboardDisabled": messages.graph.nodeMovementInstructions,
  "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) => {
    const localizedDirection =
      direction === "up" || direction === "down" || direction === "left" || direction === "right"
        ? messages.graph.directions[direction]
        : direction;
    return fmt(messages.graph.nodeMoved, { direction: localizedDirection, x, y });
  },
  "edge.a11yDescription.default": messages.graph.edgeInstructions,
  "controls.ariaLabel": messages.richNodes.controlPanel,
  "controls.zoomIn.ariaLabel": messages.richNodes.zoomIn,
  "controls.zoomOut.ariaLabel": messages.richNodes.zoomOut,
  "controls.fitView.ariaLabel": messages.richNodes.fitView,
  "controls.interactive.ariaLabel": messages.graph.toggleInteractivity,
  "minimap.ariaLabel": messages.graph.miniMap,
  "handle.ariaLabel": messages.graph.handle,
});
