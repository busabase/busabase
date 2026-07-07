import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
  makeFileTreeContract,
} from "../filetree/contract";

export const skillFileSchema = fileTreeFileSchema;
export const skillSchema = fileTreeNodeSchema;
export const createSkillInputSchema = createFileTreeInputSchema;
export const skillFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createSkillChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

export const skillContract = makeFileTreeContract("skills", "Skills");
