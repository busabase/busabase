"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { sha256Hex } from "open-domains/attachments/hooks";
import { useCallback } from "react";
import { completeAttachmentUpload } from "../helpers/attachment-upload";
import { inferFileTreeMimeType } from "../helpers/file-tree-files";

export function useFileTreeAssetUpload(orpc: BusabaseQueryUtils) {
  const createUploadUrl = useMutation(orpc.assets.createUploadUrl.mutationOptions());
  const confirmUpload = useMutation(orpc.assets.confirm.mutationOptions());

  return useCallback(
    async (file: File) => {
      const mimeType = inferFileTreeMimeType(file.name, file.type);
      const contentHash = await sha256Hex(file);
      return completeAttachmentUpload(
        {
          contentHash,
          context: "file-tree",
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
        },
        {
          createUploadUrl: (input) => createUploadUrl.mutateAsync(input),
          uploadBytes: async (requested) => {
            if (requested.uploadUrl.startsWith("/")) {
              const form = new FormData();
              form.append("file", file);
              form.append("storageKey", requested.storageKey);
              const response = await fetch(requested.uploadUrl, { body: form, method: "POST" });
              if (!response.ok) throw new Error(`Upload failed (${response.status})`);
              return;
            }
            const response = await fetch(requested.uploadUrl, {
              body: file,
              headers: { "content-type": mimeType },
              method: "PUT",
            });
            if (!response.ok) throw new Error(`Upload failed (${response.status})`);
          },
          confirmUpload: (input) => confirmUpload.mutateAsync(input),
        },
      );
    },
    [confirmUpload, createUploadUrl],
  );
}
