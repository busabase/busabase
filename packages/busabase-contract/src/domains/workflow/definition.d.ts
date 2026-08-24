/**
 * Standardized process graph whose steps may describe webhook-backed
 * functions. Content lives in object storage
 * (`busabase/nodes/{id}/workflow/graph.json`), written through the unified
 * `PUT /nodes/{nodeId}/content` — see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export declare const workflowNodeType: {
  readonly type: "workflow";
  readonly label: "Workflow";
  readonly icon: "workflow";
  readonly capabilities: {
    readonly hasDetail: true;
    readonly creatable: true;
  };
  readonly operations: readonly [
    {
      readonly kind: "workflow_document_update";
      readonly label: "Update workflow";
      readonly tone: "border-blue-200 bg-blue-50 text-blue-800";
    },
  ];
};
