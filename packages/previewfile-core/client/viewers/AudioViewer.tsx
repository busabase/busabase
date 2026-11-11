"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useViewerHeightClass, useViewerLayout } from "./viewer-layout";

interface AudioViewerProps {
  fileUrl: string;
  fileName: string;
  watermark?: string | null;
  noDownload?: boolean;
  /** Shown above the file name; WeChat voice notes play here too, with their own. */
  icon?: string;
}

export default function AudioViewer({
  fileUrl,
  fileName,
  watermark,
  noDownload,
  icon = "🎵",
}: AudioViewerProps) {
  const heightClass = useViewerHeightClass();
  const layout = useViewerLayout();
  const { LL } = useI18n();
  // Loaded/failed belong to a URL, so another file starts loading again. Nothing
  // resets them after mount: a fast source (a blob, a cached file) can report its
  // metadata before effects run, and a reset then left the spinner over the player.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasError = failedUrl === fileUrl;
  const isLoading = loadedUrl !== fileUrl && !hasError;

  const handleAudioLoad = () => {
    setLoadedUrl(fileUrl);
  };

  const handleAudioError = () => {
    setFailedUrl(fileUrl);
  };

  // Rendered concurrently (the viewer is lazy), the element can load between
  // render and commit, and React drops that event: ask the element itself too.
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.error) setFailedUrl(fileUrl);
    else if (audio.readyState >= 1) setLoadedUrl(fileUrl); // HAVE_METADATA
  }, [fileUrl]);

  return (
    <div
      className={`w-full ${heightClass} bg-muted flex flex-col items-center justify-center relative`}
    >
      {watermark && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-45deg] text-6xl font-bold text-black/10 select-none pointer-events-none whitespace-nowrap z-10">
          {watermark}
        </div>
      )}

      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-20">
          <div className="flex flex-col items-center justify-center gap-3">
            <LoaderCircle className="w-12 h-12 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">{LL.preview.loadingAudio()}</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted z-20">
          <div className="flex flex-col items-center justify-center gap-3 text-center p-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-labelledby="audio-error-icon"
              >
                <title id="audio-error-icon">{LL.preview.audioLoadFailedTitle()}</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">
              {LL.preview.audioLoadFailedTitle()}
            </p>
            <p className="text-xs text-muted-foreground">{LL.preview.audioLoadFailedDesc()}</p>
          </div>
        </div>
      )}

      {/* Full width up to max-w-md: a shrink-to-fit column squeezed the player to its play button. */}
      <div className="flex w-full max-w-md flex-col items-center gap-6 p-8">
        {/* Audio Icon */}
        <div className="text-6xl">{icon}</div>

        {/* File Name */}
        <h3 className="text-xl font-semibold">{fileName}</h3>

        {/* Audio Player */}
        <audio
          ref={audioRef}
          src={fileUrl}
          controls
          controlsList={noDownload ? "nodownload" : undefined}
          className="w-full max-w-md"
          // Not onCanPlayThrough: iOS Safari only buffers once the user presses
          // play, so that never fired there and the overlay hid the controls.
          onLoadedMetadata={handleAudioLoad}
          onError={handleAudioError}
        >
          <track kind="captions" />
          {LL.preview.browserNoAudio()}
        </audio>

        {/* Embedded, the host offers (or withholds) the download itself. */}
        {noDownload && layout !== "fill" && (
          <p className="text-xs text-muted-foreground">{LL.preview.downloadDisabled()}</p>
        )}
      </div>
    </div>
  );
}
