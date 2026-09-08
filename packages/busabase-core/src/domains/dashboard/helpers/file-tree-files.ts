import type { FileTreeFileVO } from "busabase-contract/types";

export type FileTreePreviewKind = "markdown" | "image" | "video" | "audio" | "pdf" | "code";

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  md: "text/markdown",
  markdown: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  webm: "video/webm",
  webp: "image/webp",
};

export const fileTreeFileName = (path: string): string => path.split("/").at(-1) ?? path;

export const fileTreeParentPath = (path: string): string => path.split("/").slice(0, -1).join("/");

export const normalizeFileTreeFolder = (value: string): string =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

export const fileTreeUploadPath = (folder: string, fileName: string): string => {
  const normalizedFolder = normalizeFileTreeFolder(folder);
  return normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
};

/**
 * MIME types that tell us nothing about how to render a file. `text/plain` is
 * in here because the backend labels every text-shaped upload that way, so an
 * `.svg` comes back as `text/plain; charset=utf-8` and would be shown as source
 * instead of an image. For these, the extension is the better signal.
 */
const UNINFORMATIVE_MIME_TYPES = new Set(["application/octet-stream", "text/plain"]);

export const inferFileTreeMimeType = (fileName: string, mimeType?: string | null): string => {
  const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalized && !UNINFORMATIVE_MIME_TYPES.has(normalized)) return normalized;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? normalized ?? "application/octet-stream";
};

export const resolveFileTreePreviewKind = (path: string, mimeType: string): FileTreePreviewKind => {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const inferredMime = inferFileTreeMimeType(path, mimeType);
  if (extension === "md" || extension === "markdown" || inferredMime === "text/markdown") {
    return "markdown";
  }
  if (inferredMime.startsWith("image/")) return "image";
  if (inferredMime.startsWith("video/")) return "video";
  if (inferredMime.startsWith("audio/")) return "audio";
  if (inferredMime === "application/pdf") return "pdf";
  return "code";
};

export const validateFileTreePath = (path: string): string | null => {
  if (!path || path.startsWith("/")) return "relative";
  if (
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return "invalid";
  }
  if (fileTreeFileName(path).length > 255) return "tooLong";
  return null;
};

export const validateFileTreeFolder = (folder: string): string | null => {
  const value = folder.trim().replace(/\\/g, "/");
  if (!value) return null;
  if (value.startsWith("/")) return "relative";
  if (value.split("/").some((part) => part === "." || part === "..")) return "invalid";
  return null;
};

export const validateFileTreeName = (name: string): string | null => {
  const value = name.trim();
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) return "invalid";
  if (value.length > 255) return "tooLong";
  return null;
};

export const formatFileTreeBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  // Drive accepts large binaries, so stop at GB instead of letting a multi-GB
  // upload render as "2048.0 MB". Drop the decimal once the number is big
  // enough that the tenth stops carrying information.
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 * 1024 ? 0 : 1)} GB`;
};

export const buildFileTreeRenameOperations = (
  file: Pick<FileTreeFileVO, "assetId" | "displayName" | "mimeType" | "path">,
  nextName: string,
  contentHash?: string,
) => {
  const parentPath = fileTreeParentPath(file.path);
  const nextPath = fileTreeUploadPath(parentPath, nextName.trim());
  return {
    nextPath,
    operations: [
      {
        kind: "create" as const,
        path: nextPath,
        assetId: file.assetId,
        displayName: nextName.trim(),
        mimeType: inferFileTreeMimeType(nextPath, file.mimeType),
      },
      {
        kind: "delete" as const,
        path: file.path,
        ...(contentHash ? { baseContentHash: contentHash } : {}),
      },
    ],
  };
};
