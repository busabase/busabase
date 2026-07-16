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
  // Paths silently dropped from this create call by an uploaded `.gitignore`
  // (upload-safety layer 1 — see busabase-core's `logic/upload-safety.ts`).
  // Optional here (absent on plain get/list reads); the oRPC output schema
  // (`fileTreeNodeSchema`) defaults it to `[]` on the wire either way.
  skippedGitignorePaths?: string[];
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
