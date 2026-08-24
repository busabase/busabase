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
export declare const AssetTextStatusSchema: z.ZodEnum<{
  missing: "missing";
  none: "none";
  present: "present";
  stale: "stale";
}>;
export type AssetTextStatus = z.infer<typeof AssetTextStatusSchema>;
/** One library entry: the deduped file + its busabase metadata + usage count. */
export declare const AssetVOSchema: z.ZodObject<
  {
    id: z.ZodString;
    attachmentId: z.ZodString;
    name: z.ZodString;
    contentKind: z.ZodEnum<{
      binary: "binary";
      text: "text";
    }>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fileName: z.ZodString;
    mimeType: z.ZodString;
    size: z.ZodNumber;
    url: z.ZodString;
    contentHash: z.ZodNullable<z.ZodString>;
    usageCount: z.ZodNumber;
    textStatus: z.ZodEnum<{
      missing: "missing";
      none: "none";
      present: "present";
      stale: "stale";
    }>;
    createdAt: z.ZodString;
  },
  z.core.$strip
>;
export type AssetVO = z.infer<typeof AssetVOSchema>;
/** One place an asset is referenced — the row behind "Where Used". */
export declare const AssetUsageVOSchema: z.ZodObject<
  {
    ownerType: z.ZodEnum<{
      airapp: "airapp";
      base: "base";
      doc: "doc";
      drive: "drive";
      file_node: "file_node";
      skill: "skill";
    }>;
    nodeId: z.ZodString;
    nodeName: z.ZodString;
    nodeType: z.ZodString;
    nodeSlug: z.ZodString;
    path: z.ZodNullable<z.ZodString>;
    recordId: z.ZodNullable<z.ZodString>;
    fieldSlug: z.ZodNullable<z.ZodString>;
    blockId: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
  },
  z.core.$strip
>;
export type AssetUsageVO = z.infer<typeof AssetUsageVOSchema>;
/** Asset detail = the library entry plus every place it is used. */
export declare const AssetDetailVOSchema: z.ZodObject<
  {
    asset: z.ZodObject<
      {
        id: z.ZodString;
        attachmentId: z.ZodString;
        name: z.ZodString;
        contentKind: z.ZodEnum<{
          binary: "binary";
          text: "text";
        }>;
        metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        fileName: z.ZodString;
        mimeType: z.ZodString;
        size: z.ZodNumber;
        url: z.ZodString;
        contentHash: z.ZodNullable<z.ZodString>;
        usageCount: z.ZodNumber;
        textStatus: z.ZodEnum<{
          missing: "missing";
          none: "none";
          present: "present";
          stale: "stale";
        }>;
        createdAt: z.ZodString;
      },
      z.core.$strip
    >;
    usages: z.ZodArray<
      z.ZodObject<
        {
          ownerType: z.ZodEnum<{
            airapp: "airapp";
            base: "base";
            doc: "doc";
            drive: "drive";
            file_node: "file_node";
            skill: "skill";
          }>;
          nodeId: z.ZodString;
          nodeName: z.ZodString;
          nodeType: z.ZodString;
          nodeSlug: z.ZodString;
          path: z.ZodNullable<z.ZodString>;
          recordId: z.ZodNullable<z.ZodString>;
          fieldSlug: z.ZodNullable<z.ZodString>;
          blockId: z.ZodNullable<z.ZodString>;
          createdAt: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type AssetDetailVO = z.infer<typeof AssetDetailVOSchema>;
/** `PUT /assets/{assetId}/text` — exactly one of `text` | `storageKey` | `none` must be set. */
export declare const PutTextInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    text: z.ZodOptional<z.ZodString>;
    storageKey: z.ZodOptional<z.ZodString>;
    contentHash: z.ZodOptional<z.ZodString>;
    none: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type PutTextInput = z.infer<typeof PutTextInputSchema>;
/** Result of a `putText` write — the text slot's new state. */
export declare const AssetTextVOSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    textStatus: z.ZodEnum<{
      missing: "missing";
      none: "none";
      present: "present";
      stale: "stale";
    }>;
    lineCount: z.ZodNumber;
    charCount: z.ZodNumber;
    byteCount: z.ZodNumber;
  },
  z.core.$strip
>;
export type AssetTextVO = z.infer<typeof AssetTextVOSchema>;
/** `POST /assets/text/upload-urls` — presigned URL for a large text write. */
export declare const CreateTextUploadUrlInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    sizeBytes: z.ZodNumber;
    contentHash: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type CreateTextUploadUrlInput = z.infer<typeof CreateTextUploadUrlInputSchema>;
export declare const CreateTextUploadUrlVOSchema: z.ZodObject<
  {
    uploadUrl: z.ZodString;
    storageKey: z.ZodString;
    expiresIn: z.ZodNumber;
  },
  z.core.$strip
>;
export type CreateTextUploadUrlVO = z.infer<typeof CreateTextUploadUrlVOSchema>;
/** Files-only grep scope used by the shared scanner and SDK compatibility adapter. */
export declare const GrepScopeSchema: z.ZodObject<
  {
    assetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    drivePath: z.ZodOptional<z.ZodString>;
    mimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export type GrepScope = z.infer<typeof GrepScopeSchema>;
export declare const GREP_DEFAULT_MAX_MATCHES = 100;
export declare const GREP_HARD_MAX_MATCHES = 1000;
export declare const GREP_DEFAULT_CONTEXT_LINES = 0;
export declare const GREP_MAX_CONTEXT_LINES = 10;
/** Files-only grep input used internally and by the SDK's `assets.grep` convenience adapter. */
export declare const GrepInputSchema: z.ZodObject<
  {
    pattern: z.ZodString;
    flags: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    scope: z.ZodOptional<
      z.ZodObject<
        {
          assetIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
          drivePath: z.ZodOptional<z.ZodString>;
          mimeTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
    maxMatches: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    contextLines: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
  },
  z.core.$strip
>;
/** Caller input before Zod applies defaults. */
export type GrepInputDTO = z.input<typeof GrepInputSchema>;
/** Parsed input consumed by the files scanner. */
export type GrepInput = z.infer<typeof GrepInputSchema>;
/** One match — real line/column numbers (1-based), so a caller can `readLines` right around it. */
export declare const GrepMatchVOSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    fileName: z.ZodString;
    drivePath: z.ZodString;
    line: z.ZodNumber;
    column: z.ZodNumber;
    text: z.ZodString;
    before: z.ZodArray<z.ZodString>;
    after: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export type GrepMatchVO = z.infer<typeof GrepMatchVOSchema>;
export declare const GrepResultVOSchema: z.ZodObject<
  {
    matches: z.ZodArray<
      z.ZodObject<
        {
          assetId: z.ZodString;
          fileName: z.ZodString;
          drivePath: z.ZodString;
          line: z.ZodNumber;
          column: z.ZodNumber;
          text: z.ZodString;
          before: z.ZodArray<z.ZodString>;
          after: z.ZodArray<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    filesScanned: z.ZodNumber;
    missing: z.ZodArray<z.ZodString>;
    stale: z.ZodArray<z.ZodString>;
    unsearchable: z.ZodNumber;
    errored: z.ZodArray<z.ZodString>;
    notReached: z.ZodNumber;
    truncated: z.ZodBoolean;
  },
  z.core.$strip
>;
export type GrepResultVO = z.infer<typeof GrepResultVOSchema>;
/** `GET /assets/{assetId}/text/lines?startLine&endLine` — range capped at 2000 lines. */
export declare const ReadTextLinesInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    startLine: z.ZodCoercedNumber<unknown>;
    endLine: z.ZodCoercedNumber<unknown>;
  },
  z.core.$strip
>;
export type ReadTextLinesInput = z.infer<typeof ReadTextLinesInputSchema>;
export declare const ReadLinesVOSchema: z.ZodObject<
  {
    lines: z.ZodArray<z.ZodString>;
    startLine: z.ZodNumber;
    endLine: z.ZodNumber;
    totalLines: z.ZodNumber;
    truncated: z.ZodBoolean;
  },
  z.core.$strip
>;
export type ReadLinesVO = z.infer<typeof ReadLinesVOSchema>;
/** One string-replace edit — mirrors a coding-agent Edit tool's exact semantics. */
export declare const AssetContentEditSchema: z.ZodObject<
  {
    oldString: z.ZodString;
    newString: z.ZodString;
    replaceAll: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
  },
  z.core.$strict
>;
export type AssetContentEdit = z.infer<typeof AssetContentEditSchema>;
/**
 * `POST /assets/{assetId}/edit-content` — apply `edits` sequentially (each
 * against the result of the previous one) to the asset's current mounted Drive/
 * Skill text content, then propose the result as a `content`-shaped `update`
 * operation on the existing filetree ChangeRequest pipeline (`baseContentHash`
 * threaded through for the same optimistic-concurrency conflict check any other
 * file edit gets). Requires the asset to be mounted in exactly one Drive/Skill
 * location — ambiguous or absent mounts are rejected rather than guessed at.
 */
export declare const EditAssetContentInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    edits: z.ZodArray<
      z.ZodObject<
        {
          oldString: z.ZodString;
          newString: z.ZodString;
          replaceAll: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        },
        z.core.$strict
      >
    >;
    message: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    submittedBy: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    autoMerge: z.ZodOptional<z.ZodLiteral<false>>;
  },
  z.core.$strip
>;
export type EditAssetContentInput = z.infer<typeof EditAssetContentInputSchema>;
/**
 * `GET /assets/{assetId}/content` result. oRPC contracts here are JSON in/out
 * (no raw binary passthrough exists anywhere else in this codebase — grepped
 * the assets/drive domains and the Drive Grep Retrieval streaming reads, which
 * all stay server-side/byte-range, never a raw-binary oRPC response), so the
 * pragmatic, consistent-with-`AssetVO.url` shape is a resolved download URL:
 * `storage.getPublicUrl` locally (served by the existing static /uploads
 * route), or a presigned S3 URL in cloud deployments. Callers (browsers,
 * `busabase-dump`) then do a plain HTTP GET against `downloadUrl`.
 */
export declare const AssetDownloadInputSchema: z.ZodObject<
  {
    assetId: z.ZodString;
  },
  z.core.$strip
>;
export type AssetDownloadInput = z.infer<typeof AssetDownloadInputSchema>;
export declare const AssetDownloadVOSchema: z.ZodObject<
  {
    assetId: z.ZodString;
    downloadUrl: z.ZodString;
    fileName: z.ZodString;
    mimeType: z.ZodString;
    size: z.ZodNumber;
    contentHash: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export type AssetDownloadVO = z.infer<typeof AssetDownloadVOSchema>;
