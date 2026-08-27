import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const busabaseEmbedLinks = pgTable(
  "busabase_embed_links",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    type: text("type").$type<"node" | "change-request" | "record-detail">().notNull(),
    typeId: text("type_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdByApiKeyId: text("created_by_api_key_id").notNull(),
    frameMode: text("frame_mode")
      .$type<"anywhere" | "origins" | "top-level-only">()
      .default("top-level-only")
      .notNull(),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().default([]).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("busabase_embed_links_secret_hash_uniq").on(table.secretHash),
    index("busabase_embed_links_space_target_idx").on(table.spaceId, table.type, table.typeId),
    index("busabase_embed_links_expires_at_idx").on(table.expiresAt),
  ],
);

export type EmbedLinkPO = typeof busabaseEmbedLinks.$inferSelect;
export type NewEmbedLinkPO = typeof busabaseEmbedLinks.$inferInsert;
