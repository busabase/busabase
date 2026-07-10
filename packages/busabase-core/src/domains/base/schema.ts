// Drizzle tables owned by the base domain (structured records + views). They FK
// into the kernel tables (busabaseNodes / busabaseCommits / change-requests / operations);
// those refs are lazy `() =>` thunks, so the cross-module import cycle with
// ../../db/schema resolves safely at runtime.
import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
} from "../../db/schema";
import { spaceIdColumn } from "../../db/space-column";

export const busabaseFieldTypeEnum = pgEnum("busabase_field_type", [
  "text",
  "longtext",
  "markdown",
  "html",
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "embed",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  "ai_summary",
  "ai_tags",
  "code",
  "json",
  "yaml",
]);

export const busabaseBases = pgTable(
  "busabase_bases",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    reviewPolicy: jsonb("review_policy")
      .$type<{ kind: "single"; requiredApprovals: number }>()
      .notNull()
      .default({ kind: "single", requiredApprovals: 1 }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    // Permanent-delete marker, kept in lockstep with the owning `busabase_nodes`
    // row's `deletedAt` (see purgeNode in logic/nodes.ts) so `bases.list` /
    // `bases.listArchived` can filter without joining the node table.
    deletedAt: timestamp("deleted_at", { mode: "date" }),
  },
  (base) => [
    uniqueIndex("busabase_bases_node_uniq").on(base.nodeId),
    // Slug uniqueness is per-space (two spaces may each have a "tasks" base).
    // Partial so an archived base frees its slug for reuse — the companion
    // busabase_nodes partial slug index frees the node slug in tandem.
    uniqueIndex("busabase_bases_space_slug_uniq")
      .on(base.spaceId, base.slug)
      .where(sql`${base.archivedAt} IS NULL`),
  ],
);

export const busabaseBaseFields = pgTable(
  "busabase_base_fields",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: busabaseFieldTypeEnum("type").notNull(),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    options: jsonb("options")
      .$type<{
        targetBaseId?: string;
        multiple?: boolean;
        inverseFieldId?: string;
        choices?: Array<{ id: string; name: string; color?: string }>;
        ai?: {
          sourceFieldIds?: string[];
          prompt?: string;
          model?: string;
          reviewRequired?: boolean;
        };
        embed?: {
          aspectRatio?: "16:9" | "4:3" | "1:1";
          height?: number;
          providers?: string[];
        };
      }>()
      .notNull()
      .default({}),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
  },
  (base) => [
    uniqueIndex("busabase_fields_base_slug_uniq")
      .on(base.baseId, base.slug)
      .where(sql`${base.deletedAt} IS NULL`),
  ],
);

export const busabaseViews = pgTable(
  "busabase_views",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    type: text("type").notNull().default("table"),
    config: jsonb("config")
      .$type<{
        filters?: Array<{
          fieldSlug: string;
          fieldId?: string;
          operator: "contains" | "equals" | "not_empty" | "is_empty" | "is_true" | "is_false";
          value?: unknown;
        }>;
        sorts?: Array<{ direction: "asc" | "desc"; fieldSlug: string; fieldId?: string }>;
        visibleFieldSlugs?: string[] | null;
      }>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_views_base_slug_uniq")
      .on(base.baseId, base.slug)
      .where(sql`${base.archivedAt} IS NULL`),
    index("busabase_views_base_status_position_idx").on(base.baseId, base.status, base.createdAt),
  ],
);

export const busabaseRecords = pgTable(
  "busabase_records",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    headCommitId: text("head_commit_id")
      .notNull()
      .references(() => busabaseCommits.id, { onDelete: "restrict" }),
    parentRecordId: text("parent_record_id"),
    parentCommitId: text("parent_commit_id"),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_records_base_created_idx").on(base.baseId, base.createdAt),
    index("busabase_records_status_created_idx").on(base.status, base.createdAt),
    index("busabase_records_head_commit_idx").on(base.headCommitId),
  ],
);

export const busabaseFieldValues = pgTable(
  "busabase_field_values",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    recordId: text("record_id").references(() => busabaseRecords.id, { onDelete: "cascade" }),
    changeRequestId: text("change_request_id").references(() => busabaseChangeRequests.id, {
      onDelete: "cascade",
    }),
    operationId: text("operation_id").references(() => busabaseOperations.id, {
      onDelete: "cascade",
    }),
    commitId: text("commit_id")
      .notNull()
      .references(() => busabaseCommits.id, { onDelete: "cascade" }),
    fieldId: text("field_id"),
    fieldSlug: text("field_slug").notNull(),
    fieldType: busabaseFieldTypeEnum("field_type").notNull(),
    valueText: text("value_text"),
    valueNumber: doublePrecision("value_number"),
    valueBool: boolean("value_bool"),
    valueDate: timestamp("value_date", { mode: "date" }),
    valueJson: jsonb("value_json").$type<unknown>(),
    valueHash: text("value_hash"),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    index("busabase_field_values_base_field_text_idx").on(
      base.baseId,
      base.fieldSlug,
      base.valueText,
    ),
    index("busabase_field_values_text_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${base.valueText}, ''))`,
    ),
    index("busabase_field_values_base_field_number_idx").on(
      base.baseId,
      base.fieldSlug,
      base.valueNumber,
    ),
    index("busabase_field_values_base_field_date_idx").on(
      base.baseId,
      base.fieldSlug,
      base.valueDate,
    ),
    index("busabase_field_values_record_idx").on(base.recordId),
    index("busabase_field_values_change_request_idx").on(base.changeRequestId),
    index("busabase_field_values_operation_idx").on(base.operationId),
    index("busabase_field_values_commit_idx").on(base.commitId),
  ],
);

export const busabaseRecordLinks = pgTable(
  "busabase_record_links",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    baseId: text("base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => busabaseBaseFields.id, { onDelete: "cascade" }),
    fieldSlug: text("field_slug").notNull(),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => busabaseRecords.id, { onDelete: "cascade" }),
    targetBaseId: text("target_base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    targetRecordId: text("target_record_id")
      .notNull()
      .references(() => busabaseRecords.id, { onDelete: "cascade" }),
    commitId: text("commit_id")
      .notNull()
      .references(() => busabaseCommits.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (base) => [
    uniqueIndex("busabase_record_links_source_field_target_uniq").on(
      base.sourceRecordId,
      base.fieldId,
      base.targetRecordId,
    ),
    index("busabase_record_links_source_field_idx").on(base.sourceRecordId, base.fieldId),
    index("busabase_record_links_target_idx").on(base.targetRecordId),
    index("busabase_record_links_base_field_idx").on(base.baseId, base.fieldSlug),
  ],
);

export type BasePO = typeof busabaseBases.$inferSelect;
export type BaseFieldPO = typeof busabaseBaseFields.$inferSelect;
export type ViewPO = typeof busabaseViews.$inferSelect;
export type RecordPO = typeof busabaseRecords.$inferSelect;
export type RecordLinkPO = typeof busabaseRecordLinks.$inferSelect;
export type FieldValuePO = typeof busabaseFieldValues.$inferSelect;
