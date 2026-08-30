"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  RotateCwSquare,
  Scan,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { TemplateDetailImage } from "./template-detail-image";

export interface TemplateScreenshot {
  src: string;
  alt: string;
}

interface TemplateScreenshotShowcaseProps {
  screenshots: TemplateScreenshot[];
  label: string;
  previousLabel: string;
  nextLabel: string;
  closeLabel: string;
  zoomOutLabel: string;
  zoomInLabel: string;
  resetLabel: string;
  rotateLabel: string;
  downloadLabel: string;
}

export const clampScreenshotIndex = (index: number, screenshotCount: number): number =>
  Math.min(Math.max(index, 0), Math.max(screenshotCount - 1, 0));

export const MIN_SCREENSHOT_ZOOM = 50;
export const MAX_SCREENSHOT_ZOOM = 300;
export const SCREENSHOT_ZOOM_STEP = 25;

export const clampScreenshotZoom = (zoom: number): number =>
  Math.min(Math.max(zoom, MIN_SCREENSHOT_ZOOM), MAX_SCREENSHOT_ZOOM);

export const adjustScreenshotZoom = (zoom: number, direction: -1 | 1): number =>
  clampScreenshotZoom(zoom + direction * SCREENSHOT_ZOOM_STEP);

export const rotateScreenshotClockwise = (rotation: number): number => (rotation + 90) % 360;

export const getScreenshotDownloadName = (src: string, index: number): string => {
  try {
    const pathname = new URL(src).pathname;
    const filename = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
    if (filename) return filename;
  } catch {
    // Fall through to a stable filename for relative or malformed catalog URLs.
  }
  return `template-screenshot-${index + 1}.png`;
};

const clickDownloadLink = (href: string, filename: string, openInNewTab = false) => {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  if (openInNewTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
};

/** Compact, touch-friendly screenshot shelf shared by website and Dashboard details. */
export function TemplateScreenshotShowcase({
  screenshots,
  label,
  previousLabel,
  nextLabel,
  closeLabel,
  zoomOutLabel,
  zoomInLabel,
  resetLabel,
  rotateLabel,
  downloadLabel,
}: TemplateScreenshotShowcaseProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  const resetPreviewView = useCallback(() => {
    setZoom(100);
    setRotation(0);
  }, []);

  const selectPreview = useCallback(
    (index: number) => {
      setPreviewIndex(clampScreenshotIndex(index, screenshots.length));
      resetPreviewView();
    },
    [resetPreviewView, screenshots.length],
  );

  const syncCurrentIndex = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || screenshots.length === 0) return;

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const [index, frame] of frameRefs.current.entries()) {
      if (!frame) continue;
      const distance = Math.abs(frame.offsetLeft - scroller.scrollLeft);
      if (distance < closestDistance) {
        closestIndex = index;
        closestDistance = distance;
      }
    }
    setCurrentIndex(closestIndex);
  }, [screenshots.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    syncCurrentIndex();
    scroller.addEventListener("scroll", syncCurrentIndex, { passive: true });
    const observer = new ResizeObserver(syncCurrentIndex);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", syncCurrentIndex);
      observer.disconnect();
    };
  }, [syncCurrentIndex]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      const targetIndex = clampScreenshotIndex(index, screenshots.length);
      const frame = frameRefs.current[targetIndex];
      if (!scroller || !frame) return;

      setCurrentIndex(targetIndex);
      scroller.scrollTo({ behavior: "smooth", left: frame.offsetLeft });
    },
    [screenshots.length],
  );

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (previewIndex === null || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
      return;
    }
    event.preventDefault();
    selectPreview(previewIndex + (event.key === "ArrowRight" ? 1 : -1));
  };

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === screenshots.length - 1;
  const activePreviewIndex = previewIndex ?? 0;
  const preview = previewIndex === null ? null : screenshots[activePreviewIndex];
  const isPreviewFirst = activePreviewIndex === 0;
  const isPreviewLast = activePreviewIndex === screenshots.length - 1;

  const handleDownload = async () => {
    if (!preview) return;
    const filename = getScreenshotDownloadName(preview.src, activePreviewIndex);

    try {
      const response = await fetch(preview.src);
      if (!response.ok) throw new Error(`Image download failed with ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      clickDownloadLink(objectUrl, filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch {
      clickDownloadLink(preview.src, filename, true);
    }
  };

  const overlayButtonClass =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-background/70 transition-colors hover:bg-background/15 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/70 disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div
        ref={scrollerRef}
        className="relative flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={label}
        role="list"
      >
        {screenshots.map((screenshot, index) => (
          <div
            key={`${screenshot.src}-${index}`}
            ref={(frame) => {
              frameRefs.current[index] = frame;
            }}
            className="w-[88%] shrink-0 snap-start overflow-hidden rounded-md border border-border bg-muted sm:w-[46%]"
            role="listitem"
          >
            <button
              type="button"
              className="group relative block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={screenshot.alt}
              onClick={() => {
                setCurrentIndex(index);
                selectPreview(index);
              }}
            >
              <TemplateDetailImage src={screenshot.src} alt={screenshot.alt} />
              <span className="pointer-events-none absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded-md bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Expand className="size-4" aria-hidden="true" />
              </span>
            </button>
          </div>
        ))}
        <div aria-hidden="true" className="w-[12%] shrink-0 sm:w-[54%]" />
      </div>

      <div className="flex items-center justify-end gap-2">
        <span
          className="min-w-10 text-center text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {currentIndex + 1} / {screenshots.length}
        </span>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={previousLabel}
          title={previousLabel}
          disabled={isFirst}
          onClick={() => scrollToIndex(currentIndex - 1)}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={nextLabel}
          title={nextLabel}
          disabled={isLast}
          onClick={() => scrollToIndex(currentIndex + 1)}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <DialogPrimitive.Root
        open={preview !== null}
        onOpenChange={(open) => !open && setPreviewIndex(null)}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-50 bg-muted-foreground/30 backdrop-blur-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            onClick={() => setPreviewIndex(null)}
          />
          <DialogPrimitive.Content
            className="!pointer-events-none fixed inset-0 z-50 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            onKeyDown={handlePreviewKeyDown}
          >
            {preview ? (
              <>
                <DialogPrimitive.Title className="sr-only">{preview.alt}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {label}, {activePreviewIndex + 1} / {screenshots.length}
                </DialogPrimitive.Description>
                <div className="pointer-events-none absolute start-1/2 top-[47%] flex h-[calc(100dvh-8rem)] w-[calc(100vw-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden [container-type:size] [&>*]:pointer-events-auto sm:h-[calc(100dvh-10rem)]">
                  <TemplateDetailImage
                    key={preview.src}
                    src={preview.src}
                    alt={preview.alt}
                    fit="contain"
                    rotation={rotation}
                    scale={zoom / 100}
                  />
                </div>
                <div className="pointer-events-auto fixed bottom-4 start-1/2 z-10 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center rounded-lg bg-foreground/80 p-1 text-background shadow-lg backdrop-blur-md sm:bottom-6">
                  {screenshots.length > 1 ? (
                    <>
                      <button
                        type="button"
                        className={overlayButtonClass}
                        aria-label={previousLabel}
                        title={previousLabel}
                        disabled={isPreviewFirst}
                        onClick={() => selectPreview(activePreviewIndex - 1)}
                      >
                        <ChevronLeft className="size-4" aria-hidden="true" />
                      </button>
                      <span
                        className="min-w-12 shrink-0 px-1 text-center text-xs tabular-nums text-background/80"
                        aria-live="polite"
                      >
                        {activePreviewIndex + 1} / {screenshots.length}
                      </span>
                      <button
                        type="button"
                        className={overlayButtonClass}
                        aria-label={nextLabel}
                        title={nextLabel}
                        disabled={isPreviewLast}
                        onClick={() => selectPreview(activePreviewIndex + 1)}
                      >
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </button>
                      <span
                        aria-hidden="true"
                        className="mx-1 h-5 w-px shrink-0 bg-background/20"
                      />
                    </>
                  ) : null}
                  <button
                    type="button"
                    className={overlayButtonClass}
                    aria-label={zoomOutLabel}
                    title={zoomOutLabel}
                    disabled={zoom <= MIN_SCREENSHOT_ZOOM}
                    onClick={() => setZoom((value) => adjustScreenshotZoom(value, -1))}
                  >
                    <ZoomOut className="size-4" aria-hidden="true" />
                  </button>
                  <span
                    className="min-w-10 shrink-0 text-center text-xs tabular-nums text-background/80"
                    aria-live="polite"
                  >
                    {zoom}%
                  </span>
                  <button
                    type="button"
                    className={overlayButtonClass}
                    aria-label={zoomInLabel}
                    title={zoomInLabel}
                    disabled={zoom >= MAX_SCREENSHOT_ZOOM}
                    onClick={() => setZoom((value) => adjustScreenshotZoom(value, 1))}
                  >
                    <ZoomIn className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={overlayButtonClass}
                    aria-label={resetLabel}
                    title={resetLabel}
                    onClick={resetPreviewView}
                  >
                    <Scan className="size-4" aria-hidden="true" />
                  </button>
                  <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-background/20" />
                  <button
                    type="button"
                    className={overlayButtonClass}
                    aria-label={rotateLabel}
                    title={rotateLabel}
                    onClick={() => setRotation((value) => rotateScreenshotClockwise(value))}
                  >
                    <RotateCwSquare className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={overlayButtonClass}
                    aria-label={downloadLabel}
                    title={downloadLabel}
                    onClick={() => void handleDownload()}
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <DialogPrimitive.Close className="pointer-events-auto fixed start-4 top-4 z-10 inline-flex size-9 items-center justify-center rounded-full bg-foreground/65 text-background/80 shadow-sm backdrop-blur-md transition-colors hover:bg-foreground/80 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:start-6 sm:top-6">
                  <X className="size-4" aria-hidden="true" />
                  <span className="sr-only">{closeLabel}</span>
                </DialogPrimitive.Close>
              </>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
