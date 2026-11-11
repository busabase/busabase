/** Bounded, strict UTF-8 text previews shared by every host. */
export const TEXT_ATTACHMENT_MAX_BYTES = 1024 * 1024;

export type TextAttachmentErrorKind = "failed" | "encoding" | "tooLarge" | "timedOut";

export class TextAttachmentError extends Error {
  constructor(readonly kind: TextAttachmentErrorKind) {
    super(kind);
    this.name = "TextAttachmentError";
  }
}

/** Fatal decoding preserves valid U+FFFD text but never silently substitutes bad bytes. */
export const decodeTextChunk = (decoder: TextDecoder, bytes?: Uint8Array): string => {
  try {
    const text = bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    // A zero byte commonly means a binary or BOM-less UTF-16 file, not UTF-8 text.
    if (text.includes("\0")) throw new Error("Binary text");
    return text;
  } catch {
    throw new TextAttachmentError("encoding");
  }
};
