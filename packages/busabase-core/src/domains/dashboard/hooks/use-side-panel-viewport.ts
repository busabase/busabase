"use client";

import { useEffect, useState } from "react";

/**
 * Below this width the side panel switches from a docked/resizable column to
 * a full-screen overlay (see `SidePanel` in `components/side-panel.tsx`) —
 * mirrors apps/buda's `useMobileViewport` breakpoint (`max-width: 1023.98px`,
 * i.e. just under Tailwind's `lg`) so the panel flips to "mobile" behavior at
 * the same point the rest of the app's workbench-style layouts do.
 */
export function useSidePanelViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023.98px)");
    setIsMobile(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => {
      mediaQuery.removeEventListener("change", handler);
    };
  }, []);

  return isMobile;
}
