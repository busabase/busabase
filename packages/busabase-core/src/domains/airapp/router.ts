import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  createAirApp,
  createAirAppChangeRequest,
  getAirApp,
  listAirAppFiles,
  listAirApps,
  readAirAppFile,
} from "./handlers";

// AirApp domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const airappRouter = {
  list: os.airapps.list.handler(async () => listAirApps()),
  create: os.airapps.create.handler(async ({ input }) => createAirApp(input)),
  get: os.airapps.get.handler(async ({ input }) => getAirApp(input.nodeId)),
  listFiles: os.airapps.listFiles.handler(async ({ input }) => listAirAppFiles(input.nodeId)),
  readFile: os.airapps.readFile.handler(async ({ input }) =>
    readAirAppFile(input.nodeId, input.filePath),
  ),
  createChangeRequest: os.airapps.createChangeRequest.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return createAirAppChangeRequest(nodeId, rest);
  }),
};
