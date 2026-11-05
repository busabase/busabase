import type { AssetAttachmentRef } from "busabase-contract/types";
import type {
  AbortMultipartUploadDTO,
  CompleteMultipartUploadDTO,
  ConfirmUploadDTO,
  ConfirmUploadVO,
  CreateMultipartUploadVO,
  RequestUploadUrlDTO,
  RequestUploadUrlVO,
} from "open-domains/attachments/types";

export interface AttachmentUploadInput extends RequestUploadUrlDTO {
  metadata?: ConfirmUploadDTO["metadata"];
}

/**
 * Optional large-file path. A platform that can slice a file and PUT the parts
 * supplies it; files above `thresholdBytes` then go create → parts → complete.
 * Platforms that cannot (or do not need to) simply omit it and every file keeps
 * the single-PUT path. (This module stays type-only on purpose: React Native
 * imports it, so the threshold arrives from the adapter rather than a value
 * import.)
 */
export interface AttachmentMultipartAdapter {
  /** Use multipart for files strictly larger than this (`MULTIPART_UPLOAD_THRESHOLD`). */
  thresholdBytes: number;
  create: (input: RequestUploadUrlDTO) => Promise<CreateMultipartUploadVO>;
  /** Push every part's bytes; resolve with their ETags. */
  uploadParts: (created: CreateMultipartUploadVO) => Promise<void>;
  complete: (input: CompleteMultipartUploadDTO) => Promise<ConfirmUploadVO>;
  abort: (input: AbortMultipartUploadDTO) => Promise<unknown>;
}

export interface AttachmentUploadAdapter {
  createUploadUrl: (input: RequestUploadUrlDTO) => Promise<RequestUploadUrlVO>;
  uploadBytes: (request: RequestUploadUrlVO) => Promise<void>;
  confirmUpload: (input: ConfirmUploadDTO) => Promise<ConfirmUploadVO>;
  multipart?: AttachmentMultipartAdapter;
}

const toAttachmentRef = (
  uploaded: Pick<ConfirmUploadVO, "assetId" | "attachmentId" | "publicUrl">,
  input: RequestUploadUrlDTO,
): AssetAttachmentRef => ({
  id: uploaded.assetId ?? uploaded.attachmentId,
  assetId: uploaded.assetId,
  attachmentId: uploaded.attachmentId,
  url: uploaded.publicUrl,
  fileName: input.fileName,
  mimeType: input.mimeType,
  size: input.sizeBytes,
});

const confirmFields = (
  input: RequestUploadUrlDTO,
  storageKey: string,
  metadata: ConfirmUploadDTO["metadata"],
): ConfirmUploadDTO => ({
  storageKey,
  fileName: input.fileName,
  mimeType: input.mimeType,
  sizeBytes: input.sizeBytes,
  spaceId: input.spaceId,
  context: input.context,
  contentHash: input.contentHash,
  metadata,
});

async function completeMultipartAttachmentUpload(
  input: RequestUploadUrlDTO,
  metadata: ConfirmUploadDTO["metadata"],
  multipart: AttachmentMultipartAdapter,
): Promise<AssetAttachmentRef> {
  const created = await multipart.create(input);
  if (created.duplicate && created.attachmentId) {
    return toAttachmentRef(
      {
        assetId: created.assetId,
        attachmentId: created.attachmentId,
        publicUrl: created.publicUrl,
      },
      input,
    );
  }

  try {
    await multipart.uploadParts(created);
  } catch (error) {
    // Failed or cancelled: release the parts already stored. Best effort — the
    // original error is what the user needs to see.
    await multipart
      .abort({ storageKey: created.storageKey, uploadId: created.uploadId, spaceId: input.spaceId })
      .catch(() => {});
    throw error;
  }

  const confirmed = await multipart.complete({
    ...confirmFields(input, created.storageKey, metadata),
    uploadId: created.uploadId,
  });
  return toAttachmentRef(confirmed, input);
}

/** Share upload orchestration while each platform owns how bytes reach the upload URL. */
export async function completeAttachmentUpload(
  { metadata, ...input }: AttachmentUploadInput,
  adapter: AttachmentUploadAdapter,
): Promise<AssetAttachmentRef> {
  if (adapter.multipart && input.sizeBytes > adapter.multipart.thresholdBytes) {
    return completeMultipartAttachmentUpload(input, metadata, adapter.multipart);
  }

  const requested = await adapter.createUploadUrl(input);
  if (requested.duplicate && requested.attachmentId) {
    return toAttachmentRef(
      {
        assetId: requested.assetId,
        attachmentId: requested.attachmentId,
        publicUrl: requested.publicUrl,
      },
      input,
    );
  }

  await adapter.uploadBytes(requested);
  const confirmed = await adapter.confirmUpload(
    confirmFields(input, requested.storageKey, metadata),
  );
  return toAttachmentRef(confirmed, input);
}
