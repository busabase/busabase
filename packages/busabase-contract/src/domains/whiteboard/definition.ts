import type { NodeTypeDefinition } from "../types";

/**
 * Excalidraw-backed whiteboard. Content lives in object storage
 * (`busabase/nodes/{id}/whiteboard/scene.json`), written through the unified
 * `PUT /nodes/{nodeId}/content` — see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export const whiteboardNodeType = {
  type: "whiteboard",
  label: "Whiteboard",
  icon: "pen-tool",
  capabilities: { hasDetail: true, creatable: true, publicAccess: "detail" },
  operations: [
    {
      kind: "whiteboard_document_update",
      label: "Update whiteboard",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
