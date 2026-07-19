/**
 * Core S3 upload hook (open-domains) — decoupled from transport; accepts the
 * request/confirm API functions as props. Copy of
 * `share-domains/attachments/hooks`.
 */

import { useCallback, useState } from "react";

export interface UploadProgress {
  /** File name currently being uploaded */
  fileName: string;
  /** Progress percentage 0-100 */
  percent: number;
  /** Bytes uploaded so far */
  loaded: number;
  /** Total bytes to upload */
  total: number;
}

export interface UploadToS3Options<TMetadata = unknown> {
  /** Path context for organizing files in storage */
  context?: string;
  /** Optional space ID for quota tracking */
  spaceId?: string;
  /** Optional metadata for tracking */
  metadata?: TMetadata;
}

export interface RequestUploadUrlInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  context?: string;
  spaceId?: string;
  /** Content fingerprint (e.g. "sha256:<hex>") for server-side dedup. */
  contentHash?: string;
}

export interface RequestUploadUrlResult {
  uploadUrl: string;
  publicUrl: string;
  storageKey: string;
  /** Identical file already stored — skip the byte upload and confirm step. */
  duplicate?: boolean;
  /** Existing attachment id — present only when `duplicate` is true. */
  attachmentId?: string;
}

export interface ConfirmUploadInput<TMetadata = unknown> {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  context?: string;
  spaceId?: string;
  metadata?: TMetadata;
  /** Content fingerprint (e.g. "sha256:<hex>") persisted for dedup. */
  contentHash?: string;
}

export interface ConfirmUploadResult {
  publicUrl: string;
  attachmentId: string;
}

export interface UseS3UploaderProps<TMetadata = unknown> {
  /** API function to request upload URL */
  requestUploadUrl: (input: RequestUploadUrlInput) => Promise<RequestUploadUrlResult>;
  /** API function to confirm upload */
  confirmUpload: (input: ConfirmUploadInput<TMetadata>) => Promise<ConfirmUploadResult>;
  /** Upload options */
  options?: UploadToS3Options<TMetadata>;
}

export function useS3Uploader<TMetadata = unknown>({
  requestUploadUrl,
  confirmUpload,
  options = {},
}: UseS3UploaderProps<TMetadata>) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const uploadWithProgress = useCallback(
    (url: string, body: FormData | File, headers?: Record<string, string>, fileName?: string) => {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const method = body instanceof FormData ? "POST" : "PUT";
        xhr.open(method, url);

        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
          }
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress({
              fileName: fileName ?? "",
              percent,
              loaded: event.loaded,
              total: event.total,
            });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error("Upload failed due to network error"));
        xhr.onabort = () => reject(new Error("Upload was aborted"));

        xhr.send(body);
      });
    },
    [],
  );

  const uploadFile = async (file: File): Promise<{ publicUrl: string; attachmentId: string }> => {
    setIsUploading(true);
    setUploadProgress({ fileName: file.name, percent: 0, loaded: 0, total: file.size });

    try {
      const contentHash = await sha256Hex(file);

      const { uploadUrl, storageKey, publicUrl, duplicate, attachmentId } = await requestUploadUrl({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        context: options.context,
        spaceId: options.spaceId,
        contentHash,
      });

      // Dedup hit: identical bytes already stored — reuse it, no upload/confirm.
      if (duplicate && attachmentId) {
        setUploadProgress({
          fileName: file.name,
          percent: 100,
          loaded: file.size,
          total: file.size,
        });
        return { publicUrl, attachmentId };
      }

      // One uniform path: PUT the raw bytes to whatever URL the server handed us
      // — an S3 presigned URL or the local dev relay. The client never branches on
      // where it's uploading; the server absorbed that difference.
      await uploadWithProgress(
        uploadUrl,
        file,
        { "Content-Type": file.type || "application/octet-stream" },
        file.name,
      );

      setUploadProgress({ fileName: file.name, percent: 100, loaded: file.size, total: file.size });

      const result = await confirmUpload({
        storageKey,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        context: options.context,
        spaceId: options.spaceId,
        metadata: options.metadata,
        contentHash,
      });

      return { publicUrl: result.publicUrl, attachmentId: result.attachmentId };
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  return { uploadFile, isUploading, uploadProgress };
}

/**
 * Compute a "sha256:<hex>" content fingerprint for a file using the Web Crypto
 * API (SubtleCrypto). Available in secure contexts (https + localhost). Used to
 * dedup uploads: identical bytes hash to the same value, so the server can
 * return an existing attachment instead of storing a duplicate object.
 */
export async function sha256Hex(file: File): Promise<string | undefined> {
  // Web Crypto needs a secure context (https / localhost). If it's unavailable
  // (plain http, or an environment without SubtleCrypto), skip the fingerprint —
  // uploads still work, just without content-hash dedup.
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return undefined;
  }
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `sha256:${hex}`;
  } catch {
    return undefined;
  }
}

/** Convert a blob URL to a File object. */
export async function blobUrlToFile(blobUrl: string, filename: string): Promise<File> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}
