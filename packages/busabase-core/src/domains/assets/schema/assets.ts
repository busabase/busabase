// Drizzle tables owned by the assets domain (the deduped Asset library + its
// reverse "where-used" index). An Asset is the busabase-side logical handle for
// a physical file: it points at an `attachments` row (the deduped bytes, shared
// with busabase-cloud) and carries library metadata (name, space). Records/Docs
// reference the stable `assetId`; the underlying `attachmentId` can be repointed
// to "replace the file everywhere" without touching every reference.
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busabaseNodes } from "../../../db/schema";
import { spaceIdColumn } from "../../../db/space-column";

export const busabaseAssets = pgTable(
  "busabase_assets",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    // The deduped physical file (open-domains `attachments.id`). Loose text ref,
    // not an FK — `attachments` is the auth-agnostic shared table.
    attachmentId: text("attachment_id").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").notNull().default("local-producer"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (asset) => [
    index("busabase_assets_space_idx").on(asset.spaceId),
    // One asset per physical file per space — makes `ensureAsset` idempotent and
    // means a deduped re-upload maps back to the same library entry.
    uniqueIndex("busabase_assets_space_attachment_uniq").on(asset.spaceId, asset.attachmentId),
  ],
);

/**
 * Reverse "where-used" index: one row per place an asset is referenced. For a
 * Base record it carries `recordId` + `fieldSlug`; for a Doc body both are "".
 * Maintained at merge time (Base/Doc), and doubles as the reference count that
 * guards deletion of a deduped file.
 */
export const busabaseAssetUsages = pgTable(
  "busabase_asset_usages",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    assetId: text("asset_id")
      .notNull()
      .references(() => busabaseAssets.id, { onDelete: "cascade" }),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    // Empty string (not null) for "whole node" usages (e.g. a Doc body), so the
    // uniqueIndex below dedupes reliably (Postgres treats NULLs as distinct).
    recordId: text("record_id").notNull().default(""),
    fieldSlug: text("field_slug").notNull().default(""),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (usage) => [
    index("busabase_asset_usages_asset_idx").on(usage.assetId),
    index("busabase_asset_usages_node_idx").on(usage.nodeId),
    uniqueIndex("busabase_asset_usages_uniq").on(
      usage.assetId,
      usage.nodeId,
      usage.recordId,
      usage.fieldSlug,
    ),
  ],
);

export type AssetPO = typeof busabaseAssets.$inferSelect;
export type AssetUsagePO = typeof busabaseAssetUsages.$inferSelect;
