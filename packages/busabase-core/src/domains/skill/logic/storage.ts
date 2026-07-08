import "server-only";

import { writeFileTreeTextFile } from "../../filetree/handlers";
import { getFileTreeNode, normalizeFilePath } from "../../filetree/logic/storage";

export const normalizeSkillFilePath = normalizeFilePath;
export const getSkillNode = (nodeIdOrSlug: string) => getFileTreeNode("skill", nodeIdOrSlug);
export const writeSkillTextFile = writeFileTreeTextFile;
