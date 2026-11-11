"use client";

// Attachment dialogs use the shared viewer by default. Inline File nodes keep
// their existing text reads, native media and explicitly registered host viewer.
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { useCoreLocale } from "../../../i18n";
import { createPreviewFileHostViewer } from "./previewfile-host-viewer";

export interface HostFileViewerFile {
  url: string;
  /** File name; hosts read the extension from it, since uploads often arrive as `application/octet-stream`. */
  name: string;
  mimeType: string;
  size?: number;
}

export interface HostFileViewer {
  canRender: (file: HostFileViewerFile) => boolean;
  /** Optional inline policy; text File nodes may own their full source/editor. */
  canRenderInline?: (file: HostFileViewerFile) => boolean;
  /** Fills its container; callers size the frame the same way they size a PDF. */
  render: (file: HostFileViewerFile) => ReactNode;
}

const FileViewerSlotContext = createContext<HostFileViewer | null>(null);

export const FileViewerSlotProvider = FileViewerSlotContext.Provider;

export type HostFileViewerScope = "inline" | "attachment";

/** The host viewer when it can render this file, otherwise `null`. */
export const useHostFileViewer = (
  file: HostFileViewerFile | null,
  scope: HostFileViewerScope = "inline",
): HostFileViewer | null => {
  const locale = useCoreLocale();
  const defaultViewer = useMemo(() => createPreviewFileHostViewer({ locale }), [locale]);
  const registeredViewer = useContext(FileViewerSlotContext);
  const viewer = registeredViewer ?? (scope === "attachment" ? defaultViewer : null);
  const canRender =
    scope === "inline" ? (viewer?.canRenderInline ?? viewer?.canRender) : viewer?.canRender;
  return viewer && file && canRender?.(file) ? viewer : null;
};
