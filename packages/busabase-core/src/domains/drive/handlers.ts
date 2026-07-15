import "server-only";

import type {
  createDriveChangeRequestInputSchema,
  createDriveInputSchema,
} from "busabase-contract/domains/drive/contract";
import type { ChangeRequestVO, DriveVO } from "busabase-contract/types";
import type { z } from "zod";
import { registerMaterializer } from "../../logic/materialize";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  getFileTreeNode,
  listFileTreeFiles,
  listFileTreeNodes,
  makeMaterializer,
  readFileTreeFile,
} from "../filetree/handlers";
import { driveFileTreeConfig } from "./logic/config";

export const createDrive = (input: z.input<typeof createDriveInputSchema>) =>
  createFileTreeNode(driveFileTreeConfig, input) as Promise<
    (DriveVO & { materialized: true }) | (ChangeRequestVO & { materialized: false })
  >;

export const getDrive = (nodeIdOrSlug: string): Promise<DriveVO> =>
  getFileTreeNode(driveFileTreeConfig, nodeIdOrSlug) as Promise<DriveVO>;

export const listDrives = () => listFileTreeNodes(driveFileTreeConfig) as Promise<DriveVO[]>;

export const listDriveFiles = (nodeIdOrSlug: string) =>
  listFileTreeFiles(driveFileTreeConfig, nodeIdOrSlug);

export const readDriveFile = (nodeIdOrSlug: string, filePath: string) =>
  readFileTreeFile(driveFileTreeConfig, nodeIdOrSlug, filePath);

export const createDriveChangeRequest = (
  nodeIdOrSlug: string,
  input: z.input<typeof createDriveChangeRequestInputSchema>,
) => createFileTreeChangeRequest(driveFileTreeConfig, nodeIdOrSlug, input);

export const materializeDriveNode = makeMaterializer(driveFileTreeConfig);

registerMaterializer("drive", materializeDriveNode);
