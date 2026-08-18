"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopMenuActions } from "../lib/desktop-menu-actions";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FEEDBACK_DURATION_MS = 5000;

export type BusabaseUpdateStatus =
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

interface AvailableUpdate {
  version: string;
  downloadAndInstall: (
    onEvent?: (event: BusabaseUpdateDownloadEvent) => void,
    options?: { timeout?: number },
  ) => Promise<void>;
}

export function useDesktopUpdater(canUseTauriCommands: boolean) {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<BusabaseUpdateStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showManualFeedback, setShowManualFeedback] = useState(false);
  const updateFoundRef = useRef(false);
  const statusRef = useRef<BusabaseUpdateStatus>("idle");

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const checkForUpdate = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!canUseTauriCommands || (updateFoundRef.current && statusRef.current !== "error")) return;

      const isManual = options?.manual === true;
      setShowManualFeedback(isManual);
      setStatus("checking");
      setMessage(null);
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const available = await check({ timeout: CHECK_TIMEOUT_MS });
        if (!available) {
          updateFoundRef.current = false;
          setUpdate(null);
          setStatus(isManual ? "up-to-date" : "idle");
          setMessage(isManual ? "Busabase Desktop is up to date." : null);
          return;
        }

        updateFoundRef.current = true;
        setUpdate({
          version: available.version,
          downloadAndInstall: (onEvent, downloadOptions) =>
            available.downloadAndInstall(onEvent, downloadOptions),
        });
        setStatus("available");
      } catch (error) {
        console.error("[busabase-desktop] Update check failed", error);
        updateFoundRef.current = false;
        setUpdate(null);
        setStatus(isManual ? "error" : "idle");
        setMessage(
          isManual ? "Update check failed. Try again after reopening Busabase Desktop." : null,
        );
      }
    },
    [canUseTauriCommands],
  );

  useEffect(() => {
    if (status !== "up-to-date" && status !== "error") return;
    const timeout = window.setTimeout(() => {
      setStatus("idle");
      setMessage(null);
      setShowManualFeedback(false);
    }, FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    if (!canUseTauriCommands) return;
    const timeout = window.setTimeout(() => void checkForUpdate(), INITIAL_CHECK_DELAY_MS);
    const interval = window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
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

    setStatus("downloading");
    setMessage("Downloading and installing update...");
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
      setStatus("installed");
      setMessage("Restarting Busabase Desktop...");
      await invoke("request_desktop_restart");
    } catch (error) {
      console.error("[busabase-desktop] Update install failed", error);
      updateFoundRef.current = false;
      setUpdate(null);
      setStatus("error");
      setMessage("Update failed. Retry, or reopen Busabase Desktop and check again.");
    }
  }, [checkForUpdate, update]);

  const checkForUpdatesFromMenu = useCallback(() => {
    if (statusRef.current === "available") {
      void installUpdate();
      return;
    }
    void checkForUpdate({ manual: true });
  }, [checkForUpdate, installUpdate]);

  useDesktopMenuActions({ onCheckForUpdates: checkForUpdatesFromMenu });

  const visible =
    (showManualFeedback && (status === "checking" || status === "up-to-date")) ||
    status === "available" ||
    status === "downloading" ||
    status === "installed" ||
    status === "error";

  return { installUpdate, message, status, updateVersion: update?.version, visible };
}
