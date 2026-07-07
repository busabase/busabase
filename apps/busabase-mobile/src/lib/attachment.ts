import type { AssetAttachmentRef } from "busabase-contract/types";

/** Parse an `attachment` field value (array of denormalized refs) defensively. */
export function getAttachmentRefs(value: unknown): AssetAttachmentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is AssetAttachmentRef =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as AssetAttachmentRef).url === "string" &&
      typeof (item as AssetAttachmentRef).fileName === "string",
  );
}

export function isImageRef(ref: { mimeType?: string }): boolean {
  return typeof ref.mimeType === "string" && ref.mimeType.startsWith("image/");
}

export function getAttachmentKindLabel(ref: { mimeType?: string; fileName?: string }): string {
  const mimeType = ref.mimeType?.toLowerCase() ?? "";
  const fileName = ref.fileName?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) {
    return "Image";
  }
  if (mimeType.startsWith("video/")) {
    return "Video";
  }
  if (mimeType.startsWith("audio/")) {
    return "Audio";
  }
  if (mimeType === "application/pdf" || fileName.endsWith(".pdf")) {
    return "PDF";
  }
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    [".csv", ".xls", ".xlsx"].some((suffix) => fileName.endsWith(suffix))
  ) {
    return "Spreadsheet";
  }
  if (
    mimeType.includes("presentation") ||
    [".ppt", ".pptx", ".key"].some((suffix) => fileName.endsWith(suffix))
  ) {
    return "Presentation";
  }
  if (
    mimeType.includes("word") ||
    [".doc", ".docx", ".pages"].some((suffix) => fileName.endsWith(suffix))
  ) {
    return "Document";
  }
  if (
    mimeType.startsWith("text/") ||
    [".md", ".txt", ".json"].some((suffix) => fileName.endsWith(suffix))
  ) {
    return "Text file";
  }
  return "File";
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
