/**
 * Lightweight HTML source + isolated preview artifact. Content lives in
 * object storage (`busabase/nodes/{id}/html/index.html`, raw source — not
 * JSON-wrapped), written through the unified `PUT /nodes/{nodeId}/content` —
 * see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export declare const htmlNodeType: {
  readonly type: "html";
  readonly label: "HTML";
  readonly icon: "code-xml";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [
    {
      readonly kind: "html_document_update";
      readonly label: "Update HTML";
      readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
    },
  ];
};
