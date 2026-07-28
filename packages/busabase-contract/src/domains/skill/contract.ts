import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
} from "../filetree/contract";

// Skills are served by the shared `/file-trees` surface (`type: "skill"`) — see
// `../filetree/contract`. These aliases stay because callers name the schemas
// after the node type they are working with.
export const skillFileSchema = fileTreeFileSchema;
export const skillSchema = fileTreeNodeSchema;
export const createSkillInputSchema = createFileTreeInputSchema;
export const skillFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createSkillChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;
