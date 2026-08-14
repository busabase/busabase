"use client";

import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AutostartToggle } from "../components/autostart-toggle";
import { DesktopTitlebar } from "../components/desktop-titlebar";
import { CLOUD_CONNECT_RETURNED, parseCloudConnectReturn } from "../lib/deep-link";
import { useDesktopMenuActions } from "../lib/desktop-menu-actions";

interface BusabaseSidecarStatus {
  running: boolean;
  healthy: boolean;
  port: number;
  pid: number | null;
  localUrl: string;
  apiUrl: string;
  dataDir: string;
  launchMode: "managed" | "external" | "stopped";
  error: string | null;
}

const fallbackStatus: BusabaseSidecarStatus = {
  running: false,
  healthy: false,
  port: 15419,
  pid: null,
  localUrl: "http://localhost:15419",
  apiUrl: "http://localhost:15419/api/v1",
  dataDir: "",
  launchMode: "stopped",
  error: null,
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as object);
const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

type BusabaseUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installed"
  | "error";
type BusabaseUpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

// The sidecar serves the full Busabase web app. We embed its /dashboard in an
// iframe so the window shows the exact same UI as a browser on the local sidecar
// (full styling, navigation, routing) while the Tauri host page stays alive —
// navigating the top-level window to the external origin would close the app.
const dashboardUrl = (status: BusabaseSidecarStatus) =>
  `${status.localUrl || fallbackStatus.localUrl}/dashboard`;

// The Tauri webview implements no `window.open()` — it returns `null` unconditionally,
// so any in-app flow the sidecar would normally run in a popup (Cloud Connect sign-in)
// asks us instead to hand the URL to the OS default browser. Kept in sync with
// `apps/busabase/src/domains/settings/utils/desktop-shell.ts`.
const OPEN_EXTERNAL_REQUEST = "busabase-desktop:open-external";
const OPEN_EXTERNAL_RESULT = "busabase-desktop:open-external:result";

// …and the return leg — see `../lib/deep-link`.

export default function Page() {
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Starting local Busabase…");
  const [failed, setFailed] = useState(false);
  const [update, setUpdate] = useState<{
    version: string;
    downloadAndInstall: (
      onEvent?: (event: BusabaseUpdateDownloadEvent) => void,
      options?: { timeout?: number },
    ) => Promise<void>;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<BusabaseUpdateStatus>("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [showManualCheckFeedback, setShowManualCheckFeedback] = useState(false);
  const startedRef = useRef(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const updateFoundRef = useRef(false);
  const updateStatusRef = useRef<BusabaseUpdateStatus>("idle");

  const canUseTauriCommands = isTauri();

  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

  const reveal = useCallback((status: BusabaseSidecarStatus) => {
    setAppUrl((current) => current ?? dashboardUrl(status));
  }, []);

  const startSidecar = useCallback(async () => {
    if (!canUseTauriCommands) {
      setFailed(true);
      setMessage("Run with Tauri to launch the local Busabase sidecar.");
      return;
    }

    setFailed(false);
    setMessage("Starting local Busabase…");
    try {
      const status = await invoke<BusabaseSidecarStatus>("start_busabase_sidecar");
      if (status.healthy) {
        reveal(status);
        return;
      }
      if (status.error) {
        setFailed(true);
        setMessage(status.error);
        return;
      }
      setMessage("Local Busabase is starting…");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [canUseTauriCommands, reveal]);

  // Kick off the sidecar once on mount.
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    void startSidecar();
  }, [startSidecar]);

  // Poll status until the sidecar reports healthy, then reveal the app.
  useEffect(() => {
    if (!canUseTauriCommands || appUrl) {
      return;
    }
    const timer = window.setInterval(() => {
      void invoke<BusabaseSidecarStatus>("busabase_sidecar_status")
        .then((status) => {
          if (status.healthy) {
            window.clearInterval(timer);
            reveal(status);
          } else if (status.error) {
            setFailed(true);
            setMessage(status.error);
          }
        })
        .catch(() => {
          /* transient: keep polling */
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [appUrl, canUseTauriCommands, reveal]);

  // Serve the embedded sidecar's "open this URL outside the webview" requests.
  useEffect(() => {
    if (!appUrl) {
      return;
    }
    const sidecarOrigin = new URL(appUrl).origin;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== sidecarOrigin || event.source !== frameRef.current?.contentWindow) {
        return;
      }
      const data = event.data as { type?: unknown; requestId?: unknown; url?: unknown } | null;
      if (!data || data.type !== OPEN_EXTERNAL_REQUEST || typeof data.url !== "string") {
        return;
      }
      const requestId = typeof data.requestId === "string" ? data.requestId : null;
      const source = event.source as Window;

      void (async () => {
        let ok = false;
        try {
          const target = new URL(data.url as string);
          // Only ever hand http(s) to the OS — never `file:`, `tauri:` or a custom scheme.
          if (target.protocol !== "http:" && target.protocol !== "https:") {
            throw new Error(`Refusing to open ${target.protocol} URL externally`);
          }
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(target.toString());
          ok = true;
        } catch (error) {
          console.error("[busabase-desktop] Could not open URL externally", error);
        }
        source.postMessage({ type: OPEN_EXTERNAL_RESULT, requestId, ok }, sidecarOrigin);
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appUrl]);

  // Deep link return leg: `busabase://desktop/cloud-connect?status=…` arrives
  // after the user finished Cloud Connect sign-in in the OS browser. Rust has
  // already raised the window by the time we get here (see
  // `src-tauri/src/lib.rs`); our job is to tell the embedded Settings tab so it
  // stops showing "continue in your browser" and refreshes right away.
  useEffect(() => {
    if (!appUrl || !canUseTauriCommands) {
      return;
    }
    const sidecarOrigin = new URL(appUrl).origin;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const handle = (rawUrl: string) => {
      const status = parseCloudConnectReturn(rawUrl);
      if (!status) return;
      frameRef.current?.contentWindow?.postMessage(
        { type: CLOUD_CONNECT_RETURNED, status },
        sidecarOrigin,
      );
    };

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        // Cold start: the app was launched *by* the deep link, so the event
        // already fired before this listener existed.
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
  }, [appUrl, canUseTauriCommands]);

  const checkForUpdate = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!canUseTauriCommands || (updateFoundRef.current && updateStatusRef.current !== "error")) {
        return;
      }

      const isManual = options?.manual === true;
      setShowManualCheckFeedback(isManual);
      setUpdateStatus("checking");
      setUpdateMessage(null);
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const available = await check({ timeout: CHECK_TIMEOUT_MS });
        if (!available) {
          updateFoundRef.current = false;
          setUpdate(null);
          setUpdateStatus(isManual ? "up-to-date" : "idle");
          setUpdateMessage(isManual ? "Busabase Desktop is up to date." : null);
          return;
        }

        updateFoundRef.current = true;
        setUpdate({
          version: available.version,
          downloadAndInstall: () => available.downloadAndInstall(),
        });
        setUpdateStatus("available");
      } catch (error) {
        console.error("[busabase-desktop] Update check failed", error);
        updateFoundRef.current = false;
        setUpdate(null);
        setUpdateStatus(isManual ? "error" : "idle");
        setUpdateMessage(
          isManual ? "Update check failed. Try again after reopening Busabase Desktop." : null,
        );
      }
    },
    [canUseTauriCommands],
  );

  useEffect(() => {
    if (updateStatus !== "up-to-date" && updateStatus !== "error") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setUpdateStatus("idle");
      setUpdateMessage(null);
      setShowManualCheckFeedback(false);
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [updateStatus]);

  useEffect(() => {
    if (!canUseTauriCommands) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void checkForUpdate();
    }, 15_000);
    const interval = window.setInterval(
      () => {
        void checkForUpdate();
      },
      60 * 60 * 1000,
    );

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [canUseTauriCommands, checkForUpdate]);

  const installUpdate = useCallback(async () => {
    if (!update) {
      await checkForUpdate({ manual: true });
      return;
    }

    setUpdateStatus("downloading");
    setUpdateMessage("Downloading and installing update…");
    try {
      try {
        await invoke("stop_busabase_sidecar");
      } catch (stopError) {
        console.warn("[busabase-desktop] Could not stop sidecar before update", stopError);
      }

      let downloadedBytes = 0;
      let contentLength: number | undefined;
      let lastLoggedPercent = -1;

      await update.downloadAndInstall(
        (event) => {
          if (event.event === "Started") {
            downloadedBytes = 0;
            contentLength = event.data.contentLength;
            console.info("[busabase-desktop] Update download started", { contentLength });
            return;
          }

          if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
            if (!contentLength) return;

            const percent = Math.floor((downloadedBytes / contentLength) * 100);
            if (percent >= lastLoggedPercent + 10 || percent === 100) {
              lastLoggedPercent = percent;
              console.info("[busabase-desktop] Update download progress", {
                downloadedBytes,
                contentLength,
                percent,
              });
            }
            return;
          }

          console.info("[busabase-desktop] Update download finished");
        },
        { timeout: DOWNLOAD_INSTALL_TIMEOUT_MS },
      );
      setUpdateStatus("installed");
      setUpdateMessage("Restarting Busabase Desktop…");
      await invoke("request_desktop_restart");
    } catch (error) {
      console.error("[busabase-desktop] Update install failed", error);
      updateFoundRef.current = false;
      setUpdate(null);
      setUpdateStatus("error");
      setUpdateMessage("Update failed. Retry, or reopen Busabase Desktop and check again.");
    }
  }, [checkForUpdate, update]);

  const checkForUpdatesFromMenu = useCallback(() => {
    if (updateStatusRef.current === "available") {
      void installUpdate();
      return;
    }

    void checkForUpdate({ manual: true });
  }, [checkForUpdate, installUpdate]);

  useDesktopMenuActions({ onCheckForUpdates: checkForUpdatesFromMenu });

  const showUpdateControl =
    (showManualCheckFeedback && (updateStatus === "checking" || updateStatus === "up-to-date")) ||
    updateStatus === "available" ||
    updateStatus === "downloading" ||
    updateStatus === "installed" ||
    updateStatus === "error";

  const updateTitle =
    updateStatus === "checking"
      ? "Checking for updates"
      : updateStatus === "up-to-date"
        ? "Busabase Desktop is up to date"
        : updateStatus === "available"
          ? "New version available"
          : updateStatus === "downloading"
            ? "Installing update"
            : updateStatus === "installed"
              ? "Restarting Busabase Desktop"
              : "Update failed";
  const updateMeta =
    updateStatus === "available"
      ? update?.version
        ? `Version ${update.version}`
        : "Ready to install"
      : updateMessage;
  const canInstallUpdate = updateStatus === "available" || updateStatus === "error";

  const updateControl = showUpdateControl ? (
    <div className="desktop-update-control" data-update-status={updateStatus} role="status">
      <button
        type="button"
        className="desktop-update-button"
        onClick={() => void installUpdate()}
        disabled={!canInstallUpdate}
        aria-label={updateTitle}
        title={updateTitle}
      >
        {updateStatus === "available" ? (
          <Download aria-hidden="true" />
        ) : updateStatus === "up-to-date" ||
          updateStatus === "installed" ||
          updateStatus === "error" ? (
          <RotateCcw aria-hidden="true" />
        ) : (
          <RefreshCw className="desktop-update-button-spin" aria-hidden="true" />
        )}
      </button>
      <div className="desktop-update-popover">
        <span className="desktop-update-popover-title">{updateTitle}</span>
        {updateMeta ? <span className="desktop-update-popover-meta">{updateMeta}</span> : null}
      </div>
    </div>
  ) : null;

  const titlebarActions = (
    <>
      <AutostartToggle />
      {updateControl}
    </>
  );

  return (
    <div className="desktop-window-frame">
      <DesktopTitlebar actions={titlebarActions} />
      <div className="desktop-window-body">
        {appUrl ? (
          <iframe
            ref={frameRef}
            title="Busabase"
            src={appUrl}
            className="busabase-frame"
            // The sidecar app is the same trusted local origin; allow it everything.
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          />
        ) : (
          <section className="desktop-content">
            <div className="boot-panel">
              {failed ? <AlertTriangle size={30} /> : <Loader2 size={30} className="spin" />}
              <h2>{failed ? "Busabase is not ready" : "Starting Busabase"}</h2>
              <p>{message}</p>
              {failed ? (
                <div className="boot-actions">
                  <button type="button" onClick={() => void startSidecar()}>
                    <RefreshCw size={16} />
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
