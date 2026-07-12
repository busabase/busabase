import {
  createFileTreeChangeRequestInputSchema,
  createFileTreeInputSchema,
  fileTreeFileOperationInputSchema,
  fileTreeFileSchema,
  fileTreeNodeSchema,
  makeFileTreeContract,
} from "../filetree/contract";
import type { AirAppFileVO, AirAppVO } from "./types";

export type { AirAppFileVO, AirAppVO };

export const airappFileSchema = fileTreeFileSchema;
export const airappSchema = fileTreeNodeSchema;
export const createAirAppInputSchema = createFileTreeInputSchema;
export const airappFileOperationInputSchema = fileTreeFileOperationInputSchema;
export const createAirAppChangeRequestInputSchema = createFileTreeChangeRequestInputSchema;

export const airappContract = makeFileTreeContract("airapps", "AirApps");
