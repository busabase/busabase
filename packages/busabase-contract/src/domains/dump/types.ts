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
  "nodePrincipals",
  "nodeShares",
  "favorites",
  "nodeSubscriptions",
  "spaceInstructions",
  "spaceWelcome",
  "embedLinks",
  "bases",
  "baseFields",
  "views",
  "forms",
  "commits",
  "changeRequests",
  "operations",
  "records",
  "fieldValues",
  "recordLinks",
  "attachments",
  "assets",
  "assetUsages",
  "assetTexts",
  "comments",
  "commentMentions",
  "reviews",
  "auditEvents",
  "workflowRuns",
  "workflowTriggers",
  "webhookRules",
  "webhookDeliveries",
  "agentSessions",
  "agentSessionEvents",
  "agentSessionCommands",
  "routerGrants",
  "routerConnections",
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

/** One READ ONLY REPEATABLE READ SQL cut; storage objects are not transactional. */
export const ExportSnapshotInputSchema = z
  .object({ limit: z.number().int().positive().max(2000).optional().default(500) })
  .strict();
export type ExportSnapshotInput = z.infer<typeof ExportSnapshotInputSchema>;

/** A content-only dependency owned by the readable Asset, never its foreign PO. */
export const ExportAssetAttachmentInputSchema = z.object({ assetId: z.string().min(1) }).strict();
export type ExportAssetAttachmentInput = z.infer<typeof ExportAssetAttachmentInputSchema>;
export const ExportAssetAttachmentVOSchema = z
  .object({
    assetId: z.string().min(1),
    attachmentId: z.string().min(1),
    /** Signed from the captured key with a requested 24-hour lifetime; bytes are not pinned. */
    downloadUrl: z.string().min(1),
    materializedAttachment: z
      .object({
        id: z.string().min(1),
        spaceId: z.string().min(1),
        storageKey: z.string().min(1),
        fileName: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        contentHash: z.string().nullable(),
        context: z.literal("busabase-backup-dependency"),
        userId: z.string(),
        metadata: z
          .object({
            busabaseBackupDependency: z
              .object({
                version: z.literal(1),
                sourceAssetId: z.string().min(1),
                sourceAttachmentId: z.string().min(1),
                sourceSpaceId: z.string().min(1),
                projection: z.literal("readable-asset-content"),
                originalAttachmentOwnershipOmitted: z.literal(true),
              })
              .strict(),
          })
          .strict(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
export type ExportAssetAttachmentVO = z.infer<typeof ExportAssetAttachmentVOSchema>;

export const ExportSnapshotEventVOSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("start"),
      version: z.literal(1),
      spaceId: z.string().min(1),
      startedAt: z.string().datetime(),
      tables: z.array(DumpTableSchema),
      columns: z.record(DumpTableSchema, z.array(z.string().min(1))),
    })
    .strict(),
  z
    .object({
      type: z.literal("rows"),
      table: DumpTableSchema,
      /** Opaque JSON array: generic RPC object sanitizers must not discard legal user keys. */
      rowsJson: z.string().min(2),
      count: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tableEnd"),
      table: DumpTableSchema,
      count: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ type: z.literal("attachmentDependency"), dependency: ExportAssetAttachmentVOSchema })
    .strict(),
  z
    .object({
      type: z.literal("complete"),
      tables: z.record(DumpTableSchema, z.number().int().nonnegative()),
      attachmentDependencies: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type ExportSnapshotEventVO = z.infer<typeof ExportSnapshotEventVOSchema>;

/** A physical object in this space, including legacy rows referenced by its Assets. */
export const ExportAttachmentInputSchema = z.object({ attachmentId: z.string().min(1) });
export type ExportAttachmentInput = z.infer<typeof ExportAttachmentInputSchema>;
export const ExportAttachmentVOSchema = z.object({
  attachmentId: z.string(),
  storageKey: z.string(),
  downloadUrl: z.string(),
  mimeType: z.string(),
  contentHash: z.string().nullable(),
  sizeBytes: z.number().nonnegative(),
});
export type ExportAttachmentVO = z.infer<typeof ExportAttachmentVOSchema>;

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
 * `POST /dump/export/doc-bodies` — read stored node documents, including
 * archived Docs, folder readmes, HTML, whiteboard and workflow source objects.
 * `markdown` is the historical wire key; rich entries carry their original
 * UTF-8 bytes as a string plus `nodeType`, without JSON parse/stringify.
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
  /** Absent on older servers, which cannot distinguish a missing rich object from unsupported coverage. */
  supportedRichNodeTypes: z.array(z.enum(["html", "whiteboard", "workflow"])).optional(),
  /**
   * One entry per requested supported node with stored content in this space. A node
   * id that does not resolve is simply absent (not an error): the caller asked
   * for a batch, and one bad id must not cost it the other 24. A Doc that
   * exists but has no body object yet yields `markdown: ""`, matching what a
   * read through the Doc domain would return. A folder with no readme object
   * is absent instead — most folders never have one, and archiving `""` for
   * each would restore an empty object where none existed. The same absence
   * rule applies to a rich node with no object: its renderer's default document
   * is not source content and must not be archived as though it were.
   *
   * `bodyFormat: "html"` marks a folder whose readme is HTML (`…/readme.html`);
   * `markdown` then carries the raw HTML source. It is absent for everything
   * else, so a Doc entry and a Markdown readme look exactly as they always
   * have. The same field on a `docBodies` import row restores the HTML object.
   */
  bodies: z.array(
    z.object({
      nodeId: z.string(),
      markdown: z.string(),
      bodyFormat: z.literal("html").optional(),
      /** Raw stored rich document; markdown retains the exact UTF-8 source, including JSON whitespace. */
      nodeType: z.enum(["html", "whiteboard", "workflow"]).optional(),
    }),
  ),
});
export type ExportDocBodiesVO = z.infer<typeof ExportDocBodiesVOSchema>;

export const ImportBeginInputSchema = z.object({
  /** Verified manifest checksum; mandatory for exact replay of interrupted imports. */
  sourceArchiveChecksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /** Archive SQL inventory including materialized dependencies; omitted tables mean zero. */
  expectedTables: z.partialRecord(DumpTableSchema, z.number().int().nonnegative()).optional(),
  /** Modern SQL snapshots retain exact view positions/configuration; legacy imports keep migration defaults. */
  preserveViewMetadata: z.boolean().optional().default(false),
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
   * Requires archive identity and inventory. Before replaying any object or
   * row, validateOnly batches and a validationComplete acknowledgement for
   * every SQL table must establish exact values and identity coverage.
   */
  resume: z.boolean().optional().default(false),
});
export type ImportBeginInput = z.infer<typeof ImportBeginInputSchema>;

export const ImportBeginVOSchema = z.object({
  sessionId: z.string(),
  /** Never send validateOnly to older servers that could silently write it. */
  exactReplayProtocol: z.literal(1).optional(),
  /** Large blobs may be sent as bounded, session-scoped multipart chunks only when this capability is present. */
  blobChunkProtocol: z.literal(1).optional(),
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
/**
 * When importBegin returns blobChunkProtocol:1, attachmentBlobs/assetTextBlobs
 * can instead carry one part per request: original key + mimeType + base64 and
 * chunk:{partNumber,totalParts,sizeBytes,sha256}. Parts are six MiB decoded
 * except the last; sha256 is the hex digest of the entire object. The server
 * stages, validates and promotes only a complete object; repeated last parts
 * are idempotent. Old servers must never be sent chunks.
 */
export const ImportTablesInputSchema = z.object({
  sessionId: z.string(),
  /** Read-only SQL preflight; requires exactReplayProtocol:1. */
  validateOnly: z.boolean().optional().default(false),
  /** End a table with rows:[]; empty tables also require this acknowledgement. */
  validationComplete: z.boolean().optional().default(false),
  table: z.union([
    DumpTableSchema,
    z.literal("docBodies"),
    z.literal("attachmentBlobs"),
    z.literal("assetTextBlobs"),
  ]),
  /** Opaque JSON avoids RPC serialization dropping legal nested keys such as __proto__. SQL tables only. */
  rowsJson: z.string().optional(),
  rows: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});
export type ImportTablesInput = z.infer<typeof ImportTablesInputSchema>;

export const ImportTablesVOSchema = z.object({
  inserted: z.number().int().nonnegative(),
  validated: z.literal(true).optional(),
  validationComplete: z.boolean().optional(),
  validatedRows: z.number().int().nonnegative().optional(),
});
export type ImportTablesVO = z.infer<typeof ImportTablesVOSchema>;

export const ImportSessionInputSchema = z.object({
  sessionId: z.string(),
});
export type ImportSessionInput = z.infer<typeof ImportSessionInputSchema>;

export const ImportCommitVOSchema = z.object({
  ok: z.boolean(),
  warnings: z.array(z.string()),
  /** Expected safe credential exclusions/reconnect steps, separate from integrity failures. */
  notices: z.array(z.string()).optional(),
});
export type ImportCommitVO = z.infer<typeof ImportCommitVOSchema>;

export const ImportAbortVOSchema = z.object({
  ok: z.boolean(),
});
export type ImportAbortVO = z.infer<typeof ImportAbortVOSchema>;
