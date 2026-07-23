import type { NodeTypeDefinition } from "../types";

/** Free-form whiteboard backed by an Excalidraw scene in node metadata. */
export const whiteboardNodeType = {
  type: "whiteboard",
  label: "Whiteboard",
  icon: "pen-tool",
  capabilities: { hasDetail: true, creatable: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
