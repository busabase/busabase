"use client";

import { useEffect } from "react";
import { useViewerLayout } from "./viewer-layout";

/**
 * Whether a viewer guards its content for a share link that forbids
 * downloading — no context menu, no save or print shortcut, no text selection —
 * and, while it does, the page-wide listeners that block them.
 *
 * Embedded (`fill` layout), `noDownload` only means the host shows its own
 * download button: nothing on the host's page is blocked, and text stays
 * selectable.
 */
export function useDownloadGuard(noDownload: boolean | undefined): boolean {
  const layout = useViewerLayout();
  const guard = Boolean(noDownload) && layout !== "fill";

  useEffect(() => {
    if (!guard) return;
    const blockMenu = (event: MouseEvent) => event.preventDefault();
    const blockSaveAndPrint = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "p")) {
        event.preventDefault();
      }
    };
    document.addEventListener("contextmenu", blockMenu);
    document.addEventListener("keydown", blockSaveAndPrint);
    return () => {
      document.removeEventListener("contextmenu", blockMenu);
      document.removeEventListener("keydown", blockSaveAndPrint);
    };
  }, [guard]);

  return guard;
}
