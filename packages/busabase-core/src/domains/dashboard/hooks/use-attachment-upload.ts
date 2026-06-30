import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { AttachmentRef } from "open-domains/attachments/types";
import { useCallback } from "react";

/**
 * Upload a file for an `attachment` field: request URL → push bytes (dev route
 * or presigned PUT) → confirm (writes busabase_attachments) → return the inline ref
 * stored in the record's field value.
 */
export function useAttachmentUpload(client: BusabaseDashboardApiClient) {
  return useCallback(
    async (file: File): Promise<AttachmentRef> => {
      const mimeType = file.type || "application/octet-stream";
      const requested = await client.createAttachmentUploadUrl({
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        context: "record-field",
      });
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
      const confirmed = await client.confirmAttachment({
        storageKey: requested.storageKey,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        context: "record-field",
      });
      return {
        id: confirmed.attachmentId,
        url: confirmed.publicUrl,
        fileName: file.name,
        mimeType,
        size: file.size,
      };
    },
    [client],
  );
}
