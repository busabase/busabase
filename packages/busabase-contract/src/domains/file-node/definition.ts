import type { NodeTypeDefinition } from "../types";

/** A first-class workspace file node. The node row points at a Busabase Asset,
 *  while the actual bytes stay in Attachment storage. */
export const fileNodeType = {
  type: "file",
  label: "File",
  icon: "file",
  capabilities: { hasDetail: true, creatable: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
