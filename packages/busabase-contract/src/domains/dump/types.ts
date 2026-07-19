/**
 * Dump domain — VO/DTO Zod schemas (pure zod, no logic/db imports, client-safe).
 *
 * The dump domain exposes raw-row, cursor-paginated export and session-based,
 * ID-preserving import for a handful of "full fidelity" server backup/restore
 * tables. Row shapes are intentionally `z.record(z.unknown())` here (not typed
 * per-table PO schemas) — the contract only needs to move opaque JSON rows; the
 * logic/ layer on the server owns the real per-table column shape via Drizzle.
 */
import { z } from "zod";

/** Every table the dump domain can export/import raw rows for. Vault items and
 * webhook signing secrets are intentionally excluded — never dumped. */
export const DumpTableSchema = z.enum([
  "nodes",
  /** Node-level access grants (permissions). Not secret — restore must keep them
   * so a backed-up space's sharing/permission config survives a full restore. */
  "nodePrincipals",
  "bases",
  "baseFields",
  "views",
  "records",
  "fieldValues",
  "recordLinks",
  /** The physical bytes registry (open-domains/attachments) an Asset's `attachmentId` FKs into. */
  "attachments",
  "assets",
  "assetUsages",
  "assetTexts",
  "commits",
  "changeRequests",
  "operations",
  "comments",
  "reviews",
  "auditEvents",
]);
export type DumpTable = z.infer<typeof DumpTableSchema>;

/** Tables that only exist for `fidelity: "full"` archives (change-history). */
export const DUMP_HISTORY_TABLES: DumpTable[] = [
  "commits",
  "changeRequests",
  "operations",
  "comments",
  "reviews",
  "auditEvents",
];

export const ExportTablesInputSchema = z.object({
  table: DumpTableSchema,
  /** Opaque pagination cursor from a previous page's `nextCursor`; omit for the first page. */
  cursor: z.string().optional(),
  /** Page size, default 500, capped at 2000. */
  limit: z.number().int().positive().max(2000).optional().default(500),
});
export type ExportTablesInput = z.infer<typeof ExportTablesInputSchema>;

export const ExportTablesVOSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable(),
});
export type ExportTablesVO = z.infer<typeof ExportTablesVOSchema>;

export const ImportBeginVOSchema = z.object({
  sessionId: z.string(),
});
export type ImportBeginVO = z.infer<typeof ImportBeginVOSchema>;

/**
 * `docBodies` and `attachmentBlobs` are pseudo-tables: doc markdown and
 * attachment bytes live in object storage, not a DB row. `attachmentBlobs`
 * rows are `{ storageKey, mimeType, base64 }` — written directly via
 * `storage.uploadFileToKey`, one per unique `busabase_attachments.storageKey`
 * in the archive (content-addressed, so re-importing the same blob twice is
 * a harmless overwrite of identical bytes).
 */
export const ImportTablesInputSchema = z.object({
  sessionId: z.string(),
  table: z.union([DumpTableSchema, z.literal("docBodies"), z.literal("attachmentBlobs")]),
  rows: z.array(z.record(z.string(), z.unknown())),
});
export type ImportTablesInput = z.infer<typeof ImportTablesInputSchema>;

export const ImportTablesVOSchema = z.object({
  inserted: z.number().int().nonnegative(),
});
export type ImportTablesVO = z.infer<typeof ImportTablesVOSchema>;

export const ImportSessionInputSchema = z.object({
  sessionId: z.string(),
});
export type ImportSessionInput = z.infer<typeof ImportSessionInputSchema>;

export const ImportCommitVOSchema = z.object({
  ok: z.boolean(),
  warnings: z.array(z.string()),
});
export type ImportCommitVO = z.infer<typeof ImportCommitVOSchema>;

export const ImportAbortVOSchema = z.object({
  ok: z.boolean(),
});
export type ImportAbortVO = z.infer<typeof ImportAbortVOSchema>;
