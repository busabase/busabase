import { implement } from "@orpc/server";
import { busabaseContract } from "./contract/busabase";
import { assetsRouter } from "./domains/assets/router";
import { attachmentsRouter } from "./domains/attachments/router";
import { baseRouter, recordRouter, viewRouter } from "./domains/base/router";
import { docRouter } from "./domains/doc/router";
import { folderRouter } from "./domains/folder/router";
import { skillRouter } from "./domains/skill/router";
import {
  closeChangeRequest,
  createAuditEvent,
  createComment,
  createNodeChangeRequest,
  getAuthInfo,
  getChangeRequest,
  listAgentTasks,
  listAuditEvents,
  listChangeRequests,
  listComments,
  listNodes,
  mergeChangeRequest,
  reviewChangeRequest,
  reviseOperation,
  searchBusabase,
} from "./logic/store";

// Kernel oRPC router: kernel routes inline (search / nodes / audit / comments /
// change-request lifecycle / operations); per-domain route slices composed from the domains.
const busabase = implement(busabaseContract);

export const busabaseRouter = busabase.router({
  auth: {
    verify: busabase.auth.verify.handler(async () => getAuthInfo()),
  },
  search: busabase.search.handler(async ({ input }) => searchBusabase(input)),
  nodes: {
    list: busabase.nodes.list.handler(async () => listNodes()),
    createChangeRequest: busabase.nodes.createChangeRequest.handler(async ({ input }) =>
      createNodeChangeRequest(input),
    ),
  },
  auditEvents: {
    list: busabase.auditEvents.list.handler(async ({ input }) => listAuditEvents(input)),
    create: busabase.auditEvents.create.handler(async ({ input }) => createAuditEvent(input)),
  },
  comments: {
    list: busabase.comments.list.handler(async ({ input }) => listComments(input)),
    create: busabase.comments.create.handler(async ({ input }) => createComment(input)),
  },
  agent: {
    listTasks: busabase.agent.listTasks.handler(async () => listAgentTasks()),
  },
  bases: baseRouter,
  skills: skillRouter,
  docs: docRouter,
  folders: folderRouter,
  attachments: attachmentsRouter,
  assets: assetsRouter,
  changeRequests: {
    list: busabase.changeRequests.list.handler(async ({ input }) => listChangeRequests(input)),
    get: busabase.changeRequests.get.handler(async ({ input }) => {
      const changeRequest = await getChangeRequest(input.changeRequestId);
      if (!changeRequest) {
        throw new Error(`ChangeRequest not found: ${input.changeRequestId}`);
      }
      return changeRequest;
    }),
    review: busabase.changeRequests.review.handler(async ({ input }) => {
      const { changeRequestId, ...rest } = input;
      return reviewChangeRequest(changeRequestId, rest);
    }),
    close: busabase.changeRequests.close.handler(async ({ input }) =>
      closeChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: busabase.changeRequests.merge.handler(async ({ input }) =>
      mergeChangeRequest(input.changeRequestId),
    ),
  },
  operations: {
    revise: busabase.operations.revise.handler(async ({ input }) => {
      const { operationId, ...rest } = input;
      return reviseOperation(operationId, rest);
    }),
  },
  records: recordRouter,
  views: viewRouter,
});
