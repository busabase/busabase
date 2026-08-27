"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
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
}

/** Compact, touch-friendly screenshot shelf shared by website and Dashboard details. */
export function TemplateScreenshotShowcase({
  screenshots,
  label,
  previousLabel,
  nextLabel,
}: TemplateScreenshotShowcaseProps) {
  const showcaseId = useId();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

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
      const targetIndex = Math.min(Math.max(index, 0), screenshots.length - 1);
      const frame = frameRefs.current[targetIndex];
      if (!scroller || !frame) return;

      setCurrentIndex(targetIndex);
      scroller.scrollTo({ behavior: "smooth", left: frame.offsetLeft });
    },
    [screenshots.length],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    scrollToIndex(currentIndex + (event.key === "ArrowRight" ? 1 : -1));
  };

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === screenshots.length - 1;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div
        ref={scrollerRef}
        className="relative flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-scrollbar]:hidden"
        aria-activedescendant={`${showcaseId}-${currentIndex}`}
        aria-label={label}
        onKeyDown={handleKeyDown}
        role="listbox"
        tabIndex={0}
      >
        {screenshots.map((screenshot, index) => (
          <div
            key={`${screenshot.src}-${index}`}
            id={`${showcaseId}-${index}`}
            ref={(frame) => {
              frameRefs.current[index] = frame;
            }}
            className="w-[88%] shrink-0 snap-start overflow-hidden rounded-md border border-border bg-muted sm:w-[46%]"
            aria-selected={index === currentIndex}
            role="option"
            tabIndex={-1}
          >
            <TemplateDetailImage src={screenshot.src} alt={screenshot.alt} />
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
    </section>
  );
}
