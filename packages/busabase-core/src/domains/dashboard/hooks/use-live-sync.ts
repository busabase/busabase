"use client";

import { consumeEventIterator } from "@orpc/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { useEffect, useMemo } from "react";
import type { z } from "zod";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const isExpectedLiveClose = (error: unknown, signal: AbortSignal) => {
  if (signal.aborted) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.name === "ResponseAborted" ||
    error.message === "Connection closed." ||
    error.message === "Connection closed" ||
    error.message.toLowerCase().includes("aborted")
  );
};

interface UseBusabaseLiveSyncOptions {
  activeBaseId?: string | null;
  listKeys: {
    archivedBases: QueryKey;
    archivedNodes: QueryKey;
    auditEvents: QueryKey;
    bases: QueryKey;
    changeRequests: QueryKey;
    changeRequestsPaged: QueryKey;
    changeRequestCounts: QueryKey;
    nodes: QueryKey;
    records: QueryKey;
    recordsCount: QueryKey;
  };
  orpc: BusabaseQueryUtils;
  queryClient: QueryClient;
  /**
   * When false, no live stream is opened. Anonymous (public-link) visitors set
   * this: `live.subscribe` is a space-wide event feed off the anonymous
   * allowlist, and a read-only public page has nothing to keep live anyway.
   * Defaults to true so signed-in dashboards are unaffected.
   */
  enabled?: boolean;
  /**
   * The signed-in user's id, used to skip the "new change request pending
   * review" desktop Notification when the event was caused by this same user
   * (nobody wants to be notified about their own submission). Leave unset if
   * unknown — every `change_request.pending_review` event will notify.
   */
  currentUserId?: string | null;
  /** Notification title. Defaults to an English string if omitted. */
  notificationTitle?: string;
  /** Notification body. Defaults to an English string if omitted. */
  notificationBody?: string;
}

const DEFAULT_NOTIFICATION_TITLE = "New change request";
const DEFAULT_NOTIFICATION_BODY = "A new change request is waiting for your review.";

/**
 * Best-effort desktop notification for "a change request now needs your
 * review". Never throws: browsers without the `Notification` API, a denied
 * permission, or a background/unfocused-permission-request restriction all
 * degrade silently to a no-op — this is a lightweight nice-to-have, not a
 * critical alert path, so failure here must never surface to the user as an
 * error.
 */
const notifyPendingReview = (title: string, body: string) => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }
  // Don't interrupt a tab the user is already actively looking at — the
  // change request list itself already refetches (see `handleEvent` below),
  // so a focused tab sees the new item appear without a desktop popup.
  if (document.visibilityState === "visible") {
    return;
  }
  try {
    if (Notification.permission === "granted") {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === "default") {
      void Notification.requestPermission()
        .then((permission) => {
          if (permission === "granted") {
            new Notification(title, { body });
          }
        })
        .catch(() => {
          // Permission prompt failed/blocked — degrade silently.
        });
    }
    // permission === "denied": nothing we can (or should) do.
  } catch {
    // Some environments throw synchronously on `new Notification(...)` (e.g.
    // no user gesture yet in certain browsers) — degrade silently either way.
  }
};

export function useBusabaseLiveSync({
  activeBaseId,
  listKeys,
  orpc,
  queryClient,
  enabled = true,
  currentUserId,
  notificationTitle = DEFAULT_NOTIFICATION_TITLE,
  notificationBody = DEFAULT_NOTIFICATION_BODY,
}: UseBusabaseLiveSyncOptions) {
  const stableListKeys = useMemo(
    () => listKeys,
    [
      listKeys.archivedBases,
      listKeys.archivedNodes,
      listKeys.auditEvents,
      listKeys.bases,
      listKeys.changeRequests,
      listKeys.changeRequestsPaged,
      listKeys.changeRequestCounts,
      listKeys.nodes,
      listKeys.records,
      listKeys.recordsCount,
      listKeys,
    ],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    let abortController: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const invalidateBaseScope = (baseId: string) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listViews.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedViews.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedRecordsPaged.key(),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listDeletedFields.queryOptions({ input: { baseId } }).queryKey,
      });
    };

    const invalidateWorkspace = () => {
      void queryClient.invalidateQueries({ queryKey: stableListKeys.nodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedNodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.records });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.recordsCount });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequests });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestsPaged });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestCounts });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.auditEvents });
      if (activeBaseId) {
        invalidateBaseScope(activeBaseId);
      }
    };

    const handleEvent = (event: BusabaseLiveEvent) => {
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequests });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestsPaged });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestCounts });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.auditEvents });

      // Ephemeral, not persisted: a page refresh loses this signal entirely —
      // that's intentional (see live-events.ts's `publishChangeRequestPendingReview`).
      // Skip the submitter's own tab so nobody gets notified of their own work.
      if (event.kind === "change_request.pending_review" && event.actorId !== currentUserId) {
        notifyPendingReview(notificationTitle, notificationBody);
      }

      if (event.nodeIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: stableListKeys.nodes });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedNodes });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
      }

      if (event.recordIds.length > 0 || event.viewIds.length > 0 || event.baseId) {
        void queryClient.invalidateQueries({ queryKey: stableListKeys.records });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.recordsCount });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
        if (event.baseId) {
          invalidateBaseScope(event.baseId);
        }
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      // Redis pub/sub does not retain history. Refresh on every reconnect so a
      // temporarily disconnected tab still converges to the latest workspace state.
      invalidateWorkspace();
      const controller = new AbortController();
      abortController = controller;
      unsubscribe = consumeEventIterator(
        orpc.live.subscribe.call(undefined, { signal: controller.signal }),
        {
          onEvent: handleEvent,
          onError: (error) => {
            if (!cancelled && !isExpectedLiveClose(error, controller.signal)) {
              retryTimer = setTimeout(connect, 3000);
            }
          },
          onSuccess: () => {
            if (!cancelled) {
              retryTimer = setTimeout(connect, 3000);
            }
          },
        },
      );
    };

    connect();

    // Belt-and-suspenders fallback for tabs left in the background: the SSE
    // stream above is the primary sync path, but it can go silently stale
    // (a dropped connection that doesn't (yet) trigger a reconnect, or a
    // merge/edit made from another tab, the CLI, or an agent while this tab
    // wasn't listening). Re-validate the whole workspace whenever the tab
    // becomes visible/focused again, so the user never has to notice a stale
    // Records/Inbox view and manually reload.
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        invalidateWorkspace();
      }
    };
    const handleFocusRefresh = () => invalidateWorkspace();
    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleFocusRefresh);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      abortController?.abort();
      void unsubscribe?.().catch(() => undefined);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleFocusRefresh);
    };
  }, [
    enabled,
    activeBaseId,
    orpc,
    queryClient,
    stableListKeys,
    currentUserId,
    notificationTitle,
    notificationBody,
  ]);
}
