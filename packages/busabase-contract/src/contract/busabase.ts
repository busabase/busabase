import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import { airappContract, airappRuntimeContract } from "../domains/airapp/contract";
import { assetsContract } from "../domains/assets/contract";
import {
  baseContract,
  recordContract,
  recordSchema,
  viewContract,
  viewSchema,
} from "../domains/base/contract";
import { docContract } from "../domains/doc/contract";
import { driveContract } from "../domains/drive/contract";
import { dumpContract } from "../domains/dump/contract";
import { fileContract } from "../domains/file-node/contract";
import { folderContract } from "../domains/folder/contract";
import { installContract } from "../domains/install/contract";
import { skillContract } from "../domains/skill/contract";
import { vaultContract } from "../domains/vault/contract";
import { webhookContract } from "../domains/webhook/contract";
import { listActivityPagedInputSchema, listActivityResponseSchema } from "./activity-schemas";
import { UnifiedGrepInputSchema, UnifiedGrepResultVOSchema } from "./grep-schemas";
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
  listChangeRequestsResponseSchema,
  listInputSchema,
  listNodesInputSchema,
  liveEventSchema,
  moveNodeInputSchema,
  nodePrincipalSchema,
  nodeSchema,
  nodeSearchResultSchema,
  reviewChangeRequestInputSchema,
  reviseOperationInputSchema,
  searchInputSchema,
  searchNodesByNameInputSchema,
  searchResponseSchema,
  updateNodeMetadataInputSchema,
} from "./schemas";

// Per-item outcome for the batch review/merge endpoints. Failures are isolated:
// one bad change request records an `error` and the rest still process, so an agent
// acting on "just merge them all" gets a full report instead of an abort.
const changeRequestBatchResultSchema = z.object({
  results: z.array(
    z.object({
      changeRequestId: z.string(),
      ok: z.boolean(),
      status: z.string().optional(),
      error: z.string().optional(),
    }),
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
  // Unified Grep (P2a files+docs, P2b records) — top-level, cross-source
  // superset of `assets.grep`. See apps/busabase/content/spec/unified-grep.md.
  // Composes `logic/grep.ts`; `assets.grep` (files-only specialist) is
  // unchanged and stays the dedicated endpoint for its fuller
  // missing/stale/unsearchable reporting.
  grep: oc
    .route({
      method: "POST",
      path: "/grep",
      tags: ["Search"],
      summary: "Search files, Docs, and Base records with one pattern (unified grep)",
      successDescription:
        "Streaming regex/literal matches across every in-scope source — Drive/Skill files, Doc bodies, and Base records (canonical headCommit.fields, never the truncated search projection) — with one shared pattern, one shared maxMatches/deadline budget (files scanned first, then docs, then whatever budget remains goes to records), and a per-source honest coverage report (files keeps its existing missing/stale/unsearchable/errored/notReached; docs and records report scanned/errored/notReached). truncated is set when any source truncated or has notReached > 0.",
    })
    .input(UnifiedGrepInputSchema)
    .output(UnifiedGrepResultVOSchema),
  nodes: {
    list: oc
      .route({
        method: "GET",
        path: "/nodes",
        tags: ["Nodes"],
        summary: "List node tree",
        successDescription:
          "Workspace node tree including folders, Bases, files, and agents. With no `parentId`/`depth`, returns the FULL tree (legacy behavior, still what every non-sidebar caller gets). Passing `parentId` and/or `depth` switches to a depth-bounded fetch: `parentId` omitted/null starts from the space root and returns it wrapped exactly like the legacy call (just depth-limited); an explicit `parentId` returns that node's children directly, ready to merge into its `NodeVO.children` for a sidebar's lazy per-folder expand. See `NodeVO.hasChildren` for how a depth boundary is surfaced.",
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
          "Plain ilike match on name/slug across every registered node type, scoped by the same node-visibility ACL as `nodes.list`. No content scan and no full-text ranking — ordered exact-slug-match first, then by name. Backs the dashboard search dialog's 'Recent' tab cache-miss path (see apps/busabase/content/spec/search-quick-jump.md); the heavier `search` endpoint remains the dedicated full-text content search.",
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
    listArchived: oc
      .route({
        method: "GET",
        path: "/nodes/archived",
        tags: ["Nodes"],
        summary: "List archived nodes",
        successDescription: "Soft-archived folders, docs, and skills (for the Trash view).",
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
          "Shallow-merged the supplied top-level keys into the active node's existing metadata. Requires write access on the node.",
      })
      .input(updateNodeMetadataInputSchema)
      .output(nodeSchema),
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
    subscribe: oc.output(eventIterator(liveEventSchema)),
  },
  bases: baseContract,
  skills: skillContract,
  drives: driveContract,
  airapps: { ...airappContract, ...airappRuntimeContract },
  files: fileContract,
  docs: docContract,
  folders: folderContract,
  assets: assetsContract,
  vault: vaultContract,
  webhooks: webhookContract,
  dump: dumpContract,
  install: installContract,
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
    listPaged: oc
      .route({
        method: "GET",
        path: "/change-requests/paged",
        tags: ["Change Requests"],
        summary: "List change requests with keyset pagination",
        successDescription:
          "A page of change requests plus an opaque nextCursor (null at the end). Filter with `status` and/or `mine`.",
      })
      .input(listChangeRequestsPagedInputSchema)
      .output(listChangeRequestsResponseSchema),
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
        path: "/change-requests/{changeRequestId}/reviews",
        tags: ["Change Requests"],
        summary: "Review change request",
        successDescription: "Reviewed change request.",
      })
      .input(reviewChangeRequestInputSchema.extend({ changeRequestId: z.string() }))
      .output(changeRequestSchema),
    reviewMany: oc
      .route({
        method: "POST",
        path: "/change-requests/reviews",
        tags: ["Change Requests"],
        summary: "Review many change requests",
        successDescription:
          "Per-change-request review results (failures isolated — one bad id does not abort the rest).",
      })
      .input(
        reviewChangeRequestInputSchema.extend({
          changeRequestIds: z.array(z.string()).min(1).max(100),
        }),
      )
      .output(changeRequestBatchResultSchema),
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
    mergeMany: oc
      .route({
        method: "POST",
        path: "/change-requests/merge",
        tags: ["Change Requests"],
        summary: "Merge many change requests",
        successDescription:
          "Per-change-request merge results (each merged in its own transaction; failures isolated).",
      })
      .input(z.object({ changeRequestIds: z.array(z.string()).min(1).max(100) }))
      .output(changeRequestBatchResultSchema),
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
  UnifiedGrepDocMatchVOSchema,
  UnifiedGrepDocsCoverageSchema,
  UnifiedGrepDocsScopeSchema,
  UnifiedGrepFileMatchVOSchema,
  UnifiedGrepFilesCoverageSchema,
  UnifiedGrepFilesScopeSchema,
  UnifiedGrepInputSchema,
  UnifiedGrepMatchVOSchema,
  UnifiedGrepRecordMatchVOSchema,
  UnifiedGrepRecordsCoverageSchema,
  UnifiedGrepRecordsScopeSchema,
  UnifiedGrepResultVOSchema,
  UnifiedGrepScopeSchema,
} from "./grep-schemas";
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
