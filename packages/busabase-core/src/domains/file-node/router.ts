import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { createFileNode, getFileNodeDetail, listFileNodes } from "./handlers";

const os = implement(busabaseContract);

export const fileRouter = {
  list: os.files.list.handler(async () => listFileNodes()),
  create: os.files.create.handler(async ({ input }) => createFileNode(input)),
  get: os.files.get.handler(async ({ input }) => getFileNodeDetail(input.nodeId)),
};
