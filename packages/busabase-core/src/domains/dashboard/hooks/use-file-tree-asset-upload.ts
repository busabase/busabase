"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { sha256Hex } from "open-domains/attachments/hooks";
import { useCallback } from "react";
import { completeAttachmentUpload } from "../helpers/attachment-upload";
import { inferFileTreeMimeType } from "../helpers/file-tree-files";
import { createFileUploadAbortError, throwIfFileUploadAborted } from "../helpers/file-upload-task";

export interface FileTreeAssetUploadOptions {
  signal?: AbortSignal;
  onPhase?: (phase: "hashing" | "uploading" | "confirming") => void;
  onProgress?: (progress: number) => void;
}

const uploadFileBytes = async ({
  file,
  mimeType,
  onProgress,
  signal,
  storageKey,
  uploadUrl,
}: {
  file: File;
  mimeType: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  storageKey: string;
  uploadUrl: string;
}): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createFileUploadAbortError());
      return;
    }

    const request = new XMLHttpRequest();
    const handleAbort = () => request.abort();
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      cleanup();
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(`Upload failed (${request.status})`));
    });
    request.addEventListener("error", () => {
      cleanup();
      reject(new Error("Upload failed (network error)"));
    });
    request.addEventListener("abort", () => {
      cleanup();
      reject(createFileUploadAbortError());
    });
    signal?.addEventListener("abort", handleAbort, { once: true });

    if (uploadUrl.startsWith("/")) {
      const form = new FormData();
      form.append("file", file);
      form.append("storageKey", storageKey);
      request.open("POST", uploadUrl);
      request.send(form);
      return;
    }

    request.open("PUT", uploadUrl);
    request.setRequestHeader("content-type", mimeType);
    request.send(file);
  });

export function useFileTreeAssetUpload(orpc: BusabaseQueryUtils) {
  const createUploadUrl = useMutation(orpc.assets.createUploadUrl.mutationOptions());
  const confirmUpload = useMutation(orpc.assets.confirm.mutationOptions());

  return useCallback(
    async (file: File, options: FileTreeAssetUploadOptions = {}) => {
      const { signal, onPhase, onProgress } = options;
      if (signal) throwIfFileUploadAborted(signal);
      const mimeType = inferFileTreeMimeType(file.name, file.type);
      onPhase?.("hashing");
      const contentHash = await sha256Hex(file);
      if (signal) throwIfFileUploadAborted(signal);
      return completeAttachmentUpload(
        {
          contentHash,
          context: "file-tree",
          fileName: file.name,
          mimeType,
          sizeBytes: file.size,
        },
        {
          createUploadUrl: async (input) => {
            const requested = await createUploadUrl.mutateAsync(input);
            if (signal) throwIfFileUploadAborted(signal);
            return requested;
          },
          uploadBytes: async (requested) => {
            onPhase?.("uploading");
            await uploadFileBytes({
              file,
              mimeType,
              onProgress,
              signal,
              storageKey: requested.storageKey,
              uploadUrl: requested.uploadUrl,
            });
          },
          confirmUpload: async (input) => {
            if (signal) throwIfFileUploadAborted(signal);
            onPhase?.("confirming");
            const confirmed = await confirmUpload.mutateAsync(input);
            if (signal) throwIfFileUploadAborted(signal);
            return confirmed;
          },
        },
      );
    },
    [confirmUpload, createUploadUrl],
  );
}
