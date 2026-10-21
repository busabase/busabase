"use client";

// The seam that lets a host render file formats busabase-core cannot.
//
// The built-in preview (`AssetMediaPreview`) only covers what every browser
// renders natively — images, video, audio, PDF — and falls back to an "Open
// file" link for everything else. Richer viewers (spreadsheets, Word, EPUB…)
// pull in heavy, partly closed-source renderers that do not belong in the
// open-source build, so a host injects them here instead. The open-source host
// mounts nothing, `useContext` resolves to `null`, and the fallback link stays.
//
// The host decides: whatever it claims (`canRender`) it renders, including
// formats the built-in preview also covers — Busabase Cloud shows PDFs and
// audio through the same viewer as the rest, as Buda does. Whatever it
// declines stays on the built-in preview, so a host only claims what it renders
// at least as well as the browser does.
import { createContext, type ReactNode, useContext } from "react";

export interface HostFileViewerFile {
  url: string;
  /** File name; hosts read the extension from it, since uploads often arrive as `application/octet-stream`. */
  name: string;
  mimeType: string;
}

export interface HostFileViewer {
  canRender: (file: HostFileViewerFile) => boolean;
  /** Fills its container; callers size the frame the same way they size a PDF. */
  render: (file: HostFileViewerFile) => ReactNode;
}

const FileViewerSlotContext = createContext<HostFileViewer | null>(null);

export const FileViewerSlotProvider = FileViewerSlotContext.Provider;

/** The host viewer when it can render this file, otherwise `null`. */
export const useHostFileViewer = (file: HostFileViewerFile | null): HostFileViewer | null => {
  const viewer = useContext(FileViewerSlotContext);
  return viewer && file && viewer.canRender(file) ? viewer : null;
};
