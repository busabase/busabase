import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { isAnonymousVisitor } from "../../context";
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
    return submitForm(nodeId, rest, { isAnonymous: isAnonymousVisitor() });
  }),
};
