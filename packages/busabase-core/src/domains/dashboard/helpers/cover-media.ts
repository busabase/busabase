import { getAttachmentRefs, getSafeAttachmentUrl } from "./field";

/** What a card's cover slot can draw from an attachment cell. */
export interface CoverMedia {
  kind: "image" | "video";
  url: string;
  fileName: string;
}

/**
 * Pick the attachment a Gallery card or Kanban cover shows.
 *
 * Images win over videos: a record that carries both is almost always a video
 * plus its poster frame, and existing boards already show that image. A video
 * is only the cover when the cell has no usable image — which is exactly the
 * case that used to render an empty card.
 */
export const pickCoverMedia = (value: unknown): CoverMedia | null => {
  let video: CoverMedia | null = null;
  for (const attachment of getAttachmentRefs(value)) {
    const url = getSafeAttachmentUrl(attachment);
    if (!url) continue;
    if (attachment.mimeType.startsWith("image/")) {
      return { kind: "image", url, fileName: attachment.fileName };
    }
    if (!video && attachment.mimeType.startsWith("video/")) {
      video = { kind: "video", url, fileName: attachment.fileName };
    }
  }
  return video;
};

/**
 * The URL a cover `<video>` loads. The `#t=` media fragment makes browsers
 * (iOS Safari in particular) seek to and paint a real frame instead of a black
 * box when only metadata is preloaded. A URL that already has a fragment is
 * left alone rather than given a second `#`.
 */
export const toVideoCoverSrc = (url: string): string => (url.includes("#") ? url : `${url}#t=0.1`);
