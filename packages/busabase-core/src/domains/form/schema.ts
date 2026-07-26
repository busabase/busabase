// Drizzle table owned by the form domain. A form is a node bound to a target
// Base; a submission produces an approval-first record-create ChangeRequest on
// that Base (see apps/busabase/content/spec/form-as-node.md). FK refs use lazy
// `() =>` thunks so the import cycle with ../../db/schema resolves at runtime.
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { busabaseNodes } from "../../db/schema";
import { spaceIdColumn } from "../../db/space-column";
import { busabaseBases } from "../base/schema";

export const busabaseForms = pgTable(
  "busabase_forms",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    targetBaseId: text("target_base_id")
      .notNull()
      .references(() => busabaseBases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Per-form field-binding contract: inputName → fieldSlug (+ per-form overrides).
    bindings: jsonb("bindings")
      .$type<
        Array<{
          inputName: string;
          fieldSlug: string;
          required?: boolean;
          label?: string;
          help?: string;
        }>
      >()
      .notNull()
      .default([]),
    // Agent-authored page: one HTML document (styles/scripts inline) + theme
    // tokens. jsonb, so the shape can evolve without a migration.
    page: jsonb("page")
      .$type<{
        code?: string;
        theme?: {
          logoUrl?: string;
          coverUrl?: string;
          brandColor?: string;
          hideBranding?: boolean;
        };
      }>()
      .notNull()
      .default({}),
    // Public/anonymous settings (no shareToken — endpoint gates on these).
    share: jsonb("share")
      .$type<{
        isPublic: boolean;
        anonymousSubmit: boolean;
        submitLimit?: number;
        requireCaptcha?: boolean;
      }>()
      .notNull()
      .default({ isPublic: false, anonymousSubmit: false }),
    // Monotonic count of accepted submissions — backs the server-side
    // `share.submitLimit` enforcement (APITable only checked this client-side).
    submissionCount: integer("submission_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by").notNull(),
    archivedAt: timestamp("archived_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (form) => [
    index("busabase_forms_node_idx").on(form.nodeId),
    index("busabase_forms_target_base_idx").on(form.targetBaseId),
    index("busabase_forms_space_status_idx").on(form.spaceId, form.status),
  ],
);

export type FormPO = typeof busabaseForms.$inferSelect;
export type FormInsertPO = typeof busabaseForms.$inferInsert;
