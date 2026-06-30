import type { NodeTypeDefinition } from "../types";

/**
 * Storage-backed Doc (no extra DB tables). A deliberately minimal node type added
 * purely by registration — the proof that a new full-stack type is one
 * `domains/<type>/` folder + registration, with no kernel-logic or migration edits.
 */
export const docNodeType = {
  type: "doc",
  label: "Doc",
  icon: "file-text",
  capabilities: { hasDetail: true, creatable: true },
  operations: [
    {
      kind: "doc_update",
      label: "Update doc",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
