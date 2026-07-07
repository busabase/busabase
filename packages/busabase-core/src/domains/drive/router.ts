import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  createDrive,
  createDriveChangeRequest,
  getDrive,
  listDriveFiles,
  listDrives,
  readDriveFile,
} from "./handlers";

const os = implement(busabaseContract);

export const driveRouter = {
  list: os.drives.list.handler(async () => listDrives()),
  create: os.drives.create.handler(async ({ input }) => createDrive(input)),
  get: os.drives.get.handler(async ({ input }) => getDrive(input.nodeId)),
  listFiles: os.drives.listFiles.handler(async ({ input }) => listDriveFiles(input.nodeId)),
  readFile: os.drives.readFile.handler(async ({ input }) =>
    readDriveFile(input.nodeId, input.filePath),
  ),
  createChangeRequest: os.drives.createChangeRequest.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return createDriveChangeRequest(nodeId, rest);
  }),
};
