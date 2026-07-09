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

export interface NodeOutput {
  id: string;
  parentId: string | null;
  type: NodeType;
  slug: string;
  name: string;
  description: string;
  metadata: {
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
}

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
      .default({}),
    position: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    baseId: z.string().nullable(),
    children: z.array(nodeSchema),
  }),
);

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
  ]),
  spaceId: z.string(),
  actorId: z.string(),
  changeRequestId: z.string(),
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
  "asset.deleted",
  "asset.metadata_updated",
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
    .default(false)
    .describe(
      "Whether to approve and merge this structural node change immediately. Defaults to false so node Change Request creation is review-first unless explicitly requested.",
    ),
  operations: z.array(nodeOperationInputSchema).min(1),
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

const searchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
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
});

export type AuthInfo = z.infer<typeof authInfoSchema>;

export {
  authSpaceSchema,
  authUserSchema,
  authMemberSchema,
  authInfoSchema,
  userRefSchema,
  nodeSchema,
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
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
  reviewChangeRequestInputSchema,
  commentSubjectInputSchema,
  createCommentInputSchema,
  listInputSchema,
  listChangeRequestsPagedInputSchema,
  listChangeRequestsResponseSchema,
  searchInputSchema,
};
