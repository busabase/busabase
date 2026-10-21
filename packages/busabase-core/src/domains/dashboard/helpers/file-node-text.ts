// Whether a File node's text can be shown the way a Drive file tree shows it —
// Markdown rendered, code and plain text highlighted — instead of an "Open file"
// link. A File node is always an uploaded asset (a Drive keeps its text in the
// database), so the text comes from the asset's text slot, read on the server
// (`assets.readTextLines`): the asset's storage URL may be on another origin.

import { resolveFileTreePreviewKind } from "./file-tree-files";

/** Above this, a File node keeps the "Open file" link rather than load the text. */
export const FILE_NODE_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
/** Lines requested in one read; the server caps a read at this many. */
export const FILE_NODE_TEXT_PREVIEW_MAX_LINES = 2000;

export type FileNodeTextKind = "markdown" | "code";

export interface FileNodeTextAsset {
  name: string;
  mimeType: string;
  contentKind: "text" | "binary";
  textStatus: string | null;
  size: number;
}

/** "markdown" / "code" for a text asset small enough to preview, else null. */
export const fileNodeTextKind = (asset: FileNodeTextAsset): FileNodeTextKind | null => {
  if (asset.contentKind !== "text" || asset.textStatus !== "present") return null;
  if (asset.size > FILE_NODE_TEXT_PREVIEW_MAX_BYTES) return null;
  const kind = resolveFileTreePreviewKind(asset.name, asset.mimeType);
  // Images (an SVG is text too), video, audio and PDF keep their media preview.
  return kind === "markdown" || kind === "code" ? kind : null;
};

/**
 * The whole text from one read, or null when it is not all there (cut at the
 * line cap) or not UTF-8 (decoded with replacement characters) — the File node
 * then keeps its "Open file" link.
 */
export const fileNodeTextContent = (read: {
  lines: string[];
  endLine: number;
  totalLines: number;
  truncated: boolean;
}): string | null => {
  if (read.truncated || read.totalLines > read.endLine) return null;
  const content = read.lines.join("\n");
  return content.includes("�") ? null : content;
};
