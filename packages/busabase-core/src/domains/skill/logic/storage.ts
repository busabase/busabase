import "server-only";

import {
  deleteTextFile,
  getFileTreeNode,
  listStorageFiles,
  normalizeFilePath,
  readTextFile,
  resolveStoragePrefix,
  storagePrefix,
  writeTextFile,
} from "../../filetree/logic/storage";

export const normalizeSkillFilePath = normalizeFilePath;
export const skillStoragePrefix = storagePrefix;
export const getSkillNode = (nodeIdOrSlug: string) => getFileTreeNode("skill", nodeIdOrSlug);
export const readSkillTextFile = readTextFile;
export const writeSkillTextFile = writeTextFile;
export const deleteSkillFile = deleteTextFile;
export const listSkillStorageFiles = listStorageFiles;
export const resolveSkillStoragePrefix = (node: Parameters<typeof resolveStoragePrefix>[0]) =>
  resolveStoragePrefix(node, ["skill"]);
