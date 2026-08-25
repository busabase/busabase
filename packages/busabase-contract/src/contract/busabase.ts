import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { agentsContract } from "../domains/agents/contract";
import { airappRuntimeContract } from "../domains/airapp/contract";
import { assetsContract } from "../domains/assets/contract";
import { ReadLinesVOSchema } from "../domains/assets/types";
import {
  baseContract,
  recordContract,
  recordSchema,
  viewContract,
  viewSchema,
} from "../domains/base/contract";
import { docContract } from "../domains/doc/contract";
import { ReadNodeLinesInputSchema } from "../domains/doc/types";
import { dumpContract } from "../domains/dump/contract";
import { fileContract } from "../domains/file-node/contract";
import { fileTreeContract } from "../domains/filetree/contract";
import { formContract } from "../domains/form/contract";
import { guidesContract } from "../domains/guides/contract";
import { installContract } from "../domains/install/contract";
import { templatesContract } from "../domains/templates/contract";
import { vaultContract } from "../domains/vault/contract";
import { webhookContract } from "../domains/webhook/contract";
import {
  activityItemSchema,
  listActivityPagedInputSchema,
  listActivityResponseSchema,
  listNodeActivityInputSchema,
  listRecordActivityInputSchema,
} from "./activity-schemas";
import { UnifiedGrepInputSchema, UnifiedGrepResultVOSchema } from "./grep-schemas";
import { updateNodeContentInputSchema } from "./node-content-schemas";
import { getNodeInputSchema, NodeDetailVOSchema } from "./node-detail-schemas";
import {
  NodeIconConfirmInputSchema,
  NodeIconConfirmVOSchema,
  NodeIconUploadUrlInputSchema,
  NodeIconUploadUrlVOSchema,
} from "./node-icon-upload-schemas";
import {
  agentTaskSchema,
  auditEventSchema,
  authInfoSchema,
  changeRequestCountsSchema,
  changeRequestSchema,
  commentSchema,
  commentSubjectInputSchema,
  createAuditEventInputSchema,
  createCommentInputSchema,
  createNodeChangeRequestInputSchema,
  isDescendantInputSchema,
  isDescendantOutputSchema,
  listChangeRequestsPagedInputSchema,
  listChangeRequestsPageInputSchema,
  listChangeRequestsPageResponseSchema,
  listChangeRequestsResponseSchema,
  listInputSchema,
  listNodesInputSchema,
  liveEventSchema,
  moveNodeInputSchema,
  nodePrincipalSchema,
  nodeSchema,
  nodeSearchResultSchema,
  nodeShareSchema,
  reviewChangeRequestInputSchema,
  reviseOperationInputSchema,
  searchInputSchema,
  searchNodesByNameInputSchema,
  searchResponseSchema,
  updateNodeMetadataInputSchema,
} from "./schemas";

const changeRequestBatchFailureSchema = z.object({
  changeRequestId: z.string(),
  ok: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  data: z.unknown().optional(),
});

// Per-item outcomes carry the full successful value so higher-level clients can
// preserve their ergonomic single-item methods while the raw API stays batched.
const changeRequestReviewBatchResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion("ok", [
      z.object({
        changeRequestId: z.string(),
        ok: z.literal(true),
        status: z.string(),
        changeRequest: changeRequestSchema,
      }),
      changeRequestBatchFailureSchema,
    ]),
  ),
});

const changeRequestMergeBatchResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion("ok", [
      z.object({
        changeRequestId: z.string(),
        ok: z.literal(true),
        status: z.string(),
        changeRequest: changeRequestSchema,
        record: recordSchema.nullable(),
        view: viewSchema.nullable(),
      }),
      changeRequestBatchFailureSchema,
    ]),
  ),
});

export const busabaseContractRoutes = {
  auth: {
    verify: oc
      .route({
        method: "GET",
        path: "/auth",
        tags: ["Auth"],
        summary: "Verify auth and get the targeted space, user, membership, and all spaces",
        successDescription:
          "The space this request targets, the acting user, their membership, and every space the user belongs to (`spaces`). Open source returns the local space/user; the cloud resolves the real ones from the user API key — when `spaces` has more than one entry, target a specific space with the `x-busabase-space` header instead of relying on the default.",
      })
      .output(authInfoSchema),
  },
  search: oc
    .route({
      method: "GET",
      path: "/search",
      tags: ["Search"],
      summary: "Search Busabase",
      successDescription:
        "Paginated search results across records, change requests, Bases, File nodes, and Assets.",
    })
    .input(searchInputSchema)
    .output(searchResponseSchema),
  // Unified Grep (P2a files+docs, P2b records) — the single public pattern
  // search endpoint. Files-only callers use `sources: ["files"]` and retain
  // the full missing/stale/unsearchable coverage block.
  grep: oc
    .route({
      method: "POST",
      path: "/grep",
      tags: ["Search"],
      summary: "Search files, Docs, and Base records with one pattern (unified grep)",
      successDescription:
        "Streaming regex/literal matches across every in-scope source — Drive/Skill files, Doc bodies, and Base records (canonical headCommit.payload, never the truncated search projection) — with one shared pattern, one shared maxMatches/deadline budget (files scanned first, then docs, then whatever budget remains goes to records), and a per-source honest coverage report (files keeps its existing missing/stale/unsearchable/errored/notReached; docs and records report scanned/errored/notReached). truncated is set when any source truncated or has notReached > 0.",
    })
    .input(UnifiedGrepInputSchema)
    .output(UnifiedGrepResultVOSchema),
  nodes: {
    list: oc
      .route({
        method: "GET",
        path: "/nodes",
        tags: ["Nodes"],
        summary: "List nodes (workspace tree, or a flat summary list by type)",
        successDescription:
          "Workspace node tree including folders, Bases, files, and agents. With no `parentId`/`depth`, returns the FULL tree (legacy behavior, still what every non-sidebar caller gets). Passing `parentId` and/or `depth` switches to a depth-bounded fetch: `parentId` omitted/null starts from the space root and returns it wrapped exactly like the legacy call (just depth-limited); an explicit `parentId` returns that node's children directly, ready to merge into its `NodeVO.children` for a sidebar's lazy per-folder expand. See `NodeVO.hasChildren` for how a depth boundary is surfaced. Passing `types` instead returns a FLAT, ACL-filtered list of lightweight summaries (`children: []`) for just those node types — this is what replaced `GET /docs`, `/files`, `/folders`, and `/file-trees`, and it deliberately hydrates nothing heavy (no Doc bodies, backing Assets, folder children, or file inventories). Open one item with `GET /nodes/{nodeId}`.",
      })
      .input(listNodesInputSchema)
      .output(z.array(nodeSchema)),
    searchByName: oc
      .route({
        method: "GET",
        path: "/nodes/search",
        tags: ["Nodes", "Search"],
        summary: "Search nodes by name/slug (cheap, name-only quick-jump)",
        successDescription:
          "Plain ilike match on name/slug across every registered node type, scoped by the same node-visibility ACL as `nodes.list`. No content scan and no full-text ranking — ordered exact-slug-match first, then by name. Backs the dashboard search dialog's 'Recent' tab cache-miss path; the heavier `search` endpoint remains the dedicated full-text content search.",
      })
      .input(searchNodesByNameInputSchema)
      .output(z.array(nodeSearchResultSchema)),
    isDescendant: oc
      .route({
        method: "GET",
        path: "/nodes/{nodeId}/is-descendant",
        tags: ["Nodes"],
        summary: "Check whether a node is a descendant of another",
        successDescription:
          "Server-authoritative parentId-chain walk from nodeId up to potentialAncestorId. Used to gate cross-branch drag-and-drop drops in the sidebar, since the full tree is no longer guaranteed to be loaded client-side (depth-bounded lazy load) — a purely local walk could wrongly allow dropping a folder into its own unloaded descendant.",
      })
      .input(isDescendantInputSchema)
      .output(isDescendantOutputSchema),
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
    move: oc
      .route({
        method: "POST",
        path: "/nodes/{nodeId}/move",
        tags: ["Nodes"],
        summary: "Move or reorder a node",
        successDescription:
          "Merged change request that repositioned the node under its (optionally new) parent. Applied immediately (auto-merged) since reordering is a low-risk structural tweak, not a review-worthy content change.",
      })
      .input(moveNodeInputSchema)
      .output(changeRequestSchema),
    updateMetadata: oc
      .route({
        method: "PATCH",
        path: "/nodes/{nodeId}/metadata",
        tags: ["Nodes"],
        summary: "Update node metadata",
        successDescription:
          "Shallow-merged the supplied top-level keys into the active node's existing metadata. Requires write access on the node. Node CONTENT (a Doc body, or a whiteboard/workflow/html document) does not go through here — use PUT /nodes/{nodeId}/content instead.",
      })
      .input(updateNodeMetadataInputSchema)
      .output(nodeSchema),
    updateContent: oc
      .route({
        method: "PUT",
        path: "/nodes/{nodeId}/content",
        tags: ["Nodes", "Change Requests"],
        summary: "Update node content",
        successDescription:
          "ChangeRequest carrying the proposed content. Merged immediately when the actor holds write access on the node and `autoMerge` was not explicitly `false`; otherwise left `in_review` for a human. Accepts doc, whiteboard, workflow, and html nodes — the types that own exactly one document.",
      })
      .input(updateNodeContentInputSchema)
      .output(changeRequestSchema),
    readLines: oc
      .route({
        method: "GET",
        path: "/nodes/{nodeId}/lines",
        tags: ["Nodes"],
        summary: "Read an exact line range from a node's content",
        successDescription:
          'Lines [startLine, endLine] (range capped at 2000 lines / ~2MB response) from any node type that stores content — doc, html, whiteboard, workflow. The follow-up to a Unified Grep match with `source: "nodes"`, so an agent can read just the lines around a match instead of `nodes.get`\'s entire document. Line numbers mean whatever they mean for that node type: real source lines for doc/html, positions within the extracted text for the JSON-backed types. Replaces `GET /docs/{nodeId}/lines`, which resolved doc nodes only.',
      })
      .input(ReadNodeLinesInputSchema)
      .output(ReadLinesVOSchema),
    purge: oc
      .route({
        method: "DELETE",
        path: "/nodes/{nodeId}",
        tags: ["Nodes"],
        summary: "Permanently delete an archived node",
        successDescription:
          "Irreversibly removed an archived folder/doc/skill (and its subtree). Refused unless archived and refused if the subtree contains a Base.",
      })
      .input(z.object({ nodeId: z.string() }))
      .output(z.object({ purged: z.boolean() })),
    updateVisibility: oc
      .route({
        method: "POST",
        path: "/nodes/{nodeId}/visibility",
        tags: ["Nodes", "Permissions"],
        summary: "Set a node's visibility (private / workspace / public)",
        successDescription:
          "Updated the node's own explicit visibility and re-materialized the subtree's effective visibility (a child can only ever be as open as its strictest ancestor). Requires `manage` level on the node. The workspace root cannot be made private. `public` currently behaves as `workspace` (no anonymous surface yet).",
      })
      .input(
        z.object({
          nodeId: z.string(),
          visibility: z.enum(["private", "workspace", "public"]).nullable(),
        }),
      )
      .output(z.object({ updated: z.boolean() })),
    toggleFavorite: oc
      .route({
        method: "POST",
        path: "/nodes/{nodeId}/favorite",
        tags: ["Nodes", "Favorites"],
        summary: "Toggle the current actor's favorite on a node",
        successDescription:
          "Upserted or deleted a row keyed by the (nodeId, actorId) unique pair — a true toggle, race-safe under a rapid double-click, never a duplicate. `favorited` reflects the node's new state for the acting user. Purely additive: never moves or hides the node from its real position in the Bases tree.",
      })
      .input(z.object({ nodeId: z.string() }))
      .output(z.object({ favorited: z.boolean() })),
    listFavorites: oc
      .route({
        method: "GET",
        path: "/nodes/favorites",
        tags: ["Nodes", "Favorites"],
        summary: "List the current actor's favorited nodes",
        successDescription:
          "The acting user's favorited nodes, newest-favorited first, filtered through the same archived/deleted/visibility rules as the main tree — a favorited node that's later archived, purged, or (cloud) hidden from this actor silently drops out rather than erroring.",
      })
      .output(z.array(nodeSchema)),
    // Registered LAST among the `/nodes/...` GETs on purpose. `GET /nodes/search`
    // and `GET /nodes/favorites` are literal paths that now share a prefix with
    // this template. The oRPC OpenAPI matcher is a rou3 radix trie, which
    // prefers a static segment over a param segment independently of insertion
    // order — but keeping the literals declared first means the source order
    // matches the resolution order, so nobody has to know that to read this
    // file. `tests/openapi-node-routes.test.ts` proves the literals still win
    // against a real handler rather than resolving as `nodeId: "search"`.
    get: oc
      .route({
        method: "GET",
        path: "/nodes/{nodeId}",
        tags: ["Nodes"],
        summary: "Get one node's typed detail",
        successDescription:
          "The node's full detail, discriminated by its `type`. One entry point for every node type, so a caller holding an id never has to discover the type first: `folder` carries its direct `children`, `doc` its storage-backed `body`, `file` its backing `asset`, and `skill`/`drive`/`airapp` their Asset-backed `files`. Types with no richer detail yet (`base`, `form`, `whiteboard`, `workflow`, `html`) return just `node`. `nodeId` accepts an id or a slug; pass `type` when a slug exists under more than one type. Archived nodes are not returned (404), matching the typed gets this replaced.",
      })
      .input(getNodeInputSchema)
      .output(NodeDetailVOSchema),
    principals: {
      list: oc
        .route({
          method: "GET",
          path: "/nodes/{nodeId}/principals",
          tags: ["Nodes", "Permissions"],
          summary: "List a node's direct access grants",
          successDescription:
            "Direct grants defined ON this node (inherited copies from ancestor folders are not listed). Requires the node to be visible to the caller.",
        })
        .input(z.object({ nodeId: z.string() }))
        .output(z.array(nodePrincipalSchema)),
      add: oc
        .route({
          method: "POST",
          path: "/nodes/{nodeId}/principals",
          tags: ["Nodes", "Permissions"],
          summary: "Grant (or update) a principal's access level on a node",
          successDescription:
            "Upserted one direct grant (same principal twice updates its level) and re-materialized inherited copies down the subtree. Requires `manage` level on the node.",
        })
        .input(
          z.object({
            nodeId: z.string(),
            principalType: z.enum(["user", "space"]),
            principalId: z.string().min(1),
            role: z.enum(["read", "changeRequest", "write", "manage"]),
          }),
        )
        .output(z.object({ granted: z.boolean() })),
      remove: oc
        .route({
          method: "DELETE",
          path: "/nodes/{nodeId}/principals",
          tags: ["Nodes", "Permissions"],
          summary: "Revoke a principal's access grant on a node",
          successDescription:
            "Removed the direct grant (and its materialized inherited copies). Requires `manage` level on the node.",
        })
        .input(
          z.object({
            nodeId: z.string(),
            principalType: z.enum(["user", "space"]),
            principalId: z.string().min(1),
          }),
        )
        .output(z.object({ removed: z.boolean() })),
    },
    share: {
      get: oc
        .route({
          method: "GET",
          path: "/nodes/{nodeId}/share",
          tags: ["Nodes", "Sharing"],
          summary: "Read a node's public link-sharing settings",
          successDescription:
            "The node's public-share settings, or null when the node was never shared. The stored password is never returned — only a `hasPassword` flag. No URL is returned: the shared node keeps its own canonical address, and only the caller knows which origin its reader should use (see `nodeWebUrl` in busabase-sdk).",
        })
        .input(z.object({ nodeId: z.string() }))
        .output(nodeShareSchema.nullable()),
      set: oc
        .route({
          method: "POST",
          path: "/nodes/{nodeId}/share",
          tags: ["Nodes", "Sharing"],
          summary: "Enable or update a node's public link sharing",
          successDescription:
            "Turned public sharing on (or updated its capability/password/expiry) and re-materialized the effective public scope down the subtree. Requires `manage` level on the node.",
        })
        .input(
          z.object({
            nodeId: z.string(),
            scope: z.enum(["none", "public"]),
            capability: z.enum(["read", "submit"]).optional(),
            password: z.string().nullable().optional(),
            expiresAt: z.string().datetime().nullable().optional(),
          }),
        )
        .output(nodeShareSchema.nullable()),
      disable: oc
        .route({
          method: "DELETE",
          path: "/nodes/{nodeId}/share",
          tags: ["Nodes", "Sharing"],
          summary: "Revoke a node's public link sharing",
          successDescription:
            "Flipped the share scope to none in place, keeping the row, so re-enabling reopens the node's same canonical address rather than minting a new one. Requires `manage` level on the node.",
        })
        .input(z.object({ nodeId: z.string() }))
        .output(nodeShareSchema.nullable()),
    },
    // The node-avatar upload pair — deliberately separate from
    // `assets.createUploadUrl`/`assets.confirm` (see
    // `node-icon-upload-schemas.ts`): a node icon is a single-instance
    // reference stored on the node row, not a Drive Asset library entry.
    icon: {
      createUploadUrl: oc
        .route({
          method: "POST",
          path: "/nodes/icon/upload-urls",
          tags: ["Nodes"],
          summary: "Request a node-icon upload URL",
          successDescription:
            "Presigned (or dev) upload URL plus the public URL, scoped to this node's own dedup namespace so it can never resolve onto (or be deleted alongside) a Drive Asset's attachment row.",
        })
        .input(NodeIconUploadUrlInputSchema)
        .output(NodeIconUploadUrlVOSchema),
      confirm: oc
        .route({
          method: "POST",
          path: "/nodes/icon/confirmations",
          tags: ["Nodes"],
          summary: "Confirm a node-icon upload",
          successDescription: "Recorded the uploaded file as an attachment for this node's icon.",
        })
        .input(NodeIconConfirmInputSchema)
        .output(NodeIconConfirmVOSchema),
    },
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
  activity: {
    listPaged: oc
      .route({
        method: "GET",
        path: "/activity/paged",
        tags: ["Activity"],
        summary: "List the activity feed with keyset pagination",
        successDescription:
          "A page of activity items (change requests, operations, records and audit events merged, newest first) plus an opaque nextCursor (null at the end).",
      })
      .input(listActivityPagedInputSchema)
      .output(listActivityResponseSchema),
    listForNode: oc
      .route({
        method: "GET",
        path: "/activity/node",
        tags: ["Activity"],
        summary: "List a single node's raw activity stream",
        successDescription:
          "A flat, newest-first list of the node's own change requests, operations and (Base only) audit events — no version-number aggregation.",
      })
      .input(listNodeActivityInputSchema)
      .output(z.array(activityItemSchema)),
    listForRecord: oc
      .route({
        method: "GET",
        path: "/activity/record",
        tags: ["Activity"],
        summary: "List a single record's raw activity stream",
        successDescription:
          "A flat, newest-first list of the record's own operations and audit events — no version-number aggregation.",
      })
      .input(listRecordActivityInputSchema)
      .output(z.array(activityItemSchema)),
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
  live: {
    // RPC-only by design: no `.route(...)`, so OpenAPI generation and MCP tool
    // discovery skip this long-lived Event Iterator while `/api/rpc` stays typed.
    // (MCP discovery only skips it because `discoverOpenApiTools` now requires a
    // route with a method or path — omitting `.route()` still leaves `route: {}`,
    // which is truthy, and that used to publish this as a callable REST tool.)
    subscribe: oc.output(eventIterator(liveEventSchema)),
  },
  bases: baseContract,
  // Skills, Drives, and AirApps share one transport surface — they differ only
  // in seed files and entry file, which is a server-side config concern.
  fileTrees: fileTreeContract,
  airapps: airappRuntimeContract,
  files: fileContract,
  docs: docContract,
  // No `folders` key: the Folder domain's only two operations were `GET /folders`
  // and `GET /folders/{nodeId}`, both now served by the unified Node surface
  // (`nodes.list({ types: ["folder"] })` / `nodes.get`).
  forms: formContract,
  assets: assetsContract,
  vault: vaultContract,
  agents: agentsContract,
  webhooks: webhookContract,
  dump: dumpContract,
  install: installContract,
  templates: templatesContract,
  guides: guidesContract,
  changeRequests: {
    // Always keyset-paginated — the unpaginated twin returned a bare array that
    // silently truncated at `limit` with no way to ask for the next page.
    list: oc
      .route({
        method: "GET",
        path: "/change-requests",
        tags: ["Change Requests"],
        summary: "List change requests",
        successDescription:
          "A page of change requests plus an opaque nextCursor (null at the end). Filter with `status` and/or `mine`.",
      })
      .input(listChangeRequestsPagedInputSchema)
      .output(listChangeRequestsResponseSchema),
    // Numbered paging alongside the cursor listing, mirroring records.listPage.
    // Keyset is right for "keep scrolling"; a reviewer working a 2,000-item tab
    // needs to jump to page 30 and to see how many pages there are at all.
    listPage: oc
      .route({
        method: "GET",
        path: "/change-requests/page",
        tags: ["Change Requests"],
        summary: "List a numbered change request page",
        successDescription:
          "A random-access page of change requests plus the total across the whole filter. Same `status` / `mine` filters as the cursor listing.",
      })
      .input(listChangeRequestsPageInputSchema)
      .output(listChangeRequestsPageResponseSchema),
    counts: oc
      .route({
        method: "GET",
        path: "/change-requests/counts",
        tags: ["Change Requests"],
        summary: "Count change requests by inbox tab",
        successDescription:
          "Whole-space change request counts per inbox tab (review / changes / created / approved / merged / rejected).",
      })
      .output(changeRequestCountsSchema),
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
        path: "/change-requests/reviews",
        tags: ["Change Requests"],
        summary: "Review change requests",
        successDescription:
          "Per-change-request review results (failures isolated — one bad id does not abort the rest).",
      })
      .input(
        reviewChangeRequestInputSchema.extend({
          changeRequestIds: z.array(z.string()).min(1).max(100),
        }),
      )
      .output(changeRequestReviewBatchResultSchema),
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
        path: "/change-requests/merge",
        tags: ["Change Requests"],
        summary: "Merge change requests",
        successDescription:
          "Per-change-request merge results (each merged in its own transaction; failures isolated).",
      })
      .input(z.object({ changeRequestIds: z.array(z.string()).min(1).max(100) }))
      .output(changeRequestMergeBatchResultSchema),
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
};

export const busabaseContract = oc.prefix("/api/v1").router(busabaseContractRoutes);

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
  UpdateVaultSettingsInputSchema,
  VaultAccessPolicySchema,
  VaultEnvironmentSchema,
  VaultItemInputSchema,
  VaultItemKindSchema,
  VaultItemVOSchema,
  VaultRuntimeEnvSchema,
  VaultScopeTypeSchema,
  VaultSettingsVOSchema,
  VaultSuccessSchema,
} from "../domains/vault/types";
export {
  ListWebhookDeliveriesInputSchema,
  ListWebhookRulesInputSchema,
  WebhookActionKindSchema,
  WebhookDeliveryStatusSchema,
  WebhookDeliveryVOSchema,
  WebhookEventTypeSchema,
  WebhookFunctionConfigSchema,
  WebhookFunctionConfigVOSchema,
  WebhookHttpConfigSchema,
  WebhookHttpConfigVOSchema,
  WebhookRuleInputSchema,
  WebhookRuleUpdateInputSchema,
  WebhookRuleVOSchema,
} from "../domains/webhook/types";
export {
  GrepSourceSchema,
  UnifiedGrepCoverageSchema,
  UnifiedGrepFileMatchVOSchema,
  UnifiedGrepFilesCoverageSchema,
  UnifiedGrepFilesScopeSchema,
  type UnifiedGrepInputDTO,
  UnifiedGrepInputSchema,
  UnifiedGrepMatchVOSchema,
  UnifiedGrepNodeMatchVOSchema,
  UnifiedGrepNodesCoverageSchema,
  UnifiedGrepNodesScopeSchema,
  UnifiedGrepRecordMatchVOSchema,
  UnifiedGrepRecordsCoverageSchema,
  UnifiedGrepRecordsScopeSchema,
  UnifiedGrepResultVOSchema,
  UnifiedGrepScopeSchema,
} from "./grep-schemas";
export {
  getNodeInputSchema,
  type NodeDetailVO,
  NodeDetailVOSchema,
} from "./node-detail-schemas";
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
  liveEventSchema,
  nodeSchema,
  operationSchema,
  reviewChangeRequestInputSchema,
  reviewSchema,
  reviseOperationInputSchema,
  searchInputSchema,
  searchResponseSchema,
  searchResultSchema,
} from "./schemas";
