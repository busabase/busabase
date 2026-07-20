import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// Base-domain tables are referenced by the kernel CR tables (lazy FK thunks); the
// import cycle with ../domains/base/schema resolves at runtime via live bindings.
import { busabaseBases, busabaseRecords, busabaseViews } from "../domains/base/schema";
import { spaceIdColumn } from "./space-column";

// Node type union is owned by the node-type registry (single source of truth).
export type { NodeType as BusabaseNodeType } from "busabase-contract/domains";

import type { NodeType as BusabaseNodeType } from "busabase-contract/domains";
export type BusabaseChangeRequestTargetType = "base" | "node";

export const busabaseOperationKindEnum = pgEnum("busabase_operation_kind", [
  "record_create",
  "record_update",
  "record_delete",
  "record_variant",
  "view_create",
  "view_update",
  "view_delete",
  "view_restore",
  "node_create",
  "node_rename",
  "node_delete",
  "node_restore",
  "node_move",
  "skill_file_create",
  "skill_file_update",
  "skill_file_delete",
  "skill_metadata_update",
  "drive_file_create",
  "drive_file_update",
  "drive_file_delete",
  "drive_metadata_update",
  "airapp_file_create",
  "airapp_file_update",
  "airapp_file_delete",
  "airapp_metadata_update",
  "doc_update",
  "base_add_field",
  "base_delete_field",
  "base_update_field",
  "base_convert_field",
  "base_reorder_fields",
  "base_restore_field",
  "base_archive",
  "base_restore",
  "record_restore",
]);
export const busabaseChangeRequestStatusEnum = pgEnum("busabase_change_request_status", [
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "merged",
  "abandoned",
  "conflict",
]);
export const busabaseReviewVerdictEnum = pgEnum("busabase_review_verdict", [
  "approved",
  "rejected",
]);
export const busabaseCommentSubjectEnum = pgEnum("busabase_comment_subject", [
  "record",
  "change_request",
  "operation",
  "commit",
]);

export const busabaseNodes = pgTable(
  "busabase_nodes",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    parentId: text("parent_id").references((): AnyPgColumn => busabaseNodes.id, {
      onDelete: "cascade",
    }),
    type: text("type").$type<BusabaseNodeType>().notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    metadata: jsonb("metadata")
      .$type<
        Record<string, unknown> & {
          entryFile?: string;
          visibility?: "private" | "workspace" | "public";
          version?: string;
          assetId?: string;
          attachmentId?: string;
          fileName?: string;
          mimeType?: string;
          size?: number;
          contentHash?: string | null;
        }
      >()
      .notNull()
      .default({}),
    position: integer("position").notNull().default(0),
    // Materialized access-control visibility: the STRICTEST explicitly-set
    // `metadata.visibility` along this node's ancestor chain (self included),
    // private > workspace > public. NULL = nothing explicit anywhere in the
    // chain = "follow the space default" (open mode: visible to members;
    // restricted mode: hidden like private). Recomputed on create / move /
    // visibility change by `recomputeEffectiveVisibility` (logic/node-acl.ts)
    // — read paths only ever check this column, never walk the tree. Kept as a
    // real column (not in the metadata jsonb) so the visibility index below is
    // a plain btree, not a jsonb expression index.
    effectiveVisibility: text("effective_visibility").$type<"private" | "workspace" | "public">(),
    // Soft-archive marker. Set when the owning base is archived (base nodes are
    // kept, not deleted, since commits FK-restrict the base). Partial slug index
    // below frees the slug for reuse while archived.
    archivedAt: timestamp("archived_at", { mode: "date" }),
    // Permanent-delete marker ("Trash → Delete forever"). Only ever set once the
    // row is already archived, and never cleared — the row (and its history) is
    // kept forever, just hidden from every list/tree/search query. This makes
    // "purge" a soft, reversible-at-the-data-level operation for ALL node types
    // (including Base, sidestepping the commits FK-restrict that blocks a hard
    // delete) instead of a real `db.delete()`.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_nodes_parent_slug_uniq")
      .on(base.parentId, base.slug)
      .where(sql`${base.archivedAt} IS NULL`),
    index("busabase_nodes_parent_position_idx").on(base.parentId, base.position),
    index("busabase_nodes_effective_visibility_idx").on(base.spaceId, base.effectiveVisibility),
  ],
);

/**
 * Node-level access grants — "who can do what on this node" (any node type:
 * folder/base/doc/drive/skill/airapp/file). Modeled on buda-core's
 * `node_principals` (agents), adapted to busabase's tree.
 *
 * `role` reuses the existing `ApiKeyPermissionLevel` ladder
 * (`read < changeRequest < write < manage`, busabase-contract
 * access-control/api-key-level) instead of inventing a second
 * owner/editor/viewer vocabulary — "how far can this identity go on this
 * node" is the same question the API-key levels already answer, and
 * `hasApiKeyLevel` is reused as the comparison.
 *
 * `principalId` is an OPAQUE string (a user id, or the space id for
 * `principalType: "space"` = "everyone in this space") — deliberately NOT a
 * foreign key into any auth schema, preserving busabase-core's documented
 * auth-agnostic rule (same precedent as buda-core's node_principals).
 * `"team"` is accepted by the type for forward-compat but has no resolution
 * logic or UI in v1 (busabase-cloud has no team infrastructure yet).
 *
 * A space owner/admin (`isSpaceManager` in BusabaseContext, host-injected)
 * always short-circuits to `manage` — no principal row needed.
 *
 * Grants INHERIT down the tree by materialization, mirroring the
 * `effectiveVisibility` column's write-time philosophy: a grant defined on a
 * folder is copied to every descendant node as extra rows with
 * `sourceNodeId` = the folder (a DIRECT grant has `sourceNodeId === nodeId`).
 * `recomputeSpaceNodeAcl` (logic/node-acl.ts) rebuilds the inherited rows on
 * node create / move / grant change, so every read stays a single
 * per-node EXISTS — no recursive ancestor walk on the hot path. Removing the
 * source grant removes the whole inherited set (`sourceNodeId` match).
 */
export const busabaseNodePrincipals = pgTable(
  "busabase_node_principals",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    // The node this grant was DEFINED on: equal to nodeId for a direct grant,
    // an ancestor's id for a materialized inherited copy.
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    principalType: text("principal_type").$type<"user" | "team" | "space">().notNull(),
    principalId: text("principal_id").notNull(),
    role: text("role").$type<"read" | "changeRequest" | "write" | "manage">().notNull(),
    grantedBy: text("granted_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_node_principals_node_principal_source_uniq").on(
      base.nodeId,
      base.principalType,
      base.principalId,
      base.sourceNodeId,
    ),
    index("busabase_node_principals_node_idx").on(base.nodeId),
    index("busabase_node_principals_principal_idx").on(base.principalType, base.principalId),
  ],
);

/**
 * Per-actor node favorites (Notion-style "⭐ Favorites") — modeled on
 * `apps/mcpsdk/src/db/schema/favorites.ts`'s `(packageId, createdBy)`
 * composite-unique pattern, adapted to `(nodeId, actorId)` plus this schema's
 * existing `spaceIdColumn()` tenant convention. A row is purely additive
 * (never moves/hides the node from its real tree position); read paths join
 * back to `busabaseNodes` and apply the same archived/deleted/visibility
 * filtering the tree already uses, so a favorited node that's later archived,
 * purged, or (cloud) hidden from this actor silently drops out of the list
 * without ever deleting this row (the grant/visibility might come back).
 */
export const busabaseFavorites = pgTable(
  "busabase_favorites",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_favorites_node_actor_uniq").on(base.nodeId, base.actorId),
    index("busabase_favorites_actor_idx").on(base.actorId),
  ],
);

export const busabaseCommits = pgTable(
  "busabase_commits",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id").references(() => busabaseBases.id, { onDelete: "restrict" }),
    targetType: text("target_type")
      .$type<BusabaseChangeRequestTargetType>()
      .notNull()
      .default("base"),
    nodeId: text("node_id").references(() => busabaseNodes.id, { onDelete: "cascade" }),
    operationId: text("operation_id"),
    parentCommitId: text("parent_commit_id"),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
    operation: busabaseOperationKindEnum("operation").notNull().default("record_create"),
    message: text("message").notNull().default(""),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_commits_base_created_idx").on(base.baseId, base.createdAt),
    index("busabase_commits_node_created_idx").on(base.nodeId, base.createdAt),
    index("busabase_commits_operation_idx").on(base.operationId),
    index("busabase_commits_created_idx").on(base.createdAt),
  ],
);

export const busabaseChangeRequests = pgTable(
  "busabase_change_requests",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id").references(() => busabaseBases.id, { onDelete: "cascade" }),
    targetType: text("target_type")
      .$type<BusabaseChangeRequestTargetType>()
      .notNull()
      .default("base"),
    nodeId: text("node_id").references(() => busabaseNodes.id, { onDelete: "cascade" }),
    status: busabaseChangeRequestStatusEnum("status").notNull().default("in_review"),
    submittedBy: text("submitted_by").notNull(),
    sourceMeta: jsonb("source_meta").$type<Record<string, unknown>>().notNull().default({}),
    reviewPolicySnapshot: jsonb("review_policy_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    mergeSummary: jsonb("merge_summary").$type<Record<string, unknown>>().notNull().default({}),
    rejectedReason: text("rejected_reason"),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    mergedAt: timestamp("merged_at", { mode: "date" }),
    // Optional client-supplied dedup key for createChangeRequest/createBulkChangeRequest
    // retries (e.g. after a timeout, or a false-500 the caller can't tell apart from a
    // real failure). Scoped by (baseId, submittedBy) via the partial unique index below —
    // NULL (the common case, no idempotency key supplied) is unconstrained.
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_change_requests_base_created_idx").on(base.baseId, base.createdAt),
    index("busabase_change_requests_node_created_idx").on(base.nodeId, base.createdAt),
    index("busabase_change_requests_status_created_idx").on(base.status, base.createdAt),
    uniqueIndex("busabase_change_requests_idempotency_uniq")
      .on(base.baseId, base.submittedBy, base.idempotencyKey)
      .where(sql`${base.idempotencyKey} IS NOT NULL`),
  ],
);

export const busabaseOperations = pgTable(
  "busabase_operations",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    changeRequestId: text("change_request_id")
      .notNull()
      .references(() => busabaseChangeRequests.id, { onDelete: "cascade" }),
    baseId: text("base_id").references(() => busabaseBases.id, { onDelete: "cascade" }),
    targetType: text("target_type")
      .$type<BusabaseChangeRequestTargetType>()
      .notNull()
      .default("base"),
    nodeId: text("node_id").references(() => busabaseNodes.id, { onDelete: "cascade" }),
    operation: busabaseOperationKindEnum("operation").notNull(),
    status: text("status").notNull().default("pending"),
    targetRecordId: text("target_record_id"),
    targetViewId: text("target_view_id").references(() => busabaseViews.id, {
      onDelete: "set null",
    }),
    filePath: text("file_path"),
    sourceRecordId: text("source_record_id"),
    sourceCommitId: text("source_commit_id"),
    baseCommitId: text("base_commit_id"),
    headCommitId: text("head_commit_id")
      .notNull()
      .references(() => busabaseCommits.id, { onDelete: "restrict" }),
    deleteMode: text("delete_mode").notNull().default("archive"),
    mergedRecordId: text("merged_record_id"),
    mergedViewId: text("merged_view_id").references(() => busabaseViews.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_operations_change_request_position_idx").on(
      base.changeRequestId,
      base.position,
    ),
    index("busabase_operations_node_file_idx").on(base.nodeId, base.filePath),
    index("busabase_operations_target_record_idx").on(base.targetRecordId),
    index("busabase_operations_target_view_idx").on(base.targetViewId),
    index("busabase_operations_head_commit_idx").on(base.headCommitId),
  ],
);

export const busabaseComments = pgTable(
  "busabase_comments",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    subjectType: busabaseCommentSubjectEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    recordId: text("record_id").references(() => busabaseRecords.id, { onDelete: "cascade" }),
    changeRequestId: text("change_request_id").references(() => busabaseChangeRequests.id, {
      onDelete: "cascade",
    }),
    operationId: text("operation_id").references(() => busabaseOperations.id, {
      onDelete: "cascade",
    }),
    commitId: text("commit_id").references(() => busabaseCommits.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    mentionsAi: boolean("mentions_ai").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_comments_subject_created_idx").on(
      base.subjectType,
      base.subjectId,
      base.createdAt,
    ),
    index("busabase_comments_record_created_idx").on(base.recordId, base.createdAt),
    index("busabase_comments_change_request_created_idx").on(base.changeRequestId, base.createdAt),
    index("busabase_comments_operation_created_idx").on(base.operationId, base.createdAt),
    index("busabase_comments_commit_created_idx").on(base.commitId, base.createdAt),
  ],
);

export const busabaseReviews = pgTable(
  "busabase_reviews",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    changeRequestId: text("change_request_id")
      .notNull()
      .references(() => busabaseChangeRequests.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id").notNull(),
    verdict: busabaseReviewVerdictEnum("verdict").notNull(),
    reason: text("reason"),
    visibleOperationHeads: jsonb("visible_operation_heads")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_reviews_one_vote_per_change_request").on(
      base.changeRequestId,
      base.reviewerId,
    ),
    index("busabase_reviews_change_request_created_idx").on(base.changeRequestId, base.createdAt),
  ],
);

export const busabaseAuditEvents = pgTable(
  "busabase_audit_events",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    baseId: text("base_id").references(() => busabaseBases.id, { onDelete: "set null" }),
    recordId: text("record_id").references(() => busabaseRecords.id, { onDelete: "set null" }),
    changeRequestId: text("change_request_id").references(() => busabaseChangeRequests.id, {
      onDelete: "set null",
    }),
    operationId: text("operation_id").references(() => busabaseOperations.id, {
      onDelete: "set null",
    }),
    commitId: text("commit_id").references(() => busabaseCommits.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_audit_events_action_created_idx").on(base.action, base.createdAt),
    index("busabase_audit_events_record_created_idx").on(base.recordId, base.createdAt),
    index("busabase_audit_events_base_created_idx").on(base.baseId, base.createdAt),
  ],
);

export type NodePO = typeof busabaseNodes.$inferSelect;
export type NodePrincipalPO = typeof busabaseNodePrincipals.$inferSelect;
export type FavoritePO = typeof busabaseFavorites.$inferSelect;
export type CommentPO = typeof busabaseComments.$inferSelect;
export type CommitPO = typeof busabaseCommits.$inferSelect;
export type ChangeRequestPO = typeof busabaseChangeRequests.$inferSelect;
export type OperationPO = typeof busabaseOperations.$inferSelect;
export type ReviewPO = typeof busabaseReviews.$inferSelect;
export type AuditEventPO = typeof busabaseAuditEvents.$inferSelect;

// Attachments table — shared, auth-agnostic (lives in open-domains; consumed by
// both apps/busabase and apps/busabase-cloud).
export * from "open-domains/attachments/schema";
// Assets domain: Drive Grep Retrieval text slot (0..1 row per Asset).
export * from "../domains/assets/schema/asset-texts";
// Assets domain: the deduped Asset library + its where-used reverse index.
export * from "../domains/assets/schema/assets";
// Base-domain tables, enum, and PO types live in the base domain; re-exported
// here so the db barrel stays the one import surface. Kernel CR tables FK into
// these via lazy refs (the import cycle resolves at runtime).
export * from "../domains/base/schema";
// Vault-managed secrets and variables used by agents, MCP, and API tools.
export * from "../domains/vault/schema/vault-items";
export * from "../domains/webhook/schema/webhook-deliveries";
// Webhook automation: configurable rules (HTTP webhook / notify-agent /
// sandboxed function) dispatched on Busabase events, plus their delivery log.
export * from "../domains/webhook/schema/webhook-rules";
