// Drizzle table owned by the assets domain — the Drive Grep Retrieval "text
// slot" for an Asset. Postgres keeps only the pointer (storage key), the
// content hash used both for storage addressing and local-cache keying, and a
// small line-checkpoint index; the actual text bytes always live in object
// storage (never in this table). See
// `apps/busabase/content/spec/drive-grep-retrieval.md` for the full design.
//
// 0..1 row per Asset. Text-kind assets (CSV/log/md/json/…) get a row that
// points at their OWN attachment bytes (`writtenBy: "auto"`, no bytes
// copied). Binary assets (PDF/docx/…) get their text from an external writer
// via `putText`, which stores a content-addressed copy under
// `asset-texts/blobs/sha256/{2ch}/{hash}.txt` and flips `writtenBy` to the
// actor id that supplied it (derived text, subject to staleness tracking).
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busabaseAssets } from "../../../db/schema";
import { spaceIdColumn } from "../../../db/space-column";

export type AssetTextStatus = "present" | "none" | "stale";

/** One `(line, byteOffset)` pair — a lazily/adaptively computed slicing checkpoint for `readLines`. */
export interface AssetTextCheckpoint {
  line: number;
  byteOffset: number;
}

export const busabaseAssetTexts = pgTable(
  "busabase_asset_texts",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    assetId: text("asset_id")
      .notNull()
      .references(() => busabaseAssets.id, { onDelete: "cascade" }),
    status: text("status").$type<AssetTextStatus>().notNull().default("present"),
    // `asset-texts/blobs/sha256/{2ch}/{textHash}.txt` for derived text, OR the
    // owning attachment's own `storageKey` for auto-registered text-kind assets
    // (no bytes copied — the row just points at the original object).
    textStorageKey: text("text_storage_key").notNull(),
    // Hash of the TEXT bytes — storage addressing key + local-cache key. Null
    // only for auto-registered rows whose text IS the (unhashed-at-write-time)
    // original object; computed lazily the first time it's needed.
    textContentHash: text("text_content_hash"),
    // Hash of the SOURCE bytes (the asset's attachment) this text was derived
    // from — compared against the asset's current attachment hash to detect
    // staleness after a repoint. Null for auto-registered rows (staleness does
    // not apply to them — they auto-re-register on repoint instead).
    sourceContentHash: text("source_content_hash"),
    // "auto" for auto-registered text-kind rows; an actor id for everything a
    // writer (agent/hook) supplied via `putText` — audit trail of who wrote it.
    writtenBy: text("written_by").notNull().default("auto"),
    // `bigint(..., { mode: "number" })`, NOT `integer` — a plain Postgres
    // `integer` maxes out at ~2.15 GB, which a single large CSV/log upload
    // can legitimately exceed (see the spec's "5 GB CSV" failure-scenario
    // row). `mode: "number"` keeps these as ordinary JS numbers everywhere
    // they're read (safe up to 2^53, far beyond any realistic file size) —
    // no BigInt handling needed elsewhere in the codebase.
    lineCount: bigint("line_count", { mode: "number" }).notNull().default(0),
    charCount: bigint("char_count", { mode: "number" }).notNull().default(0),
    byteCount: bigint("byte_count", { mode: "number" }).notNull().default(0),
    // Adaptive (line, byteOffset) pairs — every 1000 lines OR 4 MB, whichever
    // comes first. Empty until computed (lazily, on first `readLines`, or
    // eagerly for a small inline `putText`). Only serves `readLines`; grep
    // streams the whole object regardless.
    lineCheckpoints: jsonb("line_checkpoints").$type<AssetTextCheckpoint[]>().notNull().default([]),
    // Set the moment `lineCount`/`charCount`/`byteCount`/`lineCheckpoints` were
    // last actually computed from the object's real bytes (derived rows: at
    // `putText` write time; auto rows: lazily, the first time `readLines`
    // triggers `computeAndPersistCheckpoints`). Null means "never scanned yet"
    // (auto rows start this way — 0/0/0 sentinel stats). This is the direct
    // signal `readLines` uses to decide whether to (re)scan — NOT an inferred
    // side lookup (e.g. comparing byteCount against a joined attachment row),
    // which can silently and permanently stop matching after a dedupe/repoint
    // and cause every read to needlessly rescan the whole object.
    statsComputedAt: timestamp("stats_computed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (assetText) => [
    uniqueIndex("busabase_asset_texts_asset_uniq").on(assetText.assetId),
    index("busabase_asset_texts_space_status_idx").on(assetText.spaceId, assetText.status),
    index("busabase_asset_texts_content_hash_idx").on(assetText.textContentHash),
  ],
);

export type AssetTextPO = typeof busabaseAssetTexts.$inferSelect;
