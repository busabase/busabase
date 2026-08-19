"use client";

import {
  DESKTOP_CLOUD_CONNECT_RETURNED,
  parseDesktopCloudConnectReturnUrl,
} from "busabase-core/domains/settings/desktop-shell";
import type { RefObject } from "react";
import { useEffect } from "react";
import { getExternalHttpUrl, OPEN_EXTERNAL_REQUEST, OPEN_EXTERNAL_RESULT } from "../lib/sidecar";

interface SidecarBridgeOptions {
  appUrl: string | null;
  canUseTauriCommands: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
}

export function useSidecarBridge({ appUrl, canUseTauriCommands, frameRef }: SidecarBridgeOptions) {
  useExternalUrlBridge(appUrl, frameRef);
  useCloudConnectReturn(appUrl, canUseTauriCommands, frameRef);
}

function useExternalUrlBridge(
  appUrl: string | null,
  frameRef: RefObject<HTMLIFrameElement | null>,
) {
  useEffect(() => {
    if (!appUrl) return;
    const sidecarOrigin = new URL(appUrl).origin;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== sidecarOrigin || event.source !== frameRef.current?.contentWindow)
        return;

      const data = event.data as { type?: unknown; requestId?: unknown; url?: unknown } | null;
      if (!data || data.type !== OPEN_EXTERNAL_REQUEST || typeof data.url !== "string") return;

      const requestId = typeof data.requestId === "string" ? data.requestId : null;
      const source = event.source as Window;
      void (async () => {
        let ok = false;
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(getExternalHttpUrl(data.url as string));
          ok = true;
        } catch (error) {
          console.error("[busabase-desktop] Could not open URL externally", error);
        }
        source.postMessage({ type: OPEN_EXTERNAL_RESULT, requestId, ok }, sidecarOrigin);
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appUrl, frameRef]);
}

function useCloudConnectReturn(
  appUrl: string | null,
  canUseTauriCommands: boolean,
  frameRef: RefObject<HTMLIFrameElement | null>,
) {
  useEffect(() => {
    if (!appUrl || !canUseTauriCommands) return;
    const sidecarOrigin = new URL(appUrl).origin;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const handle = (rawUrl: string) => {
      const status = parseDesktopCloudConnectReturnUrl(rawUrl);
      if (!status) return;
      frameRef.current?.contentWindow?.postMessage(
        { type: DESKTOP_CLOUD_CONNECT_RETURNED, status },
        sidecarOrigin,
      );
    };

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const initial = await getCurrent();
        if (cancelled) return;
        for (const url of initial ?? []) handle(url);

        const dispose = await onOpenUrl((urls) => {
          for (const url of urls) handle(url);
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch (error) {
        console.error("[busabase-desktop] Could not subscribe to deep links", error);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appUrl, canUseTauriCommands, frameRef]);
}
