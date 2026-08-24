import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { createDoc } from "./handlers";

// Doc domain oRPC handler slice; aggregated into the kernel router (router.ts).
//
// `list` and `get` are gone: `GET /docs` and `GET /docs/{nodeId}` were folded
// into the unified Node surface (`nodes.list({ types: ["doc"] })` /
// `nodes.get`). `listDocs` and `getDoc` themselves are untouched and still
// called — by the Node detail dispatcher and by busabase-cloud's embed-links
// logic, which reads Docs directly.
//
// `readLines` is gone too: `GET /docs/{nodeId}/lines` resolved doc nodes
// only, so it could not serve the html/whiteboard/workflow matches grep now
// reports. Replaced by the type-agnostic `nodes.readLines` (kernel router).
//
// `updateBody` and `createChangeRequest` are gone too: both write paths were
// unified into `nodes.updateContent` (`domains/rich-node/router.ts`), mounted
// on the kernel router alongside this slice.
const os = implement(busabaseContract);

export const docRouter = {
  create: os.docs.create.handler(async ({ input }) => createDoc(input)),
};
