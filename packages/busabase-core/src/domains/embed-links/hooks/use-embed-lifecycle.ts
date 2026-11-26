"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { EMBED_RUNTIME_CAPABILITY_HEADER, encodeEmbedCapability } from "../capability";

type EmbedLifecycleState = "active" | "disconnected" | "expired" | "unavailable";
const isTerminal = (state: EmbedLifecycleState) => state === "expired" || state === "unavailable";

/** Authority failures end this visit; transport failures preserve the reading position. */
export function useEmbedLifecycle({
  publicId,
  secret,
  expiresAt,
  queryClient,
}: {
  publicId: string;
  secret: string;
  expiresAt: string;
  queryClient: QueryClient;
}) {
  const [state, setState] = useState<EmbedLifecycleState>(() =>
    new Date(expiresAt).getTime() <= Date.now() ? "expired" : "active",
  );
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let terminal = false;
    let controller: AbortController | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const deadline = new Date(expiresAt).getTime();

    const stop = (next: "expired" | "unavailable") => {
      if (disposed || terminal) return;
      terminal = true;
      controller?.abort();
      clearTimeout(deadlineTimer);
      clearInterval(heartbeatTimer);
      // Cancel before clearing: an already-running request must not repopulate
      // this link's cache after its content has been removed.
      void queryClient.cancelQueries();
      queryClient.clear();
      setState(next);
    };

    const check = async () => {
      if (disposed || terminal || controller) return;
      if (Date.now() >= deadline) return stop("expired");
      const activeRequest = new AbortController();
      controller = activeRequest;
      // An unreachable status endpoint is a connection problem, not proof of
      // revocation. Bound each probe so a hung request cannot block retries.
      const timeout = setTimeout(() => activeRequest.abort(), 10_000);
      try {
        const response = await fetch(`/embed/${encodeURIComponent(publicId)}/status`, {
          cache: "no-store",
          credentials: "omit",
          headers: { [EMBED_RUNTIME_CAPABILITY_HEADER]: encodeEmbedCapability(publicId, secret) },
          referrerPolicy: "no-referrer",
          signal: activeRequest.signal,
        });
        if (disposed || terminal) return;
        if (Date.now() >= deadline) return stop("expired");
        if (response.status === 410) stop("expired");
        else if ([401, 403, 404].includes(response.status)) stop("unavailable");
        else if (response.ok) setState("active");
        else setState("disconnected");
      } catch {
        if (!disposed && !terminal) setState("disconnected");
      } finally {
        clearTimeout(timeout);
        if (controller === activeRequest) controller = null;
      }
    };

    const scheduleDeadline = () => {
      const remaining = deadline - Date.now();
      if (!Number.isFinite(remaining)) return stop("unavailable");
      if (remaining <= 0) return stop("expired");
      // Browsers clamp timeouts above 2^31-1 to a few milliseconds.
      deadlineTimer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
    };
    scheduleDeadline();
    if (!terminal) {
      setState("active");
      void check();
    }
    retryRef.current = () => void check();
    if (!terminal) heartbeatTimer = setInterval(() => void check(), 5_000);
    const onOnline = () => void check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(deadlineTimer);
      clearInterval(heartbeatTimer);
      retryRef.current = () => {};
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [expiresAt, publicId, queryClient, secret]);

  return { state, terminal: isTerminal(state), retry };
}
