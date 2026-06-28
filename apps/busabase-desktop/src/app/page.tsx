"use client";

import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopTitlebar } from "../components/desktop-titlebar";

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
  port: 3061,
  pid: null,
  localUrl: "http://localhost:3061",
  apiUrl: "http://localhost:3061/api/v1",
  dataDir: "",
  launchMode: "stopped",
  error: null,
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as object);

// The sidecar serves the full Busabase web app. We embed its /dashboard in an
// iframe so the window shows the exact same UI as a browser on the local sidecar
// (full styling, navigation, routing) while the Tauri host page stays alive —
// navigating the top-level window to the external origin would close the app.
const dashboardUrl = (status: BusabaseSidecarStatus) =>
  `${status.localUrl || fallbackStatus.localUrl}/dashboard`;

export default function Page() {
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Starting local Busabase…");
  const [failed, setFailed] = useState(false);
  const [update, setUpdate] = useState<{
    version: string;
    downloadAndInstall: () => Promise<void>;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "installed" | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const startedRef = useRef(false);
  const updateFoundRef = useRef(false);

  const canUseTauriCommands = isTauri();

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
      setMessage(status.error ?? "Local Busabase is starting…");
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
            setMessage(status.error);
          }
        })
        .catch(() => {
          /* transient: keep polling */
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [appUrl, canUseTauriCommands, reveal]);

  const checkForUpdate = useCallback(async () => {
    if (!canUseTauriCommands || updateFoundRef.current) {
      return;
    }

    setUpdateStatus("checking");
    setUpdateMessage(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const available = await check();
      if (!available) {
        setUpdateStatus("idle");
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
      setUpdateStatus("idle");
    }
  }, [canUseTauriCommands]);

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
      return;
    }

    setUpdateStatus("downloading");
    setUpdateMessage("Downloading and installing update…");
    try {
      await update.downloadAndInstall();
      setUpdateStatus("installed");
      setUpdateMessage("Restarting Busabase Desktop…");
      await invoke("request_desktop_restart");
    } catch (error) {
      console.error("[busabase-desktop] Update install failed", error);
      setUpdateStatus("error");
      setUpdateMessage("Update failed. Try again after restarting Busabase Desktop.");
    }
  }, [update]);

  const showUpdateControl =
    updateStatus === "available" ||
    updateStatus === "downloading" ||
    updateStatus === "installed" ||
    updateStatus === "error";

  const updateTitle =
    updateStatus === "available"
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
        ) : updateStatus === "installed" ? (
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

  return (
    <div className="desktop-window-frame">
      <DesktopTitlebar actions={updateControl} />
      <div className="desktop-window-body">
        {appUrl ? (
          <iframe
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
