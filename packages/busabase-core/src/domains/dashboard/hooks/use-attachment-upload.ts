import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { useCallback } from "react";
import { completeAttachmentUpload } from "../helpers/attachment-upload";

/**
 * Upload a file for a Base file field: request asset URL → push bytes (dev
 * route or presigned PUT) → confirm (writes the storage registry row and
 * busabase_assets) → return the asset-backed inline ref stored in the record.
 */
export function useAttachmentUpload(client: BusabaseDashboardApiClient) {
  return useCallback(
    async (file: File, context = "record-field") =>
      completeAttachmentUpload(
        {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          context,
        },
        {
          createUploadUrl: (input) => client.createAssetUploadUrl(input),
          uploadBytes: async (requested) => {
            if (requested.uploadUrl.startsWith("/")) {
              const form = new FormData();
              form.append("file", file);
              form.append("storageKey", requested.storageKey);
              const response = await fetch(requested.uploadUrl, { method: "POST", body: form });
              if (!response.ok) throw new Error(`Upload failed (${response.status})`);
              return;
            }
            const response = await fetch(requested.uploadUrl, {
              body: file,
              headers: { "content-type": file.type || "application/octet-stream" },
              method: "PUT",
            });
            if (!response.ok) throw new Error(`Upload failed (${response.status})`);
          },
          confirmUpload: (input) => client.confirmAsset(input),
        },
      ),
    [client],
  );
}
