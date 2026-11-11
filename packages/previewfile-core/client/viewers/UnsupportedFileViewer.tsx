"use client";

import { useI18n } from "../i18n";
import { useViewerHeightClass, useViewerLayout } from "./viewer-layout";

interface UnsupportedFileViewerProps {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  noDownload?: boolean;
}

export default function UnsupportedFileViewer({
  fileUrl,
  fileName,
  mimeType,
  noDownload,
}: UnsupportedFileViewerProps) {
  const { LL } = useI18n();
  const heightClass = useViewerHeightClass();
  const layout = useViewerLayout();

  return (
    <div className={`w-full ${heightClass} bg-muted flex items-center justify-center`}>
      <div className="flex flex-col items-center gap-6 p-8 max-w-lg">
        {/* File Icon */}
        <div className="text-6xl">📦</div>

        {/* Title */}
        <h3 className="text-xl font-semibold text-center">{LL.preview.previewNotAvailable()}</h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground text-center">
          {LL.preview.previewNotAvailableDesc()}
        </p>

        {/* File Information */}
        <div className="w-full space-y-2">
          <div className="text-sm text-muted-foreground">
            <strong>{LL.preview.fileLabel()}</strong> {fileName}
          </div>
          <div className="text-sm text-muted-foreground">
            <strong>{LL.preview.typeLabel()}</strong> {mimeType}
          </div>
        </div>

        {/* Download Button or Disabled Message */}
        {!noDownload && fileUrl ? (
          <a
            href={fileUrl}
            download={fileName}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <title>{LL.preview.downloadIconTitle()}</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            {LL.preview.downloadFile({ fileName })}
          </a>
        ) : (
          // Embedded, the host offers (or withholds) the download itself.
          layout !== "fill" && (
            <div className="px-4 py-2 bg-muted rounded-lg text-sm text-muted-foreground border">
              {LL.preview.downloadDisabled()}
            </div>
          )
        )}
      </div>
    </div>
  );
}
