import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { runOrAttachSession, stopRunSession } from "./logic/run-session";

// AirApp domain oRPC handler slice; aggregated into the kernel router (router.ts).
// The CRUD/file surface lives on the shared `/file-trees` router — only the
// local runtime is AirApp-specific.
const os = implement(busabaseContract);

export const airappRouter = {
  // Start-or-attach, not start: a second viewer of a running app joins it
  // instead of racing a second `npm install` against the first.
  runLocal: os.airapps.runLocal.handler(({ input, signal }) => runOrAttachSession(input, signal)),
  stopLocal: os.airapps.stopLocal.handler(({ input }) => stopRunSession(input.nodeId)),
};
