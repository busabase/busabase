/**
 * Attachments schema (open-domains) — auth-agnostic copy of
 * `share-domains/attachments`.
 *
 * Identical columns/indexes, but WITHOUT the `users`/`organizations` foreign
 * keys: `userId`/`spaceId` are plain text (apps write a real id, or a local
 * sentinel like "local" for single-tenant OSS apps). This lets open-source app
 * kernels (busabase-core, future buda-core) own the `attachments` table without
 * dragging in the enterprise auth schema. `apps/busabase-cloud` switches to this
 * table too (its migration just drops the two FK constraints).
 */

import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { generateNanoID } from "openlib/nanoid";

export const attachments = pgTable(
  "attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => generateNanoID("att", 16)),

    // storageKey: content-addressed `attachments/blobs/{sha256}.ext` when the
    // client hashed (store-once across tenants), else legacy
    // `attachments/{userId}/{context}/{nanoid}.ext`. NOT unique — content
    // addressing means many registry rows (across spaces) share one physical key.
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),

    // Content fingerprint (e.g. "sha256:<hex>") computed client-side before
    // upload. Enables dedup: a re-upload of identical bytes (within the same
    // space/owner scope) reuses the existing stored object instead of writing a
    // duplicate. Nullable — legacy rows and clients that don't hash leave it null.
    contentHash: varchar("content_hash", { length: 80 }),

    context: varchar("context", { length: 50 }).notNull().default("general"),
    // Ownership — plain text, NO foreign key (auth-agnostic).
    userId: text("user_id").notNull(),
    spaceId: text("space_id"),

    // Flexible JSON metadata — apps define their own shape.
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("attachments_user_id_idx").on(table.userId),
    index("attachments_space_id_idx").on(table.spaceId),
    index("attachments_context_idx").on(table.context),
    index("attachments_created_at_idx").on(table.createdAt),
    index("attachments_storage_key_idx").on(table.storageKey),
    index("attachments_content_hash_idx").on(table.contentHash),
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;
