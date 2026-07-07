import type { NodeVO } from "../../types";

export interface FileTreeFileVO {
  path: string;
  name: string;
  type: "file" | "folder";
  size: number;
  updatedAt: string | null;
}

export interface FileTreeNodeVO {
  node: NodeVO;
  storagePrefix: string;
  entryFile: string;
  visibility: "private" | "workspace" | "public";
  version: string;
  files: FileTreeFileVO[];
}
