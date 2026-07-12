import { oc } from "@orpc/contract";
import {
  ConfirmUploadInputSchema,
  ConfirmUploadVOSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlVOSchema,
} from "open-domains/attachments/types";
import { z } from "zod";
import { changeRequestSchema } from "../../contract/schemas";
import {
  AssetDetailVOSchema,
  AssetDownloadInputSchema,
  AssetDownloadVOSchema,
  AssetTextVOSchema,
  AssetVOSchema,
  CreateTextUploadUrlInputSchema,
  CreateTextUploadUrlVOSchema,
  EditAssetContentInputSchema,
  GrepInputSchema,
  GrepResultVOSchema,
  PutTextInputSchema,
  ReadLinesVOSchema,
  ReadTextLinesInputSchema,
} from "./types";

export const UpdateAssetMetadataInputSchema = z.object({
  assetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  mode: z.enum(["merge", "replace"]).optional().default("merge"),
});
export type UpdateAssetMetadataInput = z.infer<typeof UpdateAssetMetadataInputSchema>;

// Assets domain oRPC routes; composed into the root contract in
// contract/busabase.ts. The deduped Asset library + its where-used reverse index.
export const assetsContract = {
  createUploadUrl: oc
    .route({
      method: "POST",
      path: "/assets/upload-urls",
      tags: ["Assets"],
      summary: "Request asset upload URL",
      successDescription:
        "Presigned (or dev) upload URL plus the public URL and asset id when identical bytes are already in the library.",
    })
    .input(RequestUploadUrlInputSchema)
    .output(RequestUploadUrlVOSchema),
  confirm: oc
    .route({
      method: "POST",
      path: "/assets/confirmations",
      tags: ["Assets"],
      summary: "Confirm asset upload",
      successDescription: "Recorded the file and ensured its Busabase Asset library entry.",
    })
    .input(ConfirmUploadInputSchema)
    .output(ConfirmUploadVOSchema),
  list: oc
    .route({
      method: "GET",
      path: "/assets",
      tags: ["Assets"],
      summary: "List assets",
      successDescription: "Every asset in the space, with file metadata and usage counts.",
    })
    .output(z.array(AssetVOSchema)),
  get: oc
    .route({
      method: "GET",
      path: "/assets/{assetId}",
      tags: ["Assets"],
      summary: "Get asset detail",
      successDescription: "Asset metadata plus every place it is referenced (where-used).",
    })
    .input(z.object({ assetId: z.string() }))
    .output(AssetDetailVOSchema),
  updateMetadata: oc
    .route({
      method: "PATCH",
      path: "/assets/{assetId}/metadata",
      tags: ["Assets"],
      summary: "Update asset metadata",
      successDescription:
        "Updated AI-readable metadata for a file, such as summary, tags, source URL, or schema-specific hints. Large text does not live here — see putText / grep / readTextLines.",
    })
    .input(UpdateAssetMetadataInputSchema)
    .output(AssetDetailVOSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/assets/{assetId}",
      tags: ["Assets"],
      summary: "Delete asset",
      successDescription:
        "Removed the asset and, if no other row references its bytes, the stored object. Refused while the asset is still referenced (where-used).",
    })
    .input(z.object({ assetId: z.string() }))
    .output(z.object({ deleted: z.boolean() })),
  download: oc
    .route({
      method: "GET",
      path: "/assets/{assetId}/content",
      tags: ["Assets"],
      summary: "Get an asset's binary content download URL",
      successDescription:
        "A resolved, time-bounded download URL for the asset's raw bytes (local dev: the existing static /uploads route; cloud/S3: a presigned URL) plus its file metadata — see AssetDownloadVOSchema for why this returns a URL, not a raw-binary oRPC response.",
    })
    .input(AssetDownloadInputSchema)
    .output(AssetDownloadVOSchema),

  // ── Drive Grep Retrieval ─────────────────────────────────────────────────
  // Busabase stores, indexes, and searches text; it never generates it. Text
  // always arrives via putText — an agent's own extractor, or (future) an
  // Outgoing-Hook-triggered service — never a bundled parser/OCR library.
  putText: oc
    .route({
      method: "PUT",
      path: "/assets/{assetId}/text",
      tags: ["Assets"],
      summary: "Write (or mark none) an asset's text slot",
      successDescription:
        "Text slot updated: inline body (≤1MB), or bound from a presigned upload (server-verified content hash, hash-poisoning-safe), or marked `none` for files with no extractable text. Direct write, audit-logged, not ChangeRequest-gated.",
    })
    .input(PutTextInputSchema)
    .output(AssetTextVOSchema),
  createTextUploadUrl: oc
    .route({
      method: "POST",
      path: "/assets/text/upload-urls",
      tags: ["Assets"],
      summary: "Request a presigned upload URL for large text",
      successDescription:
        "Presigned (or dev) upload URL for a temporary text object; PUT the bytes there, then call putText with the returned storageKey to bind, verify, and content-address it.",
    })
    .input(CreateTextUploadUrlInputSchema)
    .output(CreateTextUploadUrlVOSchema),
  grep: oc
    .route({
      method: "POST",
      path: "/assets/grep",
      tags: ["Assets"],
      summary: "Search every text-bearing asset in scope",
      successDescription:
        "Streaming regex/literal matches with real file + line + column numbers and context, across every asset with text — any size, no 256KB cap. Honest coverage: missing/stale/unsearchable/errored name assets that were not (fully or successfully) searched, notReached counts present assets the scan never got to, and truncated flags a capped response.",
    })
    .input(GrepInputSchema)
    .output(GrepResultVOSchema),
  readTextLines: oc
    .route({
      method: "GET",
      path: "/assets/{assetId}/text/lines",
      tags: ["Assets"],
      summary: "Read an exact line range from an asset's text",
      successDescription:
        "Lines [startLine, endLine] (range capped at 2000 lines / ~2MB response) read via a storage byte-range request — the server never loads the whole object, even for a multi-GB file.",
    })
    .input(ReadTextLinesInputSchema)
    .output(ReadLinesVOSchema),

  // ── editContent — edit an asset's REAL file content via ChangeRequest ──────
  // Unlike putText (derived/extracted text, direct write, disposable), this
  // edits the asset's actual mounted Drive/Skill file bytes and always goes
  // through the existing filetree ChangeRequest pipeline — never auto-merged.
  editContent: oc
    .route({
      method: "POST",
      path: "/assets/{assetId}/edit-content",
      tags: ["Assets", "Change Requests"],
      summary: "Edit an asset's file content via string-replace edits, as a ChangeRequest",
      successDescription:
        'Applied the string-replace edits (coding-agent Edit-tool semantics: unique-match or replaceAll) to the asset\'s current mounted Drive/Skill file content and proposed the result as a ChangeRequest (status "in_review") for human review. Reuses the existing filetree update-via-CR pipeline end to end, including baseContentHash optimistic-concurrency conflict protection at merge time. Requires the asset to be mounted in exactly one editable Drive/Skill location.',
    })
    .input(EditAssetContentInputSchema)
    .output(changeRequestSchema),
};
