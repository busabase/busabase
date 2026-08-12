"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useS3Uploader } from "open-domains/attachments/hooks";
import { buildAssetContentUrl } from "../../assets/utils/asset-content-url";

/**
 * Wires image paste/upload in the Doc editor to busabase's own Asset library
 * (`assets.createUploadUrl`/`assets.confirm` — space-scoped, mints a real
 * `busabase_assets` row) rather than a plain attachment. Mirrors the
 * `useMutation` + `useS3Uploader` pairing Busabase Cloud uses for its own
 * S3 uploads.
 *
 * **Returns the asset's stable content URL, not the resolved storage URL.**
 * Whatever this returns is what Milkdown/Crepe serializes into the saved
 * markdown (`![](…)`) — i.e. it becomes durable user content. A resolved
 * storage URL pins that content to the storage route and backend configured at
 * the moment of upload: a body written in dev over the S3 adapter carries
 * `/api/dev/attachment/…` and shows broken images in a production build, and a
 * body written on local disk breaks the day the space moves to S3/R2.
 * `/api/assets/{assetId}/raw` names the ASSET and lets the server resolve the
 * location on every read. See `assets/utils/asset-content-url.ts`.
 *
 * Old bodies are NOT migrated: `busabase_commits.fields.body` is append-only,
 * and `syncDocAssetUsages` still indexes the legacy storage-URL form, so
 * existing Docs keep behaving exactly as they did.
 */
export function useDocImageUpload(orpc: BusabaseQueryUtils) {
  const requestUploadUrl = useMutation(orpc.assets.createUploadUrl.mutationOptions());
  const confirmUpload = useMutation(orpc.assets.confirm.mutationOptions());

  const { uploadFile } = useS3Uploader<Record<string, unknown>>({
    requestUploadUrl: (input) => requestUploadUrl.mutateAsync(input),
    confirmUpload: (input) => confirmUpload.mutateAsync(input),
    options: { context: "doc" },
  });

  return async (file: File): Promise<string> => {
    const { assetId, publicUrl } = await uploadFile(file);
    // `assets.confirm` always mints an asset (and `createUploadUrl` mints one on
    // a dedup hit), so `assetId` is present in practice. Falling back to the
    // resolved storage URL rather than throwing keeps a successful upload
    // visible to the user if a host ever answers without one — degraded to
    // today's behavior, not a lost image.
    return assetId ? buildAssetContentUrl(assetId) : publicUrl;
  };
}
