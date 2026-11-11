"use client";

import { type RefObject, useCallback, useEffect, useState } from "react";

/**
 * Fullscreen for one element — the browser's own, so it covers the window
 * whatever surrounds the element. A page-covering overlay (`fixed inset-0`) is
 * held inside any ancestor with a transform or containment, which is what a
 * host's preview panel is: there it only fills the panel. Where the browser
 * will not go fullscreen (an iframe without `allow="fullscreen"`, iPhone
 * Safari) this falls back to that overlay: the caller styles `overlay`.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [native, setNative] = useState(false);
  const [overlay, setOverlay] = useState(false);

  // The browser can end fullscreen by itself (Esc), so follow it rather than assume.
  useEffect(() => {
    const element = ref.current;
    const sync = () => setNative(document.fullscreenElement === element && element !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // Moving on to another file must not leave the browser fullscreen on nothing.
      if (element && document.fullscreenElement === element) void document.exitFullscreen();
    };
  }, [ref]);

  const toggle = useCallback(async () => {
    const element = ref.current;
    if (!element) return;
    if (document.fullscreenElement === element) {
      await document.exitFullscreen();
      return;
    }
    if (overlay) {
      setOverlay(false);
      return;
    }
    try {
      await element.requestFullscreen();
    } catch {
      setOverlay(true);
    }
  }, [ref, overlay]);

  return { isFullscreen: native || overlay, overlay, toggle };
}
