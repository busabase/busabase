import type { NodeTypeDefinition } from "../types";

/** Container type: holds children AND has a detail screen (its contents listing).
 *  Owns no DB table — a folder is just a node row. */
export const folderNodeType = {
  type: "folder",
  label: "Folder",
  icon: "folder",
  capabilities: { container: true, creatable: true, hasDetail: true },
  operations: [],
} as const satisfies NodeTypeDefinition;
