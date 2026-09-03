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
export const ExportAssetTextInputSchema = z.object({ assetId: z.string() });
export type ExportAssetTextInput = z.infer<typeof ExportAssetTextInputSchema>;

export const ExportAssetTextVOSchema = z.object({
  assetId: z.string(),
  /** The row's `text_storage_key` — the exact key a restore must write back to. */
  textStorageKey: z.string(),
  /**
   * `null` when this row owns no separate text object and therefore needs no
   * blob in the archive:
   *  - auto-registered text-kind rows (`writtenBy: "auto"`), whose
   *    `textStorageKey` IS the owning attachment's own key — those bytes are
   *    already archived by the attachment-blob pass, and re-archiving them
   *    would duplicate bytes and collide on restore;
   *  - `status: "none"` rows (no extractable text), whose key is `""`.
   */
  downloadUrl: z.string().nullable(),
  /** `sha256:<hex>` of the text bytes, so a backup can verify what it downloaded. */
  textContentHash: z.string().nullable(),
  byteCount: z.number().int().nonnegative(),
});
export type ExportAssetTextVO = z.infer<typeof ExportAssetTextVOSchema>;

/**
 * `POST /dump/export/doc-bodies` — read the raw markdown behind a batch of Doc
 * nodes, straight from object storage.
 *
 * The export side's counterpart to the `docBodies` pseudo-table on
 * `importTables`. Without it a backup has no way to reach a Doc's body except
 * the ordinary `nodes.get({ type: "doc" })`, which deliberately 404s on an
 * ARCHIVED node (Trash is read through a separate metadata-only endpoint) —
 * while the raw `nodes` table dump includes archived rows by design. The result
 * was a backup that silently archived 13 of 88 Doc bodies on a real production
 * space and warned about the other 75: restoring it brought every archived Doc
 * back empty. A full-fidelity dump has to see the whole table, archived rows
 * included, exactly like every other `dump.*` route.
 *
 * Batched rather than one-request-per-Doc because the old path spent one HTTP
 * round trip per Doc. `DOC_BODY_MAX_BYTES` (300,000) caps any single body, so
 * the batch cap below bounds a response at ~7.5MB worst case.
 */
export const EXPORT_DOC_BODIES_MAX_BATCH = 25;

export const ExportDocBodiesInputSchema = z.object({
  nodeIds: z.array(z.string()).min(1).max(EXPORT_DOC_BODIES_MAX_BATCH),
});
export type ExportDocBodiesInput = z.infer<typeof ExportDocBodiesInputSchema>;

export const ExportDocBodiesVOSchema = z.object({
  /**
   * One entry per requested node that is a Doc in this space. A node id that
   * does not resolve is simply absent (not an error): the caller asked for a
   * batch, and one bad id must not cost it the other 24. A Doc that exists but
   * has no body object yet yields `markdown: ""`, matching what a read through
   * the Doc domain would return.
   */
  bodies: z.array(z.object({ nodeId: z.string(), markdown: z.string() })),
});
export type ExportDocBodiesVO = z.infer<typeof ExportDocBodiesVOSchema>;

export const ImportBeginInputSchema = z.object({
  /**
   * The space id the archive was ORIGINALLY exported from (`manifest.spaceId`
   * in the `.bbdump`, already integrity-verified before this is called).
   * `importTableRows`'s "nodes" handling needs this to recognize the
   * archive's own root-node row deterministically (`rootNodeIdForSpace`) —
   * scanning each batch's rows for "the one with a null `parentId`" only
   * works when that row happens to land in the SAME batch as its children,
   * which cursor pagination (id-ordered, not tree-ordered) does not
   * guarantee once a space has more nodes than one page. See the matching
   * comment in `import-logic.ts`.
   */
  sourceSpaceId: z.string(),
  /**
   * Continue a restore that was interrupted partway through, instead of
   * requiring an empty space.
   *
   * A restore that FAILS rolls itself back (`importAbort`), so the target is
   * left clean and a plain re-run works. What cannot roll itself back is a
   * restore whose process died — Ctrl-C, OOM, a dropped connection, the
   * machine rebooting. That leaves the space holding however many of the
   * archive's rows had landed, and every subsequent attempt is refused
   * ("requires an empty target space") with no way forward except wiping it.
   *
   * In this mode the empty-space guard is skipped and inserts become
   * `ON CONFLICT DO NOTHING`, so replaying the same archive re-lands only what
   * is missing. Blobs and doc bodies are content-addressed writes to object
   * storage and were already idempotent.
   *
   * DANGEROUS if pointed at the wrong space: rows that collide are silently
   * skipped rather than reported, so restoring archive A into a space holding
   * archive B's data would interleave the two instead of refusing. Only pass
   * it to continue the SAME archive into the SAME space.
   */
  resume: z.boolean().optional().default(false),
});
export type ImportBeginInput = z.infer<typeof ImportBeginInputSchema>;

export const ImportBeginVOSchema = z.object({
  sessionId: z.string(),
});
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
export const ImportTablesInputSchema = z.object({
  sessionId: z.string(),
  table: z.union([
    DumpTableSchema,
    z.literal("docBodies"),
    z.literal("attachmentBlobs"),
    z.literal("assetTextBlobs"),
  ]),
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
