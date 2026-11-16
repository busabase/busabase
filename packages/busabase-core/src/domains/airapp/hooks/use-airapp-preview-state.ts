"use client";

import { useCallback, useRef, useState } from "react";

export type AirAppPreviewViewport = "desktop" | "mobile";

/** A surface's toolbar and iframe share local state without moving the iframe. */
export function useAirAppPreviewState(url: string | null) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [viewport, setViewport] = useState<AirAppPreviewViewport>("desktop");
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!frameRef.current || !url) return;
    setRefreshingUrl(url);
    // Assigning src is allowed for cross-origin frames and restarts only the
    // web view. It never starts, stops, or redeploys the app's runner.
    frameRef.current.src = url;
  }, [url]);
  const loaded = useCallback(() => setRefreshingUrl(null), []);

  return {
    frameRef,
    viewport,
    setViewport,
    refresh,
    refreshing: Boolean(url && refreshingUrl === url),
    loaded,
  };
}

export type AirAppPreviewState = ReturnType<typeof useAirAppPreviewState>;
