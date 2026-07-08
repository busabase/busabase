import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { AssetAttachmentRef } from "busabase-contract/types";
import { useCallback } from "react";

/**
 * Upload a file for a Base file field: request asset URL → push bytes (dev
 * route or presigned PUT) → confirm (writes the storage registry row and
 * busabase_assets) → return the asset-backed inline ref stored in the record.
 */
export function useAttachmentUpload(client: BusabaseDashboardApiClient) {
  return useCallback(
    async (file: File, context = "record-field"): Promise<AssetAttachmentRef> => {
      const mimeType = file.type || "application/octet-stream";
      const requested = await client.createAssetUploadUrl({
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        context,
      });
      if (requested.duplicate && requested.attachmentId) {
        return {
          id: requested.assetId ?? requested.attachmentId,
          assetId: requested.assetId,
          attachmentId: requested.attachmentId,
          url: requested.publicUrl,
          fileName: file.name,
          mimeType,
          size: file.size,
        };
      }
      if (requested.uploadUrl.startsWith("/")) {
        const form = new FormData();
        form.append("file", file);
        form.append("storageKey", requested.storageKey);
        const response = await fetch(requested.uploadUrl, { method: "POST", body: form });
        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }
      } else {
        const response = await fetch(requested.uploadUrl, {
          body: file,
          headers: { "content-type": mimeType },
          method: "PUT",
        });
        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }
      }
      const confirmed = await client.confirmAsset({
        storageKey: requested.storageKey,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        context,
      });
      return {
        id: confirmed.assetId ?? confirmed.attachmentId,
        assetId: confirmed.assetId,
        attachmentId: confirmed.attachmentId,
        url: confirmed.publicUrl,
        fileName: file.name,
        mimeType,
        size: file.size,
      };
    },
    [client],
  );
}
