import type { AttachmentRef } from "busabase-contract/types";

/** Parse an `attachment` field value (array of denormalized refs) defensively. */
export function getAttachmentRefs(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is AttachmentRef =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as AttachmentRef).url === "string" &&
      typeof (item as AttachmentRef).fileName === "string",
  );
}

export function isImageRef(ref: { mimeType?: string }): boolean {
  return typeof ref.mimeType === "string" && ref.mimeType.startsWith("image/");
}

/**
 * Resolve a possibly-relative attachment/asset URL against the connected server.
 * The self-hosted server returns dev-route paths like `/api/dev/attachment/...`;
 * on mobile we must prefix them with the server origin to load the bytes.
 */
export function resolveAttachmentUrl(serverUrl: string | null, url: string): string {
  if (!url || /^https?:\/\//i.test(url) || url.startsWith("data:")) {
    return url;
  }
  if (!serverUrl) {
    return url;
  }
  const base = serverUrl.replace(/\/+$/, "");
  return url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
}
