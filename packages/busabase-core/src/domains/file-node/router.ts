import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { createFileNode } from "./handlers";

// File-node domain oRPC handler slice; aggregated into the kernel router.
//
// `list` and `get` are gone: `GET /files` and `GET /files/{nodeId}` were folded
// into the unified Node surface (`nodes.list({ types: ["file"] })` /
// `nodes.get`). `listFileNodes` and `getFileNodeDetail` are untouched and still
// called — by the Node detail dispatcher and by busabase-cloud's embed-links
// logic.
const os = implement(busabaseContract);

export const fileRouter = {
  create: os.files.create.handler(async ({ input }) => createFileNode(input)),
};
