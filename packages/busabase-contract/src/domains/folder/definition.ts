import type { NodeTypeDefinition } from "../types";

/** Container type: holds children AND has a detail screen (its contents listing).
 *  Owns no DB table — a folder is just a node row. */
export const folderNodeType = {
  type: "folder",
  label: "Folder",
  icon: "folder",
  capabilities: {
    container: true,
    creatable: true,
    commonlyCreated: true,
    hasDetail: true,
    publicAccess: "detail",
  },
  operations: [
    {
      kind: "folder_update",
      label: "Update folder",
      tone: "border-blue-200 bg-blue-50 text-blue-800",
    },
  ],
} as const satisfies NodeTypeDefinition;
