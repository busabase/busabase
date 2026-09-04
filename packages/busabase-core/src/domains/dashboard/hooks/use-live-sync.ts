"use client";

import { consumeEventIterator } from "@orpc/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { useEffect, useMemo } from "react";
import type { z } from "zod";
import {
  createLiveInvalidationBatcher,
  type LiveInvalidationBatch,
  type LiveInvalidationTarget,
  NODE_METADATA_INVALIDATION_WINDOW_MS,
} from "../helpers/live-invalidation";
import { createSingleFlightQueryInvalidator } from "../helpers/single-flight-query-invalidation";
import { createWorkspaceRevalidationGate } from "../helpers/workspace-revalidation";

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
      listKeys.inboxSnapshot,
      listKeys.changeRequestCounts,
      listKeys.nodes,
      listKeys.nodeDetail,
      listKeys.nodeRouteState,
      listKeys.records,
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
    // When a whole-workspace re-validation is warranted — see the helper.
    const revalidationGate = createWorkspaceRevalidationGate();

    const invalidateBaseScope = (baseId: string) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listViews.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listViews.queryOptions({ input: { baseId, status: "archived" } })
          .queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.records.list.key(),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.records.listPage.key(),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listDeletedFields.queryOptions({ input: { baseId } }).queryKey,
      });
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

    const flushInvalidations = (batch: LiveInvalidationBatch) => {
      for (const target of batch.targets) {
        if (target === "inboxSnapshot") {
          inboxSnapshotInvalidator.request();
          continue;
        }
        void queryClient.invalidateQueries({ queryKey: keyForTarget(target) });
      }
      for (const baseId of batch.baseIds) invalidateBaseScope(baseId);
    };
    const invalidationBatcher = createLiveInvalidationBatcher(flushInvalidations);
    const metadataInvalidationBatcher = createLiveInvalidationBatcher(
      flushInvalidations,
      NODE_METADATA_INVALIDATION_WINDOW_MS,
    );

    const invalidateWorkspace = () => {
      // A reconnect/focus reconciliation is a superset of any queued event
      // batch. Cancel it so the timer cannot repeat the expensive refresh.
      invalidationBatcher.cancel();
      metadataInvalidationBatcher.cancel();
      void queryClient.invalidateQueries({ queryKey: stableListKeys.nodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.nodeDetail });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.nodeRouteState });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedNodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.records });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.recordsPage });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.recordsCount });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequests });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestsPaged });
      inboxSnapshotInvalidator.request();
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequestCounts });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.auditEvents });
      if (activeBaseId) {
        invalidateBaseScope(activeBaseId);
      }
    };

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

      // Redis pub/sub does not retain history, so a tab that was disconnected
      // has to re-validate on RECONNECT. The FIRST connect is different: the
      // page just finished loading this exact data, so invalidating it there
      // threw the whole workspace away and re-fetched it immediately —
      // measured on production, that meant re-downloading the change request
      // list (6 MB before #6044) milliseconds after it first arrived.
      if (revalidationGate.onStreamConnected()) {
        invalidateWorkspace();
      }
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
    // `focus` and `visibilitychange` BOTH fire when a browser tab is returned
    // to, so an un-throttled handler re-validated the entire workspace twice
    // for one user action. Reconnect storms compound the same way: a stream
    // that drops and retries every 3s otherwise means a full workspace refetch
    // every 3s on a workspace where nothing changed.
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible" && revalidationGate.onUserReturned()) {
        invalidateWorkspace();
      }
    };
    const handleFocusRefresh = () => {
      if (revalidationGate.onUserReturned()) {
        invalidateWorkspace();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleFocusRefresh);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      invalidationBatcher.cancel();
      metadataInvalidationBatcher.cancel();
      inboxSnapshotInvalidator.cancel();
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
