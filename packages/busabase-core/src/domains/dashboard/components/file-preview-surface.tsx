"use client";

import { useEffect } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { AssetMediaPreview } from "./assets";
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
} from "./preview-fullscreen";

export function isFileFullscreenMime(mimeType: string) {
  return (
    mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType === "application/pdf"
  );
}

/**
 * Shared File media surface for the detail page and Side Panel. Fullscreen
 * changes classes on this container only, keeping the media element mounted so
 * images, video playback position, and PDF document state survive the round trip.
 */
export function FilePreviewSurface({
  fullscreenState,
  mimeType,
  name,
  showToolbar = false,
  url,
}: {
  fullscreenState: PreviewFullscreenState;
  mimeType: string;
  name: string;
  showToolbar?: boolean;
  url: string;
}) {
  const messages = useCoreI18n();
  const fullscreenAvailable = isFileFullscreenMime(mimeType);
  const effectiveFullscreenState = {
    ...fullscreenState,
    fullscreen: fullscreenAvailable && fullscreenState.fullscreen,
  };

  useEffect(() => {
    if (!fullscreenAvailable && fullscreenState.fullscreen) {
      fullscreenState.setFullscreen(false);
    }
  }, [fullscreenAvailable, fullscreenState.fullscreen, fullscreenState.setFullscreen]);

  return (
    <FullscreenPreviewSurface
      aria-label={fmt(messages.richNodes.previewFrame, { name })}
      bodyClassName={
        effectiveFullscreenState.fullscreen ? "bg-background p-0" : "bg-background p-4 md:p-6"
      }
      data-file-fullscreen={effectiveFullscreenState.fullscreen ? "true" : "false"}
      data-file-preview=""
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={effectiveFullscreenState}
      toolbar={
        showToolbar ? (
          <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
            <span className="min-w-0 truncate font-medium text-muted-foreground text-xs">
              {name}
            </span>
            <PreviewFullscreenButton
              available={fullscreenAvailable}
              fullscreenState={fullscreenState}
              label={messages.airapp.enterFullscreen}
            />
          </div>
        ) : null
      }
    >
      <div
        className={
          effectiveFullscreenState.fullscreen
            ? "grid h-full min-h-0 w-full place-items-center overflow-hidden bg-background"
            : "mx-auto grid h-full min-h-[320px] max-w-5xl place-items-center overflow-hidden rounded-md border bg-muted"
        }
        data-file-media-frame=""
      >
        <AssetMediaPreview
          mediaClassName={
            effectiveFullscreenState.fullscreen
              ? "!h-full max-h-full w-full border-0 object-contain"
              : mimeType === "application/pdf"
                ? "!h-[65vh] max-h-[65vh] w-full border-0"
                : "max-h-[65vh] w-full border-0 object-contain"
          }
          mimeType={mimeType}
          name={name}
          url={url}
        />
      </div>
    </FullscreenPreviewSurface>
  );
}
