import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import type { AttachmentUploadOptions } from "./use-attachment-upload";
import { assertFileWithinLimit, useUploadLimits } from "./use-upload-limits";

export type FieldFileUploader = (
  file: File,
  options?: AttachmentUploadOptions,
) => Promise<AssetAttachmentRef>;

/**
 * The upload half every file-holding field editor shares (`attachment` and
 * `drive`): the field's `options.attachment` limits (accept / maxFiles /
 * maxFileSize), one file at a time with progress, and an inline error. The
 * editor only decides WHERE the uploaded refs go — appended to a flat list, or
 * into a folder of a drive cell — through the `add` it passes to `merge`.
 */
export function useFieldFileUpload(field: BaseFieldVO, onUploadAttachment?: FieldFileUploader) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const uploadLimits = useUploadLimits();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const options = field.options.attachment ?? {};
  const multiple = options.maxFiles !== 1;
  const accept = options.allowedMimeTypes?.join(",");
  // A field's own `maxFileSize` can only TIGHTEN the host/plan limit. When the
  // field is the binding one, upgrading would not help, so the refusal stays
  // inline and never reaches the host's upgrade prompt (the upload hook
  // reports host-limit refusals itself).
  const fieldMaxFileSize =
    typeof options.maxFileSize === "number" && options.maxFileSize < uploadLimits.maxFileSize
      ? options.maxFileSize
      : null;

  /**
   * Upload every picked file, then hand all the refs to `commit` at once.
   * Nothing is committed when any file fails, and every file is size-checked
   * before the first byte goes out, so one oversized file never leaves the
   * others half-uploaded.
   */
  const upload = async (
    fileList: FileList | readonly File[] | null,
    commit: (uploaded: AssetAttachmentRef[]) => void,
  ) => {
    if (!fileList || fileList.length === 0 || !onUploadAttachment) {
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    setUploadPercent(null);
    try {
      const files = Array.from(fileList);
      if (fieldMaxFileSize !== null) {
        for (const file of files) assertFileWithinLimit(file, fieldMaxFileSize);
      }
      const uploaded: AssetAttachmentRef[] = [];
      for (const file of files) {
        uploaded.push(await onUploadAttachment(file, { onProgress: setUploadPercent }));
        setUploadPercent(null);
      }
      commit(uploaded);
    } catch (error) {
      setUploadError(presentCoreError(messages, locale, error, messages.recordView.uploadFailed));
    } finally {
      setIsUploading(false);
      setUploadPercent(null);
    }
  };

  /**
   * The field's file-count rule: a one-file field (`maxFiles: 1`) replaces its
   * file with the newest upload, any other field gains the uploads, and a
   * `maxFiles` limit keeps the newest files.
   */
  const merge = <E, R>(
    existing: readonly E[],
    uploaded: readonly AssetAttachmentRef[],
    add: (existing: readonly E[], uploaded: readonly AssetAttachmentRef[]) => R[],
  ): R[] => {
    const next = multiple ? add(existing, uploaded) : add([], uploaded.slice(-1));
    return options.maxFiles && options.maxFiles > 0 ? next.slice(-options.maxFiles) : next;
  };

  const label = isUploading
    ? uploadPercent === null
      ? messages.recordView.uploading
      : `${messages.recordView.uploading} ${Math.floor(uploadPercent)}%`
    : messages.recordView.addFile;

  return {
    accept,
    canUpload: Boolean(onUploadAttachment),
    isUploading,
    label,
    merge,
    multiple,
    upload,
    uploadError,
  };
}
