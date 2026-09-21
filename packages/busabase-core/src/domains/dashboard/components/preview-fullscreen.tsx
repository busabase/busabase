"use client";

import { Button } from "kui/button";
import { cn } from "kui/utils";
import { Maximize, Minimize } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  isPreviewFullscreenSearch,
  updatePreviewFullscreenSearch,
} from "../utils/fullscreen-query";

export const PREVIEW_DETAIL_TAB_LIST_CLASS = "mt-3 h-8 shrink-0 gap-1 bg-transparent p-0";
export const PREVIEW_DETAIL_TAB_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-lg bg-transparent px-2.5 text-muted-foreground text-xs shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none";

export interface PreviewFullscreenState {
  fullscreen: boolean;
  setFullscreen: (fullscreen: boolean) => void;
}

/**
 * One fullscreen state model for every live preview surface. URL-backed detail
 * views use `?fullscreen=1`; side-panel previews keep their state local so they
 * cannot rewrite the unrelated main route.
 */
export function usePreviewFullscreen({
  syncWithUrl = false,
}: {
  syncWithUrl?: boolean;
} = {}): PreviewFullscreenState {
  const [localFullscreen, setLocalFullscreen] = useState(false);
  const [location, setLocation] = useLocation();
  const currentSearch = useSearch();
  const fullscreen = syncWithUrl ? isPreviewFullscreenSearch(currentSearch) : localFullscreen;

  const setFullscreen = useCallback(
    (nextFullscreen: boolean) => {
      if (!syncWithUrl) {
        setLocalFullscreen(nextFullscreen);
        return;
      }

      const nextSearch = updatePreviewFullscreenSearch(currentSearch, nextFullscreen);
      setLocation(nextSearch ? `${location}?${nextSearch}` : location, { replace: true });
    },
    [currentSearch, location, setLocation, syncWithUrl],
  );

  useEffect(() => {
    if (!fullscreen) return;

    const previousOverflow = document.body.style.overflow;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", exitOnEscape);
    };
  }, [fullscreen, setFullscreen]);

  return { fullscreen, setFullscreen };
}

export function PreviewFullscreenButton({
  fullscreenState,
  label,
  available = true,
  onEnter,
}: {
  fullscreenState: PreviewFullscreenState;
  label: string;
  available?: boolean;
  /** Optional view-selection handoff before the preview surface grows. */
  onEnter?: () => void;
}) {
  if (!available || fullscreenState.fullscreen) return null;
  return (
    <Button
      aria-label={label}
      onClick={() => {
        onEnter?.();
        fullscreenState.setFullscreen(true);
      }}
      size="icon-sm"
      title={label}
      type="button"
      variant="outline"
    >
      <Maximize className="size-3.5" />
    </Button>
  );
}

interface FullscreenPreviewSurfaceProps extends Omit<ComponentProps<"section">, "ref"> {
  banner?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  exitLabel: string;
  fullscreenState: PreviewFullscreenState;
  toolbar?: ReactNode;
}

/**
 * Changes only the preview container's classes when entering fullscreen. Its
 * children stay at the same React position, so an iframe is never recreated or
 * re-parented and therefore keeps its document and in-frame JavaScript state.
 */
export function FullscreenPreviewSurface({
  banner,
  bodyClassName,
  children,
  className,
  exitLabel,
  fullscreenState,
  toolbar,
  ...sectionProps
}: FullscreenPreviewSurfaceProps) {
  const { fullscreen, setFullscreen } = fullscreenState;
  const surfaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!fullscreen) return;
    // SidePanel animates its own translateX and sits below overflow-clipped
    // dashboard layout wrappers. Both can trap a fixed preview inside the
    // panel/main-canvas rectangle even when its bounding box says viewport.
    // Temporarily neutralize those ancestors without moving the iframe.
    const container = surfaceRef.current?.closest<HTMLElement>(
      "[data-preview-fullscreen-container]",
    );
    const previousTransform = container?.style.transform;
    const previousTranslate = container?.style.translate;
    if (container) {
      container.style.transform = "none";
      container.style.translate = "none";
    }

    const unclippedAncestors: Array<{
      element: HTMLElement;
      overflow: string;
      overflowX: string;
      overflowY: string;
    }> = [];
    let ancestor = surfaceRef.current?.parentElement;
    while (ancestor && ancestor !== document.body) {
      const style = window.getComputedStyle(ancestor);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        unclippedAncestors.push({
          element: ancestor,
          overflow: ancestor.style.overflow,
          overflowX: ancestor.style.overflowX,
          overflowY: ancestor.style.overflowY,
        });
        ancestor.style.overflow = "visible";
        ancestor.style.overflowX = "visible";
        ancestor.style.overflowY = "visible";
      }
      ancestor = ancestor.parentElement;
    }

    return () => {
      if (container) {
        container.style.transform = previousTransform ?? "";
        container.style.translate = previousTranslate ?? "";
      }
      for (const entry of unclippedAncestors) {
        entry.element.style.overflow = entry.overflow;
        entry.element.style.overflowX = entry.overflowX;
        entry.element.style.overflowY = entry.overflowY;
      }
    };
  }, [fullscreen]);

  return (
    <section
      className={cn(
        fullscreen
          ? "fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background"
          : "flex h-full min-h-0 flex-col",
        className,
      )}
      data-preview-fullscreen={fullscreen ? "true" : "false"}
      {...sectionProps}
      ref={surfaceRef}
    >
      {toolbar}
      {banner}
      <div className={cn("relative min-h-0 flex-1", bodyClassName)} data-preview-fullscreen-body>
        {/* Gated on `fullscreen` alone, deliberately. Whether a preview is
            *ready* decides if the user may enter fullscreen — never whether
            they may leave it. `?fullscreen=1` restores the fullscreen overlay
            on reload long before the AirApp runner has a preview URL (and
            forever, if that run fails), so any readiness condition here traps
            the user behind a full-viewport surface with no way out but Esc. */}
        {fullscreen ? (
          <Button
            aria-label={exitLabel}
            className="absolute top-3 right-3 z-10 bg-background/90 shadow-lg backdrop-blur-sm"
            onClick={() => setFullscreen(false)}
            size="icon"
            title={exitLabel}
            type="button"
            variant="outline"
          >
            <Minimize className="size-4" />
          </Button>
        ) : null}
        {children}
      </div>
    </section>
  );
}
