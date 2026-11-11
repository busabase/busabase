"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { I18nImageViewerLoading } from "./I18nLoadingState";
import { useViewerMinHeightClass } from "./viewer-layout";

interface ImageViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
}

export default function ImageViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
}: ImageViewerProps) {
  const { LL } = useI18n();
  const minHeightClass = useViewerMinHeightClass();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset loading state when fileUrl changes
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
  }, []);

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <div className={`w-full ${minHeightClass} flex items-center justify-center relative`}>
      {watermark && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] text-6xl font-bold text-black/10 select-none pointer-events-none whitespace-nowrap z-999">
          {watermark}
        </div>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <I18nImageViewerLoading />
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-10">
          <div className="flex flex-col items-center justify-center gap-3 text-center p-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-labelledby="image-error-icon"
              >
                <title id="image-error-icon">{LL.preview.failedToLoadImageTitle()}</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">
              {LL.preview.failedToLoadImageTitle()}
            </p>
            <p className="text-xs text-muted-foreground">{LL.preview.failedToLoadImageDesc()}</p>
          </div>
        </div>
      )}

      <img
        src={fileUrl}
        alt={fileName}
        className={`max-w-full max-h-full object-contain ${isLoading ? "opacity-0" : "opacity-100"} transition-opacity duration-300`}
        onContextMenu={noDownload ? (e) => e.preventDefault() : undefined}
        onLoad={handleImageLoad}
        onError={handleImageError}
        loading="lazy"
        draggable={false}
      />
    </div>
  );
}
