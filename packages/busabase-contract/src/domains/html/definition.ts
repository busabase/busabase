import type { NodeTypeDefinition } from "../types";

/** Lightweight HTML source + isolated preview artifact. */
export const htmlNodeType = {
  type: "html",
  label: "HTML",
  icon: "code-xml",
  capabilities: { hasDetail: true, creatable: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
