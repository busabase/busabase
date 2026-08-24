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
export declare const DumpTableSchema: z.ZodEnum<{
  assetTexts: "assetTexts";
  assetUsages: "assetUsages";
  assets: "assets";
  attachments: "attachments";
  auditEvents: "auditEvents";
  baseFields: "baseFields";
  bases: "bases";
  changeRequests: "changeRequests";
  comments: "comments";
  commits: "commits";
  fieldValues: "fieldValues";
  nodePrincipals: "nodePrincipals";
  nodes: "nodes";
  operations: "operations";
  recordLinks: "recordLinks";
  records: "records";
  reviews: "reviews";
  views: "views";
}>;
export type DumpTable = z.infer<typeof DumpTableSchema>;
/** Tables that only exist for `fidelity: "full"` archives (change-history). */
export declare const DUMP_HISTORY_TABLES: DumpTable[];
export declare const ExportTablesInputSchema: z.ZodObject<
  {
    table: z.ZodEnum<{
      assetTexts: "assetTexts";
      assetUsages: "assetUsages";
      assets: "assets";
      attachments: "attachments";
      auditEvents: "auditEvents";
      baseFields: "baseFields";
      bases: "bases";
      changeRequests: "changeRequests";
      comments: "comments";
      commits: "commits";
      fieldValues: "fieldValues";
      nodePrincipals: "nodePrincipals";
      nodes: "nodes";
      operations: "operations";
      recordLinks: "recordLinks";
      records: "records";
      reviews: "reviews";
      views: "views";
    }>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
  },
  z.core.$strip
>;
export type ExportTablesInput = z.infer<typeof ExportTablesInputSchema>;
export declare const ExportTablesVOSchema: z.ZodObject<
  {
    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    nextCursor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export type ExportTablesVO = z.infer<typeof ExportTablesVOSchema>;
/**
 * `POST /dump/export/asset-texts/{assetId}/content` — resolve the download URL
 * for ONE asset's extracted-text object.
 *
 * Why this exists as its own route instead of reusing `assets.readTextLines`:
 * an `asset-texts` blob is content-addressed by the sha256 of its EXACT bytes,
 * so a backup that cannot reproduce those bytes byte-for-byte produces a row
 * whose `textContentHash` no longer matches its own object. `readTextLines` is
 * a line-oriented reader (`lines: string[]`, capped at 2000 lines / ~2MB) — it
 * cannot round-trip a trailing newline, CRLF endings, a >2000-line file, or a
 * long line hit by its truncation guard. This route mirrors
 * `assets.download` instead: resolve a URL, let the caller stream the real
 * bytes, no size ceiling.
 */
export declare const ExportAssetTextInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
  },
  z.core.$strip
>;
export type ExportAssetTextInput = z.infer<typeof ExportAssetTextInputSchema>;
export declare const ExportAssetTextVOSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    textStorageKey: z.ZodString;
    downloadUrl: z.ZodNullable<z.ZodString>;
    textContentHash: z.ZodNullable<z.ZodString>;
    byteCount: z.ZodNumber;
  },
  z.core.$strip
>;
export type ExportAssetTextVO = z.infer<typeof ExportAssetTextVOSchema>;
export declare const ImportBeginVOSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
  },
  z.core.$strip
>;
export type ImportBeginVO = z.infer<typeof ImportBeginVOSchema>;
/**
 * `docBodies`, `attachmentBlobs` and `assetTextBlobs` are pseudo-tables: doc
 * markdown, attachment bytes and extracted-text bytes live in object storage,
 * not a DB row. `attachmentBlobs` rows are `{ storageKey, mimeType, base64 }` —
 * written directly via `storage.uploadFileToKey`, one per unique
 * `busabase_attachments.storageKey` in the archive (content-addressed, so
 * re-importing the same blob twice is a harmless overwrite of identical bytes).
 * `assetTextBlobs` rows are `{ textStorageKey, base64 }`, one per
 * `busabase_asset_texts` row that owns a DERIVED text object
 * (`asset-texts/blobs/sha256/…`); auto-registered rows are deliberately absent
 * because their key is the attachment's own key, already covered above.
 */
export declare const ImportTablesInputSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
    table: z.ZodUnion<
      readonly [
        z.ZodEnum<{
          assetTexts: "assetTexts";
          assetUsages: "assetUsages";
          assets: "assets";
          attachments: "attachments";
          auditEvents: "auditEvents";
          baseFields: "baseFields";
          bases: "bases";
          changeRequests: "changeRequests";
          comments: "comments";
          commits: "commits";
          fieldValues: "fieldValues";
          nodePrincipals: "nodePrincipals";
          nodes: "nodes";
          operations: "operations";
          recordLinks: "recordLinks";
          records: "records";
          reviews: "reviews";
          views: "views";
        }>,
        z.ZodLiteral<"docBodies">,
        z.ZodLiteral<"attachmentBlobs">,
        z.ZodLiteral<"assetTextBlobs">,
      ]
    >;
    rows: z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export type ImportTablesInput = z.infer<typeof ImportTablesInputSchema>;
export declare const ImportTablesVOSchema: z.ZodObject<
  {
    inserted: z.ZodNumber;
  },
  z.core.$strip
>;
export type ImportTablesVO = z.infer<typeof ImportTablesVOSchema>;
export declare const ImportSessionInputSchema: z.ZodObject<
  {
    sessionId: z.ZodString;
  },
  z.core.$strip
>;
export type ImportSessionInput = z.infer<typeof ImportSessionInputSchema>;
export declare const ImportCommitVOSchema: z.ZodObject<
  {
    ok: z.ZodBoolean;
    warnings: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export type ImportCommitVO = z.infer<typeof ImportCommitVOSchema>;
export declare const ImportAbortVOSchema: z.ZodObject<
  {
    ok: z.ZodBoolean;
  },
  z.core.$strip
>;
export type ImportAbortVO = z.infer<typeof ImportAbortVOSchema>;
