import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
  makeFileTreeContract,
} from "../filetree/contract";
import type { DriveFileVO, DriveVO } from "./types";

export type { DriveFileVO, DriveVO };

export const driveFileSchema = fileTreeFileSchema;
export const driveSchema = fileTreeNodeSchema;
export const createDriveInputSchema = createFileTreeInputSchema;
export const driveFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createDriveChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

export const driveContract = makeFileTreeContract("drives", "Drives");
