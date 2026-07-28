import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
} from "../filetree/contract";
import type { DriveFileVO, DriveVO } from "./types";

export type { DriveFileVO, DriveVO };

// Drives are served by the shared `/file-trees` surface (`type: "drive"`) — see
// `../filetree/contract`. These aliases stay because callers name the schemas
// after the node type they are working with.
export const driveFileSchema = fileTreeFileSchema;
export const driveSchema = fileTreeNodeSchema;
export const createDriveInputSchema = createFileTreeInputSchema;
export const driveFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createDriveChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;
