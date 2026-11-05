// A rebuildable search projection. Canonical text remains in object storage;
// grep/readLines continue to read it in full, independently of this index.
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";
import { busabaseAssets } from "./assets";

export const busabaseAssetTextSearch = pgTable(
  "busabase_asset_text_search",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => busabaseAssets.id, { onDelete: "cascade" }),
    spaceId: spaceIdColumn(),
    // Only the projection of the CURRENT present text slot can be searched.
    textStorageKey: text("text_storage_key").notNull(),
    complete: boolean("complete").notNull(),
    indexedAt: timestamp("indexed_at", { mode: "date" }).defaultNow().notNull(),
  },
  (row) => [index("busabase_asset_text_search_space_idx").on(row.spaceId)],
);

export const busabaseAssetTextSearchChunks = pgTable(
  "busabase_asset_text_search_chunks",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => busabaseAssetTextSearch.assetId, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    contentText: text("content_text").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.assetId, row.chunkIndex] }),
    // Literal substring search, including CJK; no tokenizer, no btree limit.
    index("busabase_asset_text_search_chunks_trgm_idx").using(
      "gin",
      sql`${row.contentText} gin_trgm_ops`,
    ),
  ],
);
