/**
 * Assets — VO Zod schemas (the contract's output source of truth). Pure zod, no
 * logic/db imports (client-safe). `schema/` holds the PO; these are the VOs the
 * `/assets` library and the "where-used" panel render.
 */
import { z } from "zod";

/**
 * Derived text-slot status for an Asset (Drive Grep Retrieval). `missing` is
 * the absence of a `busabase_asset_texts` row (no writer has supplied text
 * yet, or a pre-existing asset hasn't been lazily self-healed by a grep call);
 * `present` / `none` / `stale` are the row's own `status` column.
 */
export const AssetTextStatusSchema = z.enum(["missing", "present", "none", "stale"]);
export type AssetTextStatus = z.infer<typeof AssetTextStatusSchema>;

/** One library entry: the deduped file + its busabase metadata + usage count. */
export const AssetVOSchema = z.object({
  id: z.string(),
  attachmentId: z.string(),
  name: z.string(),
  contentKind: z.enum(["text", "binary"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string(),
  contentHash: z.string().nullable(),
  /** How many places reference this asset (Base records + Doc bodies). */
  usageCount: z.number().int().nonnegative(),
  /** Drive Grep Retrieval text-slot status — see {@link AssetTextStatusSchema}. */
  textStatus: AssetTextStatusSchema,
  createdAt: z.string(),
});
export type AssetVO = z.infer<typeof AssetVOSchema>;

/** One place an asset is referenced — the row behind "Where Used". */
export const AssetUsageVOSchema = z.object({
  ownerType: z.enum(["drive", "skill", "base", "doc", "file_node"]),
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  /** Node slug, so the UI can link to the owning Base/Doc (`/{type}/{slug}`). */
  nodeSlug: z.string(),
  /** Drive/Skill mounted path, or null when the usage is not path-based. */
  path: z.string().nullable(),
  /** Base record id, or null for whole-node usages (e.g. a Doc body). */
  recordId: z.string().nullable(),
  /** Attachment field slug, or null for whole-node usages. */
  fieldSlug: z.string().nullable(),
  /** Doc block id, or null when the usage is not block-based. */
  blockId: z.string().nullable(),
  createdAt: z.string(),
});
export type AssetUsageVO = z.infer<typeof AssetUsageVOSchema>;

/** Asset detail = the library entry plus every place it is used. */
export const AssetDetailVOSchema = z.object({
  asset: AssetVOSchema,
  usages: z.array(AssetUsageVOSchema),
});
export type AssetDetailVO = z.infer<typeof AssetDetailVOSchema>;

// ── Drive Grep Retrieval ──────────────────────────────────────────────────────
// See apps/busabase/content/spec/drive-grep-retrieval.md for the full design.
// Busabase stores, indexes, and searches text; it never generates it — every
// Asset gets a *text* slot (not "extract"/"extractedText") filled either
// automatically (text-kind files point at their own bytes) or by an external
// writer via `putText` (agents, future Outgoing-Hook extractors).

/** `PUT /assets/{assetId}/text` — exactly one of `text` | `storageKey` | `none` must be set. */
export const PutTextInputSchema = z.object({
  assetId: z.string(),
  /** Inline text body, ≤ 1 MB. For larger text, use `createTextUploadUrl` + bind by `storageKey`. */
  text: z.string().optional(),
  /** Bind a presigned-uploaded text object (a temp `asset-texts/pending/*.txt` key). */
  storageKey: z.string().optional(),
  /**
   * Claimed content hash for the `storageKey` bind path (`sha256:<hex>`, echoing
   * `createTextUploadUrl`'s input like `open-domains/attachments`' confirm step).
   * The server always computes the ACTUAL hash from the bytes during the
   * confirm scan and rejects a mismatch (hash-poisoning defense) — this field
   * is only an optional early-mismatch check, never trusted for addressing.
   */
  contentHash: z.string().optional(),
  /** Mark as having no extractable text (e.g. a scanned, image-only PDF). */
  none: z.boolean().optional(),
});
export type PutTextInput = z.infer<typeof PutTextInputSchema>;

/** Result of a `putText` write — the text slot's new state. */
export const AssetTextVOSchema = z.object({
  assetId: z.string(),
  textStatus: AssetTextStatusSchema,
  lineCount: z.number().int().nonnegative(),
  charCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
});
export type AssetTextVO = z.infer<typeof AssetTextVOSchema>;

/** `POST /assets/text/upload-urls` — presigned URL for a large text write. */
export const CreateTextUploadUrlInputSchema = z.object({
  assetId: z.string(),
  sizeBytes: z.number().int().positive(),
  /** Optional claim, mirrors `RequestUploadUrlDTO.contentHash` (never trusted for addressing). */
  contentHash: z.string().optional(),
});
export type CreateTextUploadUrlInput = z.infer<typeof CreateTextUploadUrlInputSchema>;

export const CreateTextUploadUrlVOSchema = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  expiresIn: z.number().int().nonnegative(),
});
export type CreateTextUploadUrlVO = z.infer<typeof CreateTextUploadUrlVOSchema>;

/** `POST /assets/grep` scope — narrow the candidate set before scanning. */
export const GrepScopeSchema = z.object({
  assetIds: z.array(z.string()).optional(),
  /** Drive/Skill mounted path prefix (matches `busabase_asset_usages.path`). */
  drivePath: z.string().optional(),
  mimeTypes: z.array(z.string()).optional(),
});
export type GrepScope = z.infer<typeof GrepScopeSchema>;

export const GREP_DEFAULT_MAX_MATCHES = 100;
export const GREP_HARD_MAX_MATCHES = 1000;
export const GREP_DEFAULT_CONTEXT_LINES = 0;
export const GREP_MAX_CONTEXT_LINES = 10;

export const GrepInputSchema = z.object({
  pattern: z.string().min(1),
  /** JS RegExp flags, e.g. `"i"` for case-insensitive. `g`/`y` are ignored (grep always scans every match per line). */
  flags: z.string().optional().default(""),
  scope: GrepScopeSchema.optional(),
  maxMatches: z.coerce
    .number()
    .int()
    .min(1)
    .max(GREP_HARD_MAX_MATCHES)
    .optional()
    .default(GREP_DEFAULT_MAX_MATCHES),
  contextLines: z.coerce
    .number()
    .int()
    .min(0)
    .max(GREP_MAX_CONTEXT_LINES)
    .optional()
    .default(GREP_DEFAULT_CONTEXT_LINES),
});
export type GrepInput = z.infer<typeof GrepInputSchema>;

/** One match — real line/column numbers (1-based), so a caller can `readLines` right around it. */
export const GrepMatchVOSchema = z.object({
  assetId: z.string(),
  fileName: z.string(),
  /** Drive/Skill mounted path, or "" when the asset isn't path-mounted (e.g. a File node). */
  drivePath: z.string(),
  line: z.number().int().positive(),
  /** 1-based character column (not byte offset) of the match start within the line. */
  column: z.number().int().positive(),
  /** The matching line, truncated if it exceeds the long-line guard. */
  text: z.string(),
  before: z.array(z.string()),
  after: z.array(z.string()),
});
export type GrepMatchVO = z.infer<typeof GrepMatchVOSchema>;

export const GrepResultVOSchema = z.object({
  matches: z.array(GrepMatchVOSchema),
  filesScanned: z.number().int().nonnegative(),
  /** Asset ids in scope with no text yet (contentKind text-or-writable-binary, no row). */
  missing: z.array(z.string()),
  /** Asset ids in scope whose derived text is stale (source replaced since it was written). */
  stale: z.array(z.string()),
  /** Count of assets in scope explicitly marked `none` (no extractable text). */
  unsearchable: z.number().int().nonnegative(),
  /**
   * Asset ids whose scan was attempted but failed (storage error, corrupt
   * cache file, object deleted mid-flight) — NOT counted in `filesScanned`.
   * Honest coverage: these were not actually searched, so a caller must not
   * treat their absence from `matches` as a clean "no match".
   */
  errored: z.array(z.string()),
  /**
   * Count of in-scope, present-and-searchable assets the scan never even
   * reached because the deadline or `maxMatches` budget ran out first. Only
   * nonzero when `truncated` is true.
   */
  notReached: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type GrepResultVO = z.infer<typeof GrepResultVOSchema>;

/** `GET /assets/{assetId}/text/lines?startLine&endLine` — range capped at 2000 lines. */
export const ReadTextLinesInputSchema = z.object({
  assetId: z.string(),
  startLine: z.coerce.number().int().min(1),
  endLine: z.coerce.number().int().min(1),
});
export type ReadTextLinesInput = z.infer<typeof ReadTextLinesInputSchema>;

export const ReadLinesVOSchema = z.object({
  lines: z.array(z.string()),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  totalLines: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type ReadLinesVO = z.infer<typeof ReadLinesVOSchema>;
