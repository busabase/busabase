import { oc } from "@orpc/contract";
import {
  ConfirmUploadInputSchema,
  ConfirmUploadVOSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlVOSchema,
} from "open-domains/attachments/types";
import { z } from "zod";
import { AssetDetailVOSchema, AssetVOSchema } from "./types";

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
        "Updated AI-readable metadata for a file, such as summary, extracted text, tags, source URL, or schema-specific hints.",
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
};
