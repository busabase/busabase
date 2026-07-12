// Drizzle tables owned by the assets domain (the deduped Asset library + its
// reverse "where-used" index). An Asset is the busabase-side logical handle for
// a physical file: it points at an `attachments` row (the deduped bytes, shared
// with busabase-cloud) and carries library metadata (name, space). Records/Docs
// reference the stable `assetId`; the underlying `attachmentId` can be repointed
// to "replace the file everywhere" without touching every reference.
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busabaseNodes } from "../../../db/schema";
import { spaceIdColumn } from "../../../db/space-column";

export type AssetContentKind = "text" | "binary";
export type AssetUsageOwnerType = "drive" | "skill" | "airapp" | "base" | "doc" | "file_node";

export const busabaseAssets = pgTable(
  "busabase_assets",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    // The deduped physical file (open-domains `attachments.id`). Loose text ref,
    // not an FK — `attachments` is the auth-agnostic shared table.
    attachmentId: text("attachment_id").notNull(),
    name: text("name").notNull(),
    contentKind: text("content_kind").$type<AssetContentKind>().notNull().default("binary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull().default("local-producer"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (asset) => [
    index("busabase_assets_space_idx").on(asset.spaceId),
    index("busabase_assets_space_attachment_idx").on(asset.spaceId, asset.attachmentId),
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
    ownerType: text("owner_type").$type<AssetUsageOwnerType>().notNull().default("base"),
    nodeId: text("node_id")
      .notNull()
      .references(() => busabaseNodes.id, { onDelete: "cascade" }),
    path: text("path").notNull().default(""),
    // Empty string (not null) for "whole node" usages (e.g. a Doc body), so the
    // uniqueIndex below dedupes reliably (Postgres treats NULLs as distinct).
    recordId: text("record_id").notNull().default(""),
    fieldSlug: text("field_slug").notNull().default(""),
    blockId: text("block_id").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (usage) => [
    index("busabase_asset_usages_asset_idx").on(usage.assetId),
    index("busabase_asset_usages_node_idx").on(usage.nodeId),
    index("busabase_asset_usages_node_path_idx").on(usage.nodeId, usage.path),
    uniqueIndex("busabase_asset_usages_uniq").on(
      usage.ownerType,
      usage.assetId,
      usage.nodeId,
      usage.path,
      usage.recordId,
      usage.fieldSlug,
      usage.blockId,
    ),
  ],
);

export type AssetPO = typeof busabaseAssets.$inferSelect;
export type AssetUsagePO = typeof busabaseAssetUsages.$inferSelect;
