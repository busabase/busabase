import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { createDoc, createDocChangeRequest, getDoc, listDocs, updateDocBody } from "./handlers";

// Doc domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const docRouter = {
  list: os.docs.list.handler(async () => listDocs()),
  create: os.docs.create.handler(async ({ input }) => createDoc(input)),
  get: os.docs.get.handler(async ({ input }) => getDoc(input.nodeId)),
  updateBody: os.docs.updateBody.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return updateDocBody(nodeId, rest);
  }),
  createChangeRequest: os.docs.createChangeRequest.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return createDocChangeRequest(nodeId, rest);
  }),
};
