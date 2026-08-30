import type { NodeTypeDefinition } from "../types";

/**
 * Standardized process graph whose steps may describe webhook-backed
 * functions. Content lives in object storage
 * (`busabase/nodes/{id}/workflow/graph.json`), written through the unified
 * `PUT /nodes/{nodeId}/content` — see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export const workflowNodeType = {
  type: "workflow",
  label: "Workflow",
  icon: "workflow",
  capabilities: { hasDetail: true, creatable: true, publicAccess: "detail" },
  operations: [
    {
      kind: "workflow_document_update",
      label: "Update workflow",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
