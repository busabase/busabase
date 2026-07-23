import type { NodeTypeDefinition } from "../types";

/** Standardized process graph whose steps may describe webhook-backed functions. */
export const workflowNodeType = {
  type: "workflow",
  label: "Workflow",
  icon: "workflow",
  capabilities: { hasDetail: true, creatable: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
