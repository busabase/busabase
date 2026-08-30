import type { NodeTypeDefinition } from "../types";

/**
 * Lightweight HTML source + isolated preview artifact. Content lives in
 * object storage (`busabase/nodes/{id}/html/index.html`, raw source — not
 * JSON-wrapped), written through the unified `PUT /nodes/{nodeId}/content` —
 * see `node-content-schemas.ts` and
 * `apps/busabase/content/spec/node-content-storage.md` (D2/D3).
 */
export const htmlNodeType = {
  type: "html",
  label: "HTML",
  icon: "code-xml",
  capabilities: { hasDetail: true, creatable: true, publicAccess: "no" },
  operations: [
    {
      kind: "html_document_update",
      label: "Update HTML",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
