import { z } from "zod";
// Base-owned field/base Zod schemas live in the base domain. They are a pure leaf
// (no kernel imports), so the kernel embeds them eagerly with no import cycle.
import {
  baseSchema,
  fieldNameSchema,
  fieldOptionsSchema,
  fieldTypeSchema,
} from "../domains/base/contract/base-schemas";
import {
  CREATABLE_NODE_TYPES,
  NODE_TYPES,
  type NodeType,
  OPERATION_KINDS,
} from "../domains/registry";
import { autoMergeNotAccepted } from "./auto-merge";

export interface NodeOutput {
  id: string;
  parentId: string | null;
  type: NodeType;
  slug: string;
  name: string;
  description: string;
  metadata: Record<string, unknown> & {
    entryFile?: string;
    visibility?: "private" | "workspace" | "public";
    version?: string;
    assetId?: string;
  };
  position: number;
  createdAt: string;
  updatedAt: string;
  baseId: string | null;
  children: NodeOutput[];
  /**
   * Whether this node has children beyond what `children` carries. Always
   * accurate when the full subtree was loaded (equals `children.length > 0`).
   * The one case it differs: a node sitting exactly at a `nodes.list` `depth`
   * boundary — `children` is `[]` (not fetched) but `hasChildren` is `true`,
   * telling the sidebar to render an expand affordance and lazy-fetch on
   * click instead of rendering it as a leaf. Optional or missing means the
   * caller can safely treat it as `children.length > 0` (which is exactly
   * what it equals whenever it's omitted).
   */
  hasChildren?: boolean;
}

/**
 * Node metadata keys that mean the same thing on EVERY node type — the ones
 * `nodeSchema.metadata` declares explicitly below. Everything else in a node's
 * metadata is free-form and type-specific (a whiteboard's `whiteboardDocument`,
 * busabase-cms's `busabaseCms` mapping on a folder, …).
 *
 * Exported because `updateNodeMetadata` needs exactly this set to decide which
 * keys are always acceptable on a typed node; keeping one list means the
 * allowlist can't drift away from what the schema actually documents.
 */
export const NODE_COMMON_METADATA_KEYS = ["entryFile", "visibility", "version", "assetId"] as const;

const nodeSchema: z.ZodType<NodeOutput> = z.lazy(() =>
  z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    type: z.enum(NODE_TYPES),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    metadata: z
      .object({
        entryFile: z.string().optional(),
        visibility: z.enum(["private", "workspace", "public"]).optional(),
        version: z.string().optional(),
        assetId: z.string().optional(),
      })
      .catchall(z.unknown())
      .default({}),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    baseId: z.string().nullable(),
    children: z.array(nodeSchema),
    hasChildren: z.boolean().optional(),
  }),
);

// One direct node-level access grant (busabase_node_principals row, direct
// grants only — inherited copies materialized down the tree are an internal
// detail and never serialized). `role` reuses the ApiKeyPermissionLevel
// ladder: read < changeRequest < write < manage.
const nodePrincipalSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  principalType: z.enum(["user", "team", "space"]),
  principalId: z.string(),
  role: z.enum(["read", "changeRequest", "write", "manage"]),
  grantedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Public link-sharing VO for a node. This is the orthogonal axis to node
// principals: it decides whether an ANONYMOUS visitor may reach the node over
// its own canonical URL, and what they may do there. SECURITY: this VO must
// NEVER carry the stored password hash — only the derived `hasPassword` flag.
const nodeShareSchema = z.object({
  nodeId: z.string(),
  scope: z.enum(["none", "public"]),
  capability: z.enum(["read", "submit"]),
  // Derived from `passwordHash != null` — the hash itself is never serialized.
  hasPassword: z.boolean(),
  expiresAt: z.string().nullable(),
  updatedAt: z.string(),
});

// Depth-bounded tree fetch (sidebar lazy-load). `parentId` omitted/null starts
// from the space root (same envelope `nodes.list()` always returned: a single
// wrapped root node); an explicit `parentId` starts from that node's CHILDREN
// instead (the shape a folder's lazy "expand" wants to merge straight into
// `NodeVO.children`). `depth` is capped at 5 — deep enough for any realistic
// nested-folder workspace in one round trip chain, shallow enough that a
// pathological/very deep tree can't turn one `nodes.list` call into an
// unbounded number of level-by-level queries server-side. Leaving BOTH fields
// unset is intentionally NOT the same as `{ depth: 2 }` — it is the legacy
// "return the whole tree" call every existing non-sidebar caller (CLI, SDK,
// mobile app, tests, busabase-cloud's own dashboard) already makes and keeps
// making unchanged; only a caller that opts in by passing `parentId` and/or
// `depth` gets the new bounded behavior.
const listNodesInputSchema = z
  .object({
    parentId: z
      .string()
      .nullable()
      .optional()
      .describe("Node to start from. Omit or null to start from the space root."),
    depth: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "How many levels beneath the start point to eagerly include (default 2 once either field is set). Capped at 5.",
      ),
    /**
     * `active` (default) walks the live tree. `archived` returns the flat set of
     * soft-archived nodes for the Trash view — no `parentId`/`depth` walk, since
     * archived nodes are shown as a list, not a tree.
     */
    status: z.enum(["active", "archived"]).optional().default("active"),
    /**
     * Narrow to specific node types and return a FLAT list of lightweight node
     * summaries (`children: []`) instead of walking the tree. This is what
     * replaced the four retired narrow listings (`GET /docs`, `/files`,
     * `/folders`, `/file-trees`); file-trees are selected with their real
     * discriminators `skill` / `drive` / `airapp`, since there is no synthetic
     * "file-tree" node type.
     *
     * Omitting `types` leaves every existing caller on exactly today's
     * behaviour (full tree, or a `parentId`/`depth`-bounded walk, or the
     * archived flat list) — the two modes never interfere.
     *
     * NOTE — no `projection` parameter, deliberately. The consolidation roadmap
     * sketched `?projection=summary`, but it also rules out adding
     * `projection=detail` in this batch (the retired detail lists were the
     * N+1 payloads this change exists to remove). That would leave a parameter
     * with exactly one legal value, which is noise in OpenAPI/MCP/CLI rather
     * than a decision a caller gets to make. Detail is `GET /nodes/{nodeId}`.
     *
     * A GET query param that occurs exactly once (`?types=doc`) arrives as a
     * bare string, not a 1-element array — only a REPEATED occurrence
     * (`?types=doc&types=file`) becomes an array. Accept both and normalize.
     */
    types: z
      .union([z.array(z.enum(NODE_TYPES)), z.enum(NODE_TYPES)])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .optional()
      .describe(
        "Return a flat list of lightweight summaries for these node types instead of the tree. Read one node's full detail with GET /nodes/{nodeId}.",
      ),
  })
  .optional();

const isDescendantInputSchema = z.object({
  nodeId: z.string(),
  potentialAncestorId: z.string(),
});

const isDescendantOutputSchema = z.object({
  isDescendant: z.boolean(),
});

const updateNodeMetadataInputSchema = z.object({
  nodeId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

// Cheap name/slug-only node lookup — the backend half of the dashboard's
// quick-jump `KnownNode` cache-miss path (see
// apps/busabase/content/spec/search-quick-jump.md). Deliberately separate
// from `searchInputSchema`/`searchResponseSchema` below, which back the
// heavier full-text `search` procedure (record/file body content, 5s-budgeted
// asset scanning) — this one is a plain `ilike` over `busabaseNodes.name`/
// `.slug` across all registered node types, no content scan, no ranking beyond
// exact-match-first.
const searchNodesByNameInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

const nodeSearchResultSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  slug: z.string(),
  path: z.string(),
  updatedAt: z.string(),
});

const userRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  role: z.string().nullable().optional(),
});

const commitSchema = z.object({
  id: z.string(),
  baseId: z.string().nullable(),
  targetType: z.enum(["base", "node"]),
  nodeId: z.string().nullable(),
  operationId: z.string().nullable(),
  parentCommitId: z.string().nullable(),
  fields: z.record(z.string(), z.unknown()),
  operation: z.enum(OPERATION_KINDS),
  message: z.string(),
  author: z.string(),
  authorUser: userRefSchema.nullable().optional().default(null),
  createdAt: z.string(),
});

const operationSchema = z.object({
  id: z.string(),
  changeRequestId: z.string(),
  baseId: z.string().nullable(),
  targetType: z.enum(["base", "node"]),
  nodeId: z.string().nullable(),
  operation: z.enum(OPERATION_KINDS),
  status: z.enum(["pending", "merged", "archived", "failed"]),
  targetRecordId: z.string().nullable(),
  targetViewId: z.string().nullable(),
  filePath: z.string().nullable(),
  sourceRecordId: z.string().nullable(),
  sourceCommitId: z.string().nullable(),
  baseCommitId: z.string().nullable(),
  headCommitId: z.string(),
  deleteMode: z.enum(["archive"]),
  mergedRecordId: z.string().nullable(),
  mergedViewId: z.string().nullable(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  headCommit: commitSchema,
  // Resolved canonical "before" values for the operation's target, so the UI can
  // render a true before → after field diff. Null for creations (no prior state)
  // and for kinds whose prior state isn't a field map (e.g. skill files, whose
  // previous content lives in storage). Records resolve from the base commit;
  // views resolve from the current view row ({ name, description, config }).
  baseFields: z.record(z.string(), z.unknown()).nullable(),
});

const reviewSchema = z.object({
  id: z.string(),
  changeRequestId: z.string(),
  reviewerId: z.string(),
  reviewer: userRefSchema.nullable().optional().default(null),
  verdict: z.enum(["approved", "rejected"]),
  reason: z.string().nullable(),
  visibleOperationHeads: z.record(z.string(), z.string()),
  createdAt: z.string(),
});

const commentSubjectTypeSchema = z.enum(["record", "change_request", "operation", "commit"]);

const commentSchema = z.object({
  id: z.string(),
  subjectType: commentSubjectTypeSchema,
  subjectId: z.string(),
  recordId: z.string().nullable(),
  changeRequestId: z.string().nullable(),
  operationId: z.string().nullable(),
  commitId: z.string().nullable(),
  authorId: z.string(),
  author: userRefSchema.nullable().optional().default(null),
  body: z.string(),
  mentionsAi: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const changeRequestStatusSchema = z.enum([
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "merged",
  "abandoned",
  "conflict",
]);

const changeRequestSchema = z.object({
  id: z.string(),
  baseId: z.string().nullable(),
  targetType: z.enum(["base", "node"]),
  nodeId: z.string().nullable(),
  status: changeRequestStatusSchema,
  submittedBy: z.string(),
  submittedByUser: userRefSchema.nullable().optional().default(null),
  sourceMeta: z.record(z.string(), z.unknown()),
  reviewPolicySnapshot: z.record(z.string(), z.unknown()),
  mergeSummary: z.record(z.string(), z.unknown()),
  rejectedReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  mergedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  base: baseSchema.nullable(),
  node: nodeSchema.nullable(),
  operations: z.array(operationSchema),
  primaryOperation: operationSchema.nullable(),
  operationCount: z.number(),
  reviews: z.array(reviewSchema),
});

// A unit of work for an external agent (poll via /agent/tasks). Self-describing:
// the full change request (operations + diffs), why it is queued, the requested-
// changes summary, and the `@ai` comments directing the revision.
const agentTaskSchema = z.object({
  changeRequest: changeRequestSchema,
  trigger: z.enum(["changes_requested", "ai_mention"]),
  reviewReason: z.string().nullable(),
  aiComments: z.array(commentSchema),
});

const searchResultSchema = z.object({
  id: z.string(),
  kind: z.enum(["record", "change_request", "base", "file"]),
  title: z.string(),
  body: z.string(),
  eyebrow: z.string(),
  href: z.string(),
  updatedAt: z.string().nullable(),
});

const searchResponseSchema = z.object({
  query: z.string(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean(),
  results: z.array(searchResultSchema),
});

const liveEventSchema = z.object({
  kind: z.enum([
    "change_request.created",
    "change_request.updated",
    "change_request.deleted",
    "change_request.reviewed",
    "change_request.merged",
    // Fired only when a CONTENT change request freshly enters human review
    // (record_* ops created via record-ops.ts) — never for structural ops
    // that auto-merge instantly (those still fire "change_request.created"
    // via the audit funnel, but nothing needs reviewing). Consumed by
    // `use-live-sync.ts` to pop a desktop Notification, and by
    // busabase-cloud's host hook to persist an inbox notification row.
    "change_request.pending_review",
    // A node's metadata was written directly, outside the change-request flow
    // (`PATCH /api/v1/nodes/{nodeId}/metadata` — agents, the SDK, an MCP tool,
    // and every rich-node editor's own Save). Carries the touched node in
    // `nodeIds` so open dashboards refetch the node tree instead of showing a
    // stale whiteboard/workflow/HTML document until the next reload.
    "node.metadata_updated",
  ]),
  spaceId: z.string(),
  actorId: z.string(),
  // Null for events that aren't about a change request at all
  // (`node.metadata_updated`), which is every direct, auto-audited write.
  changeRequestId: z.string().nullable(),
  baseId: z.string().nullable(),
  nodeIds: z.array(z.string()),
  recordIds: z.array(z.string()),
  viewIds: z.array(z.string()),
  operationCount: z.number(),
});

const auditActionSchema = z.enum([
  "record.viewed",
  "change_request.created",
  "change_request.updated",
  "change_request.deleted",
  "change_request.reviewed",
  "change_request.merged",
  // Direct (non-change-request) mutations — recorded so the audit trail stays
  // complete even for operations that bypass the propose → review → merge flow
  // (container bootstrap, direct edits, library/asset deletes, trash purge).
  "base.created",
  "field.created",
  "doc.created",
  "doc.updated",
  "file.created",
  "skill.created",
  "drive.created",
  "airapp.created",
  "asset.deleted",
  "asset.metadata_updated",
  "asset.text_written",
  "asset.text_marked_none",
  "node.metadata_updated",
  "node.purged",
]);

const auditEventSchema = z.object({
  id: z.string(),
  action: auditActionSchema,
  actorId: z.string(),
  actor: userRefSchema.nullable().optional().default(null),
  baseId: z.string().nullable(),
  recordId: z.string().nullable(),
  changeRequestId: z.string().nullable(),
  operationId: z.string().nullable(),
  commitId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

const createAuditEventInputSchema = z.object({
  action: auditActionSchema,
  actorId: z.string().optional().default("local-viewer"),
  baseId: z.string().optional().nullable(),
  recordId: z.string().optional().nullable(),
  changeRequestId: z.string().optional().nullable(),
  operationId: z.string().optional().nullable(),
  commitId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

const nodeOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    ref: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional in-change-request temp id for this node. A later operation can set parentNodeRef to this value to nest under it — e.g. create a folder with ref "growth", then create Bases with parentNodeRef "growth", all in one change request.',
      ),
    parentNodeId: z.string().optional(),
    parentNodeRef: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Parent this node under a node an EARLIER operation in the same change request created (matched by its ref). Mutually exclusive with parentNodeId.",
      ),
    nodeType: z.enum(CREATABLE_NODE_TYPES),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().optional().default(""),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    // Base fields (nodeType "base" only); a base needs at least one field.
    fields: z
      .array(
        z.object({
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/),
          name: fieldNameSchema,
          type: fieldTypeSchema.default("text"),
          required: z.boolean().optional().default(false),
          options: fieldOptionsSchema.optional().default({}),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("rename"),
    nodeId: z.string(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal("delete"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("restore"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("move"),
    nodeId: z.string(),
    // Exactly one of parentNodeId / parentNodeRef (a ref created earlier in this CR).
    parentNodeId: z.string().optional(),
    parentNodeRef: z.string().min(1).optional(),
    position: z.number().int().optional(),
  }),
]);

const createNodeChangeRequestInputSchema = z.object({
  message: z
    .string()
    .optional()
    .default("Update node tree")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Reorganize marketing docs under a Campaigns folder".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  autoMerge: z
    .boolean()
    .optional()
    .describe(
      "Whether to approve and merge this structural node change immediately. Omitted defaults to merging immediately if the actor has write access on every target node, otherwise falling back to a pending Change Request; pass explicit false to force review even with write access.",
    ),
  operations: z.array(nodeOperationInputSchema).min(1),
});

const moveNodeInputSchema = z.object({
  nodeId: z.string(),
  parentNodeId: z
    .string()
    .optional()
    .describe("New parent folder node id. Omit to keep the current parent and only reorder."),
  position: z
    .number()
    .int()
    .optional()
    .describe("New position among the target parent's children."),
  message: z.string().optional().describe("Reviewer-facing Change Request message."),
  submittedBy: z.string().optional(),
});

const createDeleteChangeRequestInputSchema = z.object({
  message: z
    .string()
    .optional()
    .default("Delete record")
    .describe(
      'Explanation shown to the human reviewer. Say what is being removed and why, e.g. "Archive duplicate contact — merged into Acme Corp".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  // Only "archive" is supported — hard delete after retention was never
  // implemented, so the API no longer accepts it (breaking change).
  deleteMode: z.enum(["archive"]).optional().default("archive"),
  autoMerge: autoMergeNotAccepted(
    "archiving a record removes user content from every listing, so it always requires review. Omit the flag.",
  ),
});

const reviseOperationInputSchema = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .describe(
      "Updated field values keyed by field slug. If you set the base's PRIMARY field (its first field), keep it a short human-readable name — it is the record's display title everywhere.",
    ),
  message: z
    .string()
    .optional()
    .default("Revise operation")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Update deal stage to qualified — demo booked for July 8".',
    ),
  author: z.string().optional().default("local-producer"),
  baseCommitId: z.string().optional(),
});

const reviewChangeRequestInputSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

const commentSubjectInputSchema = z.object({
  subjectType: commentSubjectTypeSchema,
  subjectId: z.string().min(1),
});

const createCommentInputSchema = commentSubjectInputSchema.extend({
  authorId: z.string().optional().default("local-admin"),
  body: z.string().trim().min(1),
  mentionsAi: z.boolean().optional().default(false),
});

const listInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .optional()
  .default({ limit: 50 });

/**
 * Active-or-archived selector for listings whose archived twin was folded in.
 * Archived rows are the same shape as live ones — the only thing that ever
 * differed between `/x` and `/x/archived` was this predicate.
 */
const listByStatusInputSchema = z.object({
  status: z.enum(["active", "archived"]).optional().default("active"),
});

// Keyset-paginated change request listing. `status` narrows to specific
// statuses (e.g. the inbox "rejected" tab passes ["rejected","abandoned"]);
// `mine` narrows to change requests submitted by the acting user (the
// "created" tab). Both are resolved server-side against the request context.
const listChangeRequestsPagedInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    /** Opaque base64 cursor (`createdAt|id`) for keyset pagination. */
    cursor: z.string().optional(),
    status: z.array(changeRequestStatusSchema).optional(),
    mine: z.boolean().optional(),
  })
  .optional()
  .default({ limit: 50 });

const listChangeRequestsResponseSchema = z.object({
  changeRequests: z.array(changeRequestSchema),
  nextCursor: z.string().nullable(),
});

// Random-access (numbered) change request paging, mirroring records.listPage.
// The inbox uses this so a reviewer can jump to a page of a 2,000-change-request
// tab instead of clicking "load more" until they get there; the same filters as
// the keyset listing apply.
const listChangeRequestsPageInputSchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
    status: z.array(changeRequestStatusSchema).optional(),
    mine: z.boolean().optional(),
  })
  .optional()
  .default({ page: 1, pageSize: 50 });

const listChangeRequestsPageResponseSchema = z.object({
  changeRequests: z.array(changeRequestSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

// Server-side inbox tab counts. Computed over the whole space (not a capped
// page) so the tab badges are correct regardless of how many change requests
// exist. `created` is scoped to the acting user.
const changeRequestCountsSchema = z.object({
  review: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});

const SEARCH_SOURCES = ["records", "files", "names"] as const;

const searchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  /**
   * Restrict which content this call searches. Omitted means all three
   * (unchanged behavior for every caller before this parameter existed).
   *
   * A GET query param that occurs exactly once (`?sources=records`) arrives
   * as a bare string, not a 1-element array — only a REPEATED occurrence
   * (`?sources=records&sources=files`) becomes an array. Accept both shapes
   * and normalize to an array.
   */
  sources: z
    .union([z.array(z.enum(SEARCH_SOURCES)), z.enum(SEARCH_SOURCES)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
});

// ── Auth verification (GET /auth) ───────────────────────────────────────────
// The active space / acting user / membership behind a request. In the
// open-source single-tenant app these are the local defaults; the cloud host
// resolves the real space/user/member off the verified user API key (it
// overrides the handler, but reuses this exact VO so the shape is identical).
const authSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  plan: z.string().nullable(),
  /**
   * The space's DEFAULT content visibility for its members — the same
   * `spaces.nodeVisibilityMode` the cloud dashboard reads. `"open"` = a node
   * with no explicit visibility anywhere in its ancestor chain is visible to
   * every member; `"restricted"` = such a node is hidden from non-managers
   * until it is explicitly opened (per-node visibility or a grant).
   *
   * Clients need it to describe a node's EFFECTIVE access truthfully ("everyone
   * in this space can see this" is a lie in a restricted space) and to decide
   * whether per-node grants are meaningful to show at all.
   *
   * OPTIONAL on purpose: it was added after this VO shipped, so an older server
   * (or a host that doesn't model a space default at all) simply omits it.
   * Treat an absent value as `"open"` — the historical behaviour.
   */
  nodeVisibilityMode: z.enum(["open", "restricted"]).optional(),
});

const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  image: z.string().nullable(),
});

const authMemberSchema = z.object({
  userId: z.string(),
  spaceId: z.string(),
  role: z.string(),
});

const authInfoSchema = z.object({
  /** The space this request is scoped to (explicit `x-busabase-space` header, else the default). */
  space: authSpaceSchema,
  user: authUserSchema,
  member: authMemberSchema,
  /**
   * Every space the authenticated user belongs to. An API key is user-scoped, not
   * space-scoped — when this has more than one entry, callers should confirm the
   * intended space and target it explicitly via the `x-busabase-space` header.
   */
  spaces: z.array(authSpaceSchema),
  /** Cloud only: the server created this user's first Space during this exact request. */
  createdSpace: z.boolean().optional(),
  /** Cloud only: this auto-created Space still needs its idempotent starter initialization. */
  bootstrapRequired: z.boolean().optional(),
});

export type AuthInfo = z.infer<typeof authInfoSchema>;

export {
  authSpaceSchema,
  authUserSchema,
  authMemberSchema,
  authInfoSchema,
  userRefSchema,
  nodeSchema,
  nodePrincipalSchema,
  nodeShareSchema,
  listNodesInputSchema,
  isDescendantInputSchema,
  isDescendantOutputSchema,
  updateNodeMetadataInputSchema,
  searchNodesByNameInputSchema,
  nodeSearchResultSchema,
  commitSchema,
  operationSchema,
  reviewSchema,
  commentSubjectTypeSchema,
  commentSchema,
  changeRequestStatusSchema,
  changeRequestSchema,
  changeRequestCountsSchema,
  agentTaskSchema,
  searchResultSchema,
  searchResponseSchema,
  liveEventSchema,
  auditActionSchema,
  auditEventSchema,
  createAuditEventInputSchema,
  nodeOperationInputSchema,
  createNodeChangeRequestInputSchema,
  moveNodeInputSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
  reviewChangeRequestInputSchema,
  commentSubjectInputSchema,
  createCommentInputSchema,
  listInputSchema,
  listByStatusInputSchema,
  listChangeRequestsPagedInputSchema,
  listChangeRequestsResponseSchema,
  listChangeRequestsPageInputSchema,
  listChangeRequestsPageResponseSchema,
  searchInputSchema,
};
