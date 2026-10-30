import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

export type StorageCleanupKind = "attachment" | "doc" | "folder" | "derived_text";
export type StorageCleanupState = "retained" | "pending" | "processing" | "completed";

/**
 * Durable object-key fence and cleanup outbox. No Asset/attachment foreign key:
 * a cleanup task must survive the transaction removing those records.
 * Once retired, a key is never reused, including after successful deletion.
 */
export const busabaseStorageCleanupJobs = pgTable(
  "busabase_storage_cleanup_jobs",
  {
    storageKey: text("storage_key").primaryKey(),
    spaceId: spaceIdColumn(),
    kind: text("kind").$type<StorageCleanupKind>().notNull().default("attachment"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    state: text("state").$type<StorageCleanupState>().notNull().default("retained"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date" }).defaultNow().notNull(),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { mode: "date" }),
    // An already-issued PUT may recreate a key after the first delete. A final
    // sweep after its signature lifetime closes that bounded upload window.
    finalSweepAt: timestamp("final_sweep_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (job) => [index("busabase_storage_cleanup_due_idx").on(job.state, job.nextAttemptAt)],
);

export type StorageCleanupJobPO = typeof busabaseStorageCleanupJobs.$inferSelect;
