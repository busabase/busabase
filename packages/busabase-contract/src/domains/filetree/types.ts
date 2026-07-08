import type { NodeVO } from "../../types";

export interface FileTreeFileVO {
  path: string;
  name: string;
  size: number;
  updatedAt: string | null;
  mimeType: string | null;
  assetId: string;
  displayName: string | null;
}

export interface FileTreeNodeVO {
  node: NodeVO;
  entryFile: string;
  visibility: "private" | "workspace" | "public";
  version: string;
  files: FileTreeFileVO[];
}

export interface FileTreeReadFileVO {
  nodeId: string;
  path: string;
  encoding: "utf8" | "url";
  content: string;
  mimeType: string;
  assetId: string;
  displayName: string | null;
  assetUrl: string | null;
  contentHash: string;
}
