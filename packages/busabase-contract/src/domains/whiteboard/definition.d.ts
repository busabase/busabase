/**
 * Excalidraw-backed whiteboard. Content lives in object storage
 * (`busabase/nodes/{id}/whiteboard/scene.json`), written through the unified
 * `PUT /nodes/{nodeId}/content` — see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export declare const whiteboardNodeType: {
  readonly type: "whiteboard";
  readonly label: "Whiteboard";
  readonly icon: "pen-tool";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [
    {
      readonly kind: "whiteboard_document_update";
      readonly label: "Update whiteboard";
      readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
    },
  ];
};
