import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { runAirAppLocalNode } from "./logic/local-node-runtime";

// AirApp domain oRPC handler slice; aggregated into the kernel router (router.ts).
// The CRUD/file surface lives on the shared `/file-trees` router — only the
// local-node runtime is AirApp-specific.
const os = implement(busabaseContract);

export const airappRouter = {
  runLocalNode: os.airapps.runLocalNode.handler(({ input, signal }) =>
    runAirAppLocalNode(input, signal),
  ),
};
