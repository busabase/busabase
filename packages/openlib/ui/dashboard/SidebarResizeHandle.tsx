"use client";

import { useSidebar } from "kui/sidebar";
import { cn } from "kui/utils";
import { GripVertical } from "lucide-react";
import * as React from "react";

const SIDEBAR_WIDTH_STORAGE_KEY = "openlib:sidebar-width";
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;
// Matches kui/sidebar's hardcoded `SIDEBAR_WIDTH = "16rem"` at the default 16px root
// font size — used as the drag start point when nothing's been persisted yet.
const DEFAULT_SIDEBAR_WIDTH = 256;

function clampWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

// kui/sidebar's own gap + fixed-position divs (the `.peer[data-side]` root's two children)
// carry a permanent `transition-[width]` / `transition-[left,right,width] duration-200`
// for the collapse/expand animation. Left alone, every rAF-batched drag frame below would
// re-trigger that 200ms CSS transition instead of tracking the pointer 1:1 — same fix
// busabase-core's side-panel resizer applies (toggle the transition off for the drag,
// restore it after the final frame has painted).
function getWidthTransitionTargets(
  wrapperRef: React.RefObject<HTMLDivElement | null>,
): HTMLElement[] {
  const root = wrapperRef.current?.querySelector<HTMLElement>(".peer[data-side]");
  return root
    ? Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
    : [];
}

// Custom properties are stored as their literal specified value — reading
// `--sidebar-width` back via getComputedStyle returns the string "16rem", not a
// resolved px number — so the persisted width is the only source of truth for the
// current numeric width, never the CSS var itself.
function readStoredWidth(): number {
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_SIDEBAR_WIDTH;
}

/**
 * Applies the persisted sidebar width to `wrapperRef` before paint so the
 * sidebar doesn't flash at the default width on load.
 */
export function useRestoreSidebarWidth(wrapperRef: React.RefObject<HTMLDivElement | null>) {
  React.useLayoutEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!stored || !wrapperRef.current) {
      return;
    }
    wrapperRef.current.style.setProperty("--sidebar-width", `${readStoredWidth()}px`);
  }, [wrapperRef]);
}

/**
 * Drag-to-resize handle for the main app sidebar. Writes straight to the
 * `--sidebar-width` CSS var on the `SidebarProvider` wrapper (read by
 * `kui/sidebar`'s `Sidebar`) via rAF-batched pointer events, bypassing React
 * re-render per pixel — same pattern as busabase-core's side-panel resizer.
 * Only committed to localStorage on pointerup.
 */
export function SidebarResizeHandle({
  wrapperRef,
}: {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { isMobile, state } = useSidebar();
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeStartRef = React.useRef<{ pointerX: number; width: number } | null>(null);
  const pendingWidthRef = React.useRef<number | null>(null);
  const frameRef = React.useRef<number | null>(null);
  // Tracks the current width across drags so pointerdown never needs to read
  // the CSS var back (see the readStoredWidth comment above).
  const currentWidthRef = React.useRef<number | null>(null);

  const commitFrame = React.useCallback(() => {
    frameRef.current = null;
    const value = pendingWidthRef.current;
    if (value === null) {
      return;
    }
    wrapperRef.current?.style.setProperty("--sidebar-width", `${value}px`);
  }, [wrapperRef]);

  React.useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      if (resizeStartRef.current) {
        for (const el of getWidthTransitionTargets(wrapperRef)) {
          el.style.transition = "";
        }
      }
    },
    [wrapperRef],
  );

  if (isMobile || state === "collapsed") {
    return null;
  }

  return (
    <button
      aria-label="Resize sidebar"
      className={cn(
        "group fixed inset-y-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center text-muted-foreground/50 transition-colors duration-150 hover:bg-accent/50 hover:text-foreground md:flex",
        isResizing && "bg-accent/50 text-foreground",
      )}
      onPointerDown={(event) => {
        const startWidth = currentWidthRef.current ?? readStoredWidth();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeStartRef.current = { pointerX: event.clientX, width: startWidth };
        pendingWidthRef.current = startWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        for (const el of getWidthTransitionTargets(wrapperRef)) {
          el.style.transition = "none";
        }
        setIsResizing(true);
      }}
      onPointerMove={(event) => {
        const start = resizeStartRef.current;
        if (!start) {
          return;
        }
        pendingWidthRef.current = clampWidth(start.width + (event.clientX - start.pointerX));
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(commitFrame);
        }
      }}
      onPointerUp={(event) => {
        if (!resizeStartRef.current) {
          return;
        }
        resizeStartRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        const finalWidth = pendingWidthRef.current;
        pendingWidthRef.current = null;
        if (finalWidth !== null) {
          currentWidthRef.current = finalWidth;
          window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(finalWidth));
        }
        // Wait for the untransitioned final width to paint before restoring the
        // transition, so re-enabling it doesn't itself animate away the last frame.
        const targets = getWidthTransitionTargets(wrapperRef);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            for (const el of targets) {
              el.style.transition = "";
            }
          });
        });
      }}
      style={{ left: "var(--sidebar-width)" }}
      title="Resize sidebar"
      type="button"
    >
      <span
        className={cn(
          "absolute left-1/2 h-10 w-1 -translate-x-1/2 rounded-md bg-border opacity-0 transition-all duration-150 group-hover:h-14 group-hover:bg-primary/50 group-hover:opacity-100",
          isResizing && "h-16 bg-primary/60 opacity-100",
        )}
      />
      <GripVertical className="relative size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
    </button>
  );
}
