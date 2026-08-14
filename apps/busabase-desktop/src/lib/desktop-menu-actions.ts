"use client";

import { useEffect } from "react";

export const DESKTOP_MENU_EVENT = "busabase://desktop-menu-action";
export const CHECK_FOR_UPDATES_ACTION = "check_for_updates";

interface DesktopMenuPayload {
  action: unknown;
}

interface DesktopMenuActionHandlers {
  onCheckForUpdates: () => void;
}

export const isCheckForUpdatesAction = (action: unknown): action is "check_for_updates" =>
  action === CHECK_FOR_UPDATES_ACTION;

export function useDesktopMenuActions({ onCheckForUpdates }: DesktopMenuActionHandlers) {
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const dispose = await listen<DesktopMenuPayload>(DESKTOP_MENU_EVENT, (event) => {
          if (isCheckForUpdatesAction(event.payload.action)) {
            onCheckForUpdates();
          }
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch (error) {
        console.error("[busabase-desktop] Could not subscribe to desktop menu actions", error);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onCheckForUpdates]);
}
