import { detectFileType, FileType } from "previewfile-core/utils/file-types";

export type { TextAttachmentErrorKind } from "previewfile-core/utils/text-preview";
export {
  decodeTextChunk,
  TEXT_ATTACHMENT_MAX_BYTES,
  TextAttachmentError,
} from "previewfile-core/utils/text-preview";

export type AttachmentTextKind = "markdown" | "text";
export const isMarkdownAttachment = (file: { fileName: string; mimeType: string }) =>
  detectFileType(file) === FileType.MARKDOWN;
export const attachmentTextKind = (file: {
  fileName: string;
  mimeType: string;
}): AttachmentTextKind | null => {
  const type = detectFileType(file);
  return type === FileType.MARKDOWN
    ? "markdown"
    : type === FileType.CODE || type === FileType.TEXT
      ? "text"
      : null;
};
