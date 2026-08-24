import type { AssetAttachmentRef } from "busabase-contract/types";
import type {
  ConfirmUploadDTO,
  ConfirmUploadVO,
  RequestUploadUrlDTO,
  RequestUploadUrlVO,
} from "open-domains/attachments/types";

export interface AttachmentUploadInput extends RequestUploadUrlDTO {
  metadata?: ConfirmUploadDTO["metadata"];
}

export interface AttachmentUploadAdapter {
  createUploadUrl: (input: RequestUploadUrlDTO) => Promise<RequestUploadUrlVO>;
  uploadBytes: (request: RequestUploadUrlVO) => Promise<void>;
  confirmUpload: (input: ConfirmUploadDTO) => Promise<ConfirmUploadVO>;
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

/** Share upload orchestration while each platform owns how bytes reach the upload URL. */
export async function completeAttachmentUpload(
  { metadata, ...input }: AttachmentUploadInput,
  adapter: AttachmentUploadAdapter,
): Promise<AssetAttachmentRef> {
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
  const confirmed = await adapter.confirmUpload({
    storageKey: requested.storageKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    spaceId: input.spaceId,
    context: input.context,
    contentHash: input.contentHash,
    metadata,
  });
  return toAttachmentRef(confirmed, input);
}
