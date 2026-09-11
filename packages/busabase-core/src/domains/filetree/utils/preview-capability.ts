// Pure and isomorphic on purpose: the server routes previews with it, and the
// Dashboard uses the same predicate to skip a round trip it already knows the
// answer to. Nothing here may reach for the db, storage, or React.

import { inferFileTreeMimeType } from "../../dashboard/helpers/file-tree-files";

/**
 * The formats a configured provider is asked to take over.
 *
 * Deliberately an escalation allowlist, not a "can builtin do it?" test, and the
 * direction matters twice over:
 *
 *   - **Privacy defaults to local.** Anything unrecognized stays inside the
 *     deployment. Getting the list wrong means a format keeps its download-link
 *     experience until someone adds it here — never that a file is uploaded to a
 *     third party by accident.
 *   - **The signals that looked easier are wrong.** `contentKind` cannot be used:
 *     it comes from a loose MIME substring match, so every OOXML format
 *     (`…openxmlformats-officedocument…` contains "xml") is stored as *text* —
 *     a DOCX would be judged "already rendered locally" and never escalate.
 *     An `image/*` prefix test fails the same way in reverse: it would keep PSD
 *     and TIFF local, where `<img>` renders a broken icon.
 *
 * Extensions are checked alongside MIME types because uploads routinely arrive
 * as `application/octet-stream`.
 */
const ESCALATED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Microsoft Office — OOXML and the legacy binary formats
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // OpenDocument
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  // Books, design files, and other rich binaries
  "application/epub+zip",
  "application/illustrator",
  "application/postscript",
  "application/rtf",
  "image/vnd.adobe.photoshop",
  "image/tiff",
  // Archives
  "application/gzip",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
]);

const ESCALATED_EXTENSIONS: ReadonlySet<string> = new Set([
  "7z",
  "ai",
  "doc",
  "docx",
  "eps",
  "epub",
  "gz",
  "odp",
  "ods",
  "odt",
  "ppt",
  "pptx",
  "psd",
  "rar",
  "rtf",
  "tar",
  "tif",
  "tiff",
  "tgz",
  "xls",
  "xlsx",
  "zip",
]);

export interface DrivePreviewCandidate {
  /** Drive-relative path, used as the extension signal. */
  path: string;
  /** Stored MIME type, which the shared resolver refines by extension. */
  mimeType: string;
}

/**
 * Whether a configured provider should take this file over from the built-in
 * preview.
 *
 * The provider is an *escalation*, not a replacement: `builtin` is the only
 * renderer that can edit a file, needs no upload, and never leaves the
 * deployment. So it keeps everything it already shows — Markdown, source, SVG,
 * images, PDF, playable media — and the provider is handed the formats that
 * today get nothing but a download link.
 */
export const shouldEscalateDrivePreview = ({ path, mimeType }: DrivePreviewCandidate): boolean => {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    ESCALATED_EXTENSIONS.has(extension) ||
    ESCALATED_MIME_TYPES.has(inferFileTreeMimeType(path, mimeType))
  );
};

/** Inverse of {@link shouldEscalateDrivePreview}, for the read-side call sites. */
export const isBuiltinDrivePreviewSufficient = (candidate: DrivePreviewCandidate): boolean =>
  !shouldEscalateDrivePreview(candidate);
