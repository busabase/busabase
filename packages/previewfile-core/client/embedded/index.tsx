"use client";

import { type ComponentType, memo } from "react";
import type { ConverterPort } from "../../types/ports";
import { ConverterProvider } from "../converter";
import { type Messages, MessagesProvider } from "../i18n";
import { FileViewer } from "../viewers/file-viewer";
import { ViewerLayoutProvider } from "../viewers/viewer-layout";
import type { ViewerProps } from "../viewers/viewer-props";
import { ViewerRecoveryBoundary } from "../viewers/viewer-recovery";

export interface EmbeddedFileViewerProps {
  url: string;
  fileName: string;
  mimeType: string;
  /** Original byte size, used by bounded text previews before reading. */
  fileSize?: number;
  /**
   * Office → PDF conversion for the formats only a server can render (pptx,
   * doc, odt…). Hosts without one leave it out and get a viewer-level error for
   * those formats instead of a crashed tree.
   */
  converter?: ConverterPort;
  /** The host's language (BCP 47); see `ViewerLanguage` for the ones built in. */
  locale?: string | null;
  /** Overrides for the viewer's strings in that language. */
  messages?: Partial<Messages>;
  /**
   * Hide the viewers' own download controls (default `true`): an embedding
   * host shows its own download action, or withholds it.
   */
  noDownload?: boolean;
  /**
   * Convert MPEG and QuickTime/MOV videos to MP4 in the browser (default
   * `false`). The converter, ffmpeg.wasm, is a ~30 MB download from unpkg.com
   * when a video is opened; an embedding host rarely wants its users to depend
   * on that. Left off, a video the browser cannot play shows the "format not
   * supported" state, with the same wording in every host.
   */
  transcodeVideo?: boolean;
  /**
   * The 3D model viewer (`previewfile-core/client/viewers/model-3d`). Left out,
   * 3D files get the "unsupported" card, and a host that routes by
   * `canPreview` says `model3d: false`: it is a separate entry point so a host
   * that has no use for 3D never pulls three.js into its bundle.
   */
  model3dViewer?: ComponentType<ViewerProps>;
}

const unavailableConverter: ConverterPort = {
  convertToPdf: async () => {
    throw new Error("This deployment cannot convert Office documents to PDF.");
  },
};

/**
 * `FileViewer` for a host's preview frame — Buda's Drive, Busabase's file
 * preview — so each host stops re-assembling the same wiring:
 *
 * - viewers fill the frame (`ViewerLayoutProvider layout="fill"`) instead of
 *   the viewport the standalone PreviewFile page sizes them to;
 * - a converter is always in context, because `OfficeViewer` throws without
 *   one;
 * - memoized, so an unrelated host re-render does not re-fetch, re-parse or
 *   re-convert the document. Pass a stable `converter` (e.g. from `useMemo`).
 *
 * Import it lazily — `previewfile-core/client/embedded/lazy` does — so the
 * viewers stay out of the host's main bundle until a file is opened.
 */
export const EmbeddedFileViewer = memo(function EmbeddedFileViewer({
  url,
  fileName,
  mimeType,
  fileSize,
  converter = unavailableConverter,
  locale,
  messages,
  noDownload = true,
  transcodeVideo = false,
  model3dViewer,
}: EmbeddedFileViewerProps) {
  return (
    <MessagesProvider locale={locale} messages={messages}>
      <ConverterProvider converter={converter}>
        <ViewerLayoutProvider layout="fill">
          <div className="h-full w-full" data-previewfile-viewer="">
            <ViewerRecoveryBoundary fileUrl={url}>
              <FileViewer
                key={JSON.stringify([url, fileName, mimeType])}
                fileName={fileName}
                fileSize={fileSize}
                mimeType={mimeType}
                model3dViewer={model3dViewer}
                noDownload={noDownload}
                transcodeVideo={transcodeVideo}
                url={url}
              />
            </ViewerRecoveryBoundary>
          </div>
        </ViewerLayoutProvider>
      </ConverterProvider>
    </MessagesProvider>
  );
});
