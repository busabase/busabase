import { oc } from "@orpc/contract";
import { attachmentsContract } from "open-domains/attachments/contract";
import { z } from "zod";
import { assetsContract } from "../domains/assets/contract";
import {
  baseContract,
  recordContract,
  recordSchema,
  viewContract,
  viewSchema,
} from "../domains/base/contract";
import { docContract } from "../domains/doc/contract";
import { folderContract } from "../domains/folder/contract";
import { skillContract } from "../domains/skill/contract";
import {
  agentTaskSchema,
  auditEventSchema,
  authInfoSchema,
  changeRequestSchema,
  commentSchema,
  commentSubjectInputSchema,
  createAuditEventInputSchema,
  createCommentInputSchema,
  createNodeChangeRequestInputSchema,
  listInputSchema,
  nodeSchema,
  reviewChangeRequestInputSchema,
  reviseOperationInputSchema,
  searchInputSchema,
  searchResponseSchema,
} from "./schemas";

export const busabaseContract = oc.prefix("/api/v1").router({
  auth: {
    verify: oc
      .route({
        method: "GET",
        path: "/auth",
        tags: ["Auth"],
        summary: "Verify auth and get active space, user, and membership",
        successDescription:
          "The active space, acting user, and the user's membership. Open source returns the local space/user; the cloud resolves the real ones from the user API key.",
      })
      .output(authInfoSchema),
  },
  search: oc
    .route({
      method: "GET",
      path: "/search",
      tags: ["Search"],
      summary: "Search Busabase",
      successDescription: "Paginated search results across records, change requests, and Bases.",
    })
    .input(searchInputSchema)
    .output(searchResponseSchema),
  nodes: {
    list: oc
      .route({
        method: "GET",
        path: "/nodes",
        tags: ["Nodes"],
        summary: "List node tree",
        successDescription: "Workspace node tree including folders, Bases, files, and agents.",
      })
      .output(z.array(nodeSchema)),
    createChangeRequest: oc
      .route({
        method: "POST",
        path: "/nodes/change-requests",
        tags: ["Nodes", "Change Requests"],
        summary: "Create Node tree change request",
        successDescription: "Created change request for folder or node tree changes.",
      })
      .input(createNodeChangeRequestInputSchema)
      .output(changeRequestSchema),
  },
  auditEvents: {
    list: oc
      .route({
        method: "GET",
        path: "/audit-events",
        tags: ["Audit"],
        summary: "List audit events",
        successDescription: "Recent non-mutating and workflow audit events.",
      })
      .input(listInputSchema)
      .output(z.array(auditEventSchema)),
    create: oc
      .route({
        method: "POST",
        path: "/audit-events",
        tags: ["Audit"],
        summary: "Create audit event",
        successDescription: "Recorded audit event.",
      })
      .input(createAuditEventInputSchema)
      .output(auditEventSchema),
  },
  comments: {
    list: oc
      .route({
        method: "GET",
        path: "/comments",
        tags: ["Comments"],
        summary: "List comments",
        successDescription: "Comments attached to a Busabase subject.",
      })
      .input(commentSubjectInputSchema)
      .output(z.array(commentSchema)),
    create: oc
      .route({
        method: "POST",
        path: "/comments",
        tags: ["Comments"],
        summary: "Create comment",
        successDescription: "Created comment attached to a Busabase subject.",
      })
      .input(createCommentInputSchema)
      .output(commentSchema),
  },
  agent: {
    listTasks: oc
      .route({
        method: "GET",
        path: "/agent/tasks",
        tags: ["Agent"],
        summary: "List agent revision tasks",
        successDescription:
          "Change requests awaiting an external agent (request-changes or @ai mentions).",
      })
      .output(z.array(agentTaskSchema)),
  },
  bases: baseContract,
  skills: skillContract,
  docs: docContract,
  folders: folderContract,
  attachments: attachmentsContract,
  assets: assetsContract,
  changeRequests: {
    list: oc
      .route({
        method: "GET",
        path: "/change-requests",
        tags: ["Change Requests"],
        summary: "List change requests",
        successDescription: "Change requests waiting for review or ready to merge.",
      })
      .input(listInputSchema)
      .output(z.array(changeRequestSchema)),
    get: oc
      .route({
        method: "GET",
        path: "/change-requests/{changeRequestId}",
        tags: ["Change Requests"],
        summary: "Get change request",
        successDescription: "Change Request detail.",
      })
      .input(z.object({ changeRequestId: z.string() }))
      .output(changeRequestSchema),
    review: oc
      .route({
        method: "POST",
        path: "/change-requests/{changeRequestId}/reviews",
        tags: ["Change Requests"],
        summary: "Review change request",
        successDescription: "Reviewed change request.",
      })
      .input(reviewChangeRequestInputSchema.extend({ changeRequestId: z.string() }))
      .output(changeRequestSchema),
    close: oc
      .route({
        method: "POST",
        path: "/change-requests/{changeRequestId}/close",
        tags: ["Change Requests"],
        summary: "Close change request",
        successDescription: "Closed change request (terminal — distinct from request changes).",
      })
      .input(z.object({ changeRequestId: z.string(), reason: z.string().optional() }))
      .output(changeRequestSchema),
    merge: oc
      .route({
        method: "POST",
        path: "/change-requests/{changeRequestId}/merge",
        tags: ["Change Requests"],
        summary: "Merge change request into Base",
        successDescription: "Merged change request and canonical record.",
      })
      .input(z.object({ changeRequestId: z.string() }))
      .output(
        z.object({
          changeRequest: changeRequestSchema,
          record: recordSchema.nullable(),
          view: viewSchema.nullable(),
        }),
      ),
  },
  operations: {
    revise: oc
      .route({
        method: "POST",
        path: "/operations/{operationId}/revisions",
        tags: ["Operations", "Change Requests"],
        summary: "Revise operation",
        successDescription: "Appended a new commit to the operation and moved the operation head.",
      })
      .input(reviseOperationInputSchema.extend({ operationId: z.string() }))
      .output(changeRequestSchema),
  },
  records: recordContract,
  views: viewContract,
});

export type { AuthInfo, NodeOutput } from "./schemas";
export type BusabaseContract = typeof busabaseContract;
// Base-domain Zod schemas re-exported here so the contract barrel stays the one
// public import surface; their definitions live in domains/base/contract/*.
export {
  baseFieldSchema,
  baseSchema,
  createBaseFieldInputSchema,
  createBaseInputSchema,
  createChangeRequestInputSchema,
  createViewInputSchema,
  deleteViewInputSchema,
  recordFieldFilterInputSchema,
  recordSchema,
  updateViewInputSchema,
  viewConfigSchema,
  viewFilterSchema,
  viewSchema,
  viewSortSchema,
} from "../domains/base/contract";
export {
  auditEventSchema,
  authInfoSchema,
  authMemberSchema,
  authSpaceSchema,
  authUserSchema,
  changeRequestSchema,
  commentSchema,
  commentSubjectInputSchema,
  commitSchema,
  createAuditEventInputSchema,
  createCommentInputSchema,
  createDeleteChangeRequestInputSchema,
  listInputSchema,
  nodeSchema,
  operationSchema,
  reviewChangeRequestInputSchema,
  reviewSchema,
  reviseOperationInputSchema,
  searchInputSchema,
  searchResponseSchema,
  searchResultSchema,
} from "./schemas";
