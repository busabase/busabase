"use client";

import { consumeEventIterator } from "@orpc/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { useEffect, useMemo } from "react";
import type { z } from "zod";
import { createWorkspaceReconciliationScheduler } from "../helpers/active-query-revalidation";
import {
  createLiveInvalidationBatcher,
  type LiveInvalidationBatch,
  type LiveInvalidationFlushOptions,
  type LiveInvalidationTarget,
  NODE_METADATA_INVALIDATION_WINDOW_MS,
} from "../helpers/live-invalidation";
import { createSingleFlightQueryInvalidator } from "../helpers/single-flight-query-invalidation";

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
  /** Retained for API compatibility; reconciliation discovers active Base queries itself. */
  activeBaseId?: string | null;
  listKeys: {
    archivedBases: QueryKey;
    archivedNodes: QueryKey;
    auditEvents: QueryKey;
    bases: QueryKey;
    // Partial key matching every `bases.get` — the open Base is its own query,
    // so it is invalidated everywhere `bases` is.
    baseDetail: QueryKey;
    changeRequests: QueryKey;
    changeRequestsPaged: QueryKey;
    inboxSnapshot: QueryKey;
    changeRequestCounts: QueryKey;
    nodes: QueryKey;
    // Partial key matching every `nodes.get` call regardless of nodeId — the
    // whiteboard/workflow/html detail views fetch their document through this
    // query (not the tree), so it needs its own invalidation everywhere
    // `nodes` is invalidated below, or another tab's edit never shows up.
    nodeDetail: QueryKey;
    // Partial key matching every route-state lookup. Node mutations can change
    // an open URL from active to archived (or back) without changing the URL.
    nodeRouteState: QueryKey;
    records: QueryKey;
    recordDetail: QueryKey;
    recordsPage: QueryKey;
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
      listKeys.baseDetail,
      listKeys.changeRequests,
      listKeys.changeRequestsPaged,
      listKeys.inboxSnapshot,
      listKeys.changeRequestCounts,
      listKeys.nodes,
      listKeys.nodeDetail,
      listKeys.nodeRouteState,
      listKeys.records,
      listKeys.recordDetail,
      listKeys.recordsPage,
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
    const invalidateQuery = (queryKey: QueryKey, options?: LiveInvalidationFlushOptions) => {
      if (options?.refetchType === "none") {
        void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
      } else {
        void queryClient.invalidateQueries({ queryKey });
      }
    };
    const invalidateBaseScope = (baseId: string, options?: LiveInvalidationFlushOptions) => {
      invalidateQuery(orpc.bases.listViews.queryOptions({ input: { baseId } }).queryKey, options);
      invalidateQuery(
        orpc.bases.listViews.queryOptions({ input: { baseId, status: "archived" } }).queryKey,
        options,
      );
      invalidateQuery(orpc.records.list.key(), options);
      invalidateQuery(orpc.records.listPage.key(), options);
      invalidateQuery(stableListKeys.recordDetail, options);
      invalidateQuery(
        orpc.bases.listDeletedFields.queryOptions({ input: { baseId } }).queryKey,
        options,
      );
    };

    const keyForTarget = (target: LiveInvalidationTarget): QueryKey => {
      switch (target) {
        case "archivedBases":
          return stableListKeys.archivedBases;
        case "archivedNodes":
          return stableListKeys.archivedNodes;
        case "auditEvents":
          return stableListKeys.auditEvents;
        case "bases":
          return stableListKeys.bases;
        case "changeRequestCounts":
          return stableListKeys.changeRequestCounts;
        case "changeRequests":
          return stableListKeys.changeRequests;
        case "changeRequestsPaged":
          return stableListKeys.changeRequestsPaged;
        case "inboxSnapshot":
          return stableListKeys.inboxSnapshot;
        case "nodeDetail":
          return stableListKeys.nodeDetail;
        case "nodeRouteState":
          return stableListKeys.nodeRouteState;
        case "nodes":
          return stableListKeys.nodes;
        case "records":
          return stableListKeys.records;
        case "recordDetail":
          return stableListKeys.recordDetail;
        case "recordsCount":
          return stableListKeys.recordsCount;
        case "recordsPage":
          return stableListKeys.recordsPage;
      }
    };

    const inboxSnapshotInvalidator = createSingleFlightQueryInvalidator(
      queryClient,
      stableListKeys.inboxSnapshot,
    );

    const flushInvalidations = (
      batch: LiveInvalidationBatch,
      options?: LiveInvalidationFlushOptions,
    ) => {
      for (const target of batch.targets) {
        if (target === "inboxSnapshot") {
          // The single-flight path always fetches. During a stale-only settle,
          // mark the snapshot invalid so its next mount converges without
          // spending a request while the page is hidden or navigating away.
          if (options?.refetchType === "none") {
            invalidateQuery(stableListKeys.inboxSnapshot, options);
          } else {
            inboxSnapshotInvalidator.request();
          }
          continue;
        }
        invalidateQuery(keyForTarget(target), options);
        if (target === "bases") {
          invalidateQuery(stableListKeys.baseDetail, options);
        }
      }
      for (const baseId of batch.baseIds) invalidateBaseScope(baseId, options);
    };
    const invalidationBatcher = createLiveInvalidationBatcher(flushInvalidations);
    const metadataInvalidationBatcher = createLiveInvalidationBatcher(
      flushInvalidations,
      NODE_METADATA_INVALIDATION_WINDOW_MS,
    );

    // A reconnect or long tab absence may have missed events. Refresh only the
    // queries mounted on the current screen; populated caches for other routes
    // must not turn into another whole-workspace request burst.
    const reconciliationScheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys: [
        ...Object.values(stableListKeys),
        orpc.bases.listViews.key(),
        orpc.bases.listDeletedFields.key(),
      ],
      settleQueuedInvalidations: () => {
        invalidationBatcher.flush({ refetchType: "none" });
        metadataInvalidationBatcher.flush({ refetchType: "none" });
      },
    });
    if (document.visibilityState === "hidden") {
      reconciliationScheduler.onDocumentHidden();
    }

    const handleEvent = (event: BusabaseLiveEvent) => {
      // Ephemeral, not persisted: a page refresh loses this signal entirely —
      // that's intentional (see live-events.ts's `publishChangeRequestPendingReview`).
      // Skip the submitter's own tab so nobody gets notified of their own work.
      if (event.kind === "change_request.pending_review" && event.actorId !== currentUserId) {
        notifyPendingReview(notificationTitle, notificationBody);
      }
      if (event.kind === "node.metadata_updated") {
        metadataInvalidationBatcher.push(event);
      } else {
        invalidationBatcher.push(event);
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      // Redis pub/sub does not retain history, so a reconnect reconciles the
      // current screen. The first connect does nothing: the page just loaded
      // that same data.
      reconciliationScheduler.onStreamConnected();
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

    // The SSE stream is the primary sync path, but it can go silently stale.
    // A return from a meaningful absence reconciles the current screen once;
    // brief tab switches and the paired visibility/focus events do no work.
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "hidden") {
        reconciliationScheduler.onDocumentHidden();
      } else {
        reconciliationScheduler.onUserReturned();
      }
    };
    const handleFocusRefresh = () => {
      // `focus` is the second half of a visibility/focus pair, or the only
      // return signal when the window stayed visible. If there was no
      // meaningful absence, the gate ignores it.
      if (document.visibilityState === "visible") {
        reconciliationScheduler.onUserReturned();
      }
    };
    // Switching to another app without minimizing (desktop shells, side-by-side
    // windows) never hides the document, so only `blur` starts the absence.
    const handleBlur = () => {
      reconciliationScheduler.onWindowBlurred();
    };
    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleFocusRefresh);
    window.addEventListener("blur", handleBlur);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      invalidationBatcher.cancel();
      metadataInvalidationBatcher.cancel();
      inboxSnapshotInvalidator.cancel();
      reconciliationScheduler.cancel();
      abortController?.abort();
      void unsubscribe?.().catch(() => undefined);
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleFocusRefresh);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    enabled,
    orpc,
    queryClient,
    stableListKeys,
    currentUserId,
    notificationTitle,
    notificationBody,
  ]);
}
