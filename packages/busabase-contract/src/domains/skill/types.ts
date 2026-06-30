// View objects owned by the skill domain (storage-backed file tree).
import type { NodeVO } from "../../types";

export interface SkillFileVO {
  path: string;
  name: string;
  type: "file" | "folder";
  size: number;
  updatedAt: string | null;
}

export interface SkillVO {
  node: NodeVO;
  storagePrefix: string;
  entryFile: string;
  visibility: "private" | "workspace" | "public";
  version: string;
  files: SkillFileVO[];
}
