import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getFolder, listFolders } from "./handlers";

// Folder domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const folderRouter = {
  list: os.folders.list.handler(async () => listFolders()),
  get: os.folders.get.handler(async ({ input }) => getFolder(input.nodeId)),
};
