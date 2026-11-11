"use client";

import { useEffect, useRef, useState } from "react";
import { useViewerLayout } from "./viewer-layout";

interface ViewerShortcuts {
  keydown?: (event: KeyboardEvent) => void;
  wheel?: (event: WheelEvent) => void;
}

/**
 * Where a viewer's zoom and page shortcuts (keys, Ctrl/⌘ + wheel) listen.
 *
 * On a page of its own (a PreviewFile share link) the viewer is the page, so
 * they listen on the whole document. Embedded (`fill` layout) they listen on
 * the viewer only — while focus or the pointer is inside it — so the host's
 * text fields, its own shortcuts and the browser's zoom keep working.
 *
 * Returns the ref for the viewer's root, which should carry `tabIndex={-1}`
 * so a click inside the viewer gives it focus.
 */
export function useViewerShortcuts(shortcuts: ViewerShortcuts): (root: HTMLElement | null) => void {
  const layout = useViewerLayout();
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const target = layout === "fill" ? root : document;
    if (!target) return;
    const onKeyDown = (event: Event) => latest.current.keydown?.(event as KeyboardEvent);
    const onWheel = (event: Event) => latest.current.wheel?.(event as WheelEvent);
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("wheel", onWheel);
    };
  }, [layout, root]);

  return setRoot;
}
