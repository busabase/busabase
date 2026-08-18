"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../lib/desktop-runtime";
import { type BusabaseSidecarStatus, getSidecarDashboardUrl } from "../lib/sidecar";

const SIDECAR_POLL_INTERVAL_MS = 1500;

export function useBusabaseSidecar() {
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Starting local Busabase...");
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);
  const canUseTauriCommands = isTauriRuntime();

  const reveal = useCallback((status: BusabaseSidecarStatus) => {
    setAppUrl((current) => current ?? getSidecarDashboardUrl(status));
  }, []);

  const startSidecar = useCallback(async () => {
    if (!canUseTauriCommands) {
      setFailed(true);
      setMessage("Run with Tauri to launch the local Busabase sidecar.");
      return;
    }

    setFailed(false);
    setMessage("Starting local Busabase...");
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
      setMessage("Local Busabase is starting...");
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [canUseTauriCommands, reveal]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startSidecar();
  }, [startSidecar]);

  useEffect(() => {
    if (!canUseTauriCommands || appUrl) return;

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
          // Sidecar startup is eventually consistent; keep polling transient failures.
        });
    }, SIDECAR_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [appUrl, canUseTauriCommands, reveal]);

  return { appUrl, canUseTauriCommands, failed, message, startSidecar };
}
