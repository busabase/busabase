"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useS3Uploader } from "open-domains/attachments/hooks";

/**
 * Wires image paste/upload in the Doc editor to busabase's own Asset library
 * (`assets.createUploadUrl`/`assets.confirm` — space-scoped, mints a real
 * `busabase_assets` row) rather than a plain attachment, so the existing
 * `syncDocAssetUsages` reverse-index scanner picks up the reference once the
 * saved body's markdown image src contains the returned `publicUrl`'s
 * storage key. Mirrors `apps/busabase-cloud/src/hooks/upload/upload-to-s3.ts`'s
 * `useMutation` + `useS3Uploader` pairing.
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
    const { publicUrl } = await uploadFile(file);
    return publicUrl;
  };
}
