import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextSpaceId } from "./context";
import { assetsRouter } from "./domains/assets/router";
import { baseRouter, recordRouter, viewRouter } from "./domains/base/router";
import { docRouter } from "./domains/doc/router";
import { driveRouter } from "./domains/drive/router";
import { fileRouter } from "./domains/file-node/router";
import { folderRouter } from "./domains/folder/router";
import { skillRouter } from "./domains/skill/router";
import { vaultRouter } from "./domains/vault/router";
import { listActivityPaged } from "./logic/activity";
import { subscribeBusabaseLiveEvents } from "./logic/live-events";
import {
  closeChangeRequest,
  countChangeRequests,
  createAuditEvent,
  createComment,
  createNodeChangeRequest,
  getAuthInfo,
  getChangeRequest,
  listAgentTasks,
  listArchivedNodes,
  listAuditEvents,
  listChangeRequests,
  listChangeRequestsPaged,
  listComments,
  listNodes,
  mergeChangeRequest,
  mergeChangeRequests,
  purgeNode,
  reviewChangeRequest,
  reviewChangeRequests,
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
    listArchived: busabase.nodes.listArchived.handler(async () => listArchivedNodes()),
    createChangeRequest: busabase.nodes.createChangeRequest.handler(async ({ input }) =>
      createNodeChangeRequest(input),
    ),
    purge: busabase.nodes.purge.handler(async ({ input }) => purgeNode(input.nodeId)),
  },
  auditEvents: {
    list: busabase.auditEvents.list.handler(async ({ input }) => listAuditEvents(input)),
    create: busabase.auditEvents.create.handler(async ({ input }) => createAuditEvent(input)),
  },
  activity: {
    listPaged: busabase.activity.listPaged.handler(async ({ input }) => listActivityPaged(input)),
  },
  comments: {
    list: busabase.comments.list.handler(async ({ input }) => listComments(input)),
    create: busabase.comments.create.handler(async ({ input }) => createComment(input)),
  },
  agent: {
    listTasks: busabase.agent.listTasks.handler(async () => listAgentTasks()),
  },
  live: {
    subscribe: busabase.live.subscribe.handler(({ signal }) =>
      subscribeBusabaseLiveEvents(getContextSpaceId(), signal),
    ),
  },
  bases: baseRouter,
  skills: skillRouter,
  drives: driveRouter,
  files: fileRouter,
  docs: docRouter,
  folders: folderRouter,
  assets: assetsRouter,
  vault: vaultRouter,
  changeRequests: {
    list: busabase.changeRequests.list.handler(async ({ input }) => listChangeRequests(input)),
    listPaged: busabase.changeRequests.listPaged.handler(async ({ input }) =>
      listChangeRequestsPaged(input),
    ),
    counts: busabase.changeRequests.counts.handler(async () => countChangeRequests()),
    get: busabase.changeRequests.get.handler(async ({ input }) => {
      const changeRequest = await getChangeRequest(input.changeRequestId);
      if (!changeRequest) {
        throw new ORPCError("NOT_FOUND", {
          message: `Change request not found: ${input.changeRequestId}`,
        });
      }
      return changeRequest;
    }),
    review: busabase.changeRequests.review.handler(async ({ input }) => {
      const { changeRequestId, ...rest } = input;
      return reviewChangeRequest(changeRequestId, rest);
    }),
    reviewMany: busabase.changeRequests.reviewMany.handler(async ({ input }) => {
      const { changeRequestIds, ...rest } = input;
      return reviewChangeRequests(changeRequestIds, rest);
    }),
    close: busabase.changeRequests.close.handler(async ({ input }) =>
      closeChangeRequest(input.changeRequestId, input.reason),
    ),
    merge: busabase.changeRequests.merge.handler(async ({ input }) =>
      mergeChangeRequest(input.changeRequestId),
    ),
    mergeMany: busabase.changeRequests.mergeMany.handler(async ({ input }) =>
      mergeChangeRequests(input.changeRequestIds),
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
