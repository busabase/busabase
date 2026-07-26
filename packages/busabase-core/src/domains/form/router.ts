import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { createForm, getFormByNodeId, submitForm, updateForm } from "./logic/form-ops";

const os = implement(busabaseContract);

export const formRouter = {
  getByNode: os.forms.getByNode.handler(async ({ input }) => {
    const form = await getFormByNodeId(input.nodeId);
    if (!form) {
      throw new ORPCError("NOT_FOUND", { message: `Form not found: ${input.nodeId}` });
    }
    return form;
  }),
  create: os.forms.create.handler(async ({ input }) => createForm(input)),
  update: os.forms.update.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    return updateForm(nodeId, rest);
  }),
  submit: os.forms.submit.handler(async ({ input }) => {
    const { nodeId, ...rest } = input;
    // Dashboard/internal RPC is always an authenticated space member; the
    // anonymous path arrives through the public surface (which passes
    // `isAnonymous`) — see spec §5.1 / §7.
    return submitForm(nodeId, rest, { isAnonymous: false });
  }),
};
