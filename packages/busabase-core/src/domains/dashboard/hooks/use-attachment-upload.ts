import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { MULTIPART_UPLOAD_THRESHOLD } from "open-domains/attachments/utils";
import { useCallback } from "react";
import { completeAttachmentUpload } from "../helpers/attachment-upload";
import { uploadMultipartParts } from "../helpers/multipart-upload";
import {
  assertFileWithinLimit,
  type UploadLimits,
  useUploadLimits,
  withFileTooLargeReporting,
} from "./use-upload-limits";

/** Optional per-upload callbacks. */
export interface AttachmentUploadOptions {
  /**
   * 0–100 while a multipart upload (files above `MULTIPART_UPLOAD_THRESHOLD`)
   * is in flight. A single-PUT upload is small enough to finish without it.
   */
  onProgress?: (percent: number) => void;
}

/**
 * Upload a file for a Base file field: request asset URL → push bytes (dev
 * route or presigned PUT) → confirm (writes the storage registry row and
 * busabase_assets) → return the asset-backed inline ref stored in the record.
 * Files above `MULTIPART_UPLOAD_THRESHOLD` are uploaded in parts instead.
 *
 * `limits` overrides the context value for callers that render ABOVE the
 * dashboard's `UploadLimitsProvider` (the dashboard root itself).
 */
export function useAttachmentUpload(client: BusabaseDashboardApiClient, limits?: UploadLimits) {
  const contextLimits = useUploadLimits();
  const effectiveLimits = limits ?? contextLimits;
  return useCallback(
    async (file: File, context = "record-field", options?: AttachmentUploadOptions) =>
      withFileTooLargeReporting(effectiveLimits, async () => {
        assertFileWithinLimit(file, effectiveLimits.maxFileSize);
        return completeAttachmentUpload(
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
            multipart: {
              thresholdBytes: MULTIPART_UPLOAD_THRESHOLD,
              create: (input) => client.createAssetMultipartUpload(input),
              uploadParts: (created) =>
                uploadMultipartParts({
                  file,
                  upload: created,
                  signParts: (input) => client.signAssetMultipartParts(input),
                  onProgress: options?.onProgress,
                }),
              complete: (input) => client.completeAssetMultipartUpload(input),
              abort: (input) => client.abortAssetMultipartUpload(input),
            },
          },
        );
      }),
    [client, effectiveLimits],
  );
}
