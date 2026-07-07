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

export interface FileTreeReadFileVO {
  nodeId: string;
  path: string;
  encoding: "utf8" | "base64";
  content: string;
  contentBase64: string;
  mimeType: string;
  contentHash: string;
}
