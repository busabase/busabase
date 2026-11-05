import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import {
  createWorkspaceRevalidationGate,
  type WorkspaceRevalidationGate,
} from "./workspace-revalidation";

type ActiveQueryRevalidationClient = Pick<QueryClient, "getQueryCache" | "invalidateQueries">;

/**
 * Return the exact keys mounted on the current screen. A cache entry can stay
 * populated for a long time after its component unmounts; refetching those
 * hidden entries repeats work the user cannot see.
 */
export const getActiveQueryKeys = (queryClient: ActiveQueryRevalidationClient): QueryKey[] => {
  const keysByHash = new Map<string, QueryKey>();
  for (const query of queryClient.getQueryCache().getAll()) {
    if (query.getObserversCount() > 0 && query.isActive()) {
      keysByHash.set(query.queryHash, query.queryKey);
    }
  }
  return [...keysByHash.values()];
};

export interface WorkspaceReconciliationScheduler {
  cancel(): void;
  onDocumentHidden(now?: number): void;
  onStreamConnected(now?: number): boolean;
  onUserReturned(now?: number): boolean;
  /**
   * The window lost focus but may still be visible (another app or window on
   * top, side by side). Starts the absence clock only: a visible window keeps
   * reconciling reconnects immediately.
   */
  onWindowBlurred(now?: number): void;
}

interface CreateWorkspaceReconciliationSchedulerOptions {
  gate?: WorkspaceRevalidationGate;
  queryClient: ActiveQueryRevalidationClient;
  settleQueuedInvalidations: () => void;
  /** Tenant-scoped query families that may have changed during the event gap. */
  workspaceQueryKeys: readonly QueryKey[];
}

/**
 * Marks workspace caches stale, then refreshes only mounted queries. A fetch
 * already running when a gap is reported cannot settle that gap: wait for it
 * and refresh again (or restore stale state if its route is no longer active).
 */
export const createWorkspaceReconciliationScheduler = ({
  gate = createWorkspaceRevalidationGate(),
  queryClient,
  settleQueuedInvalidations,
  workspaceQueryKeys,
}: CreateWorkspaceReconciliationSchedulerOptions): WorkspaceReconciliationScheduler => {
  let cancelled = false;
  let documentHidden = false;
  let refreshDeferredWhileHidden = false;
  const pending = new Map<Query, { dirty: boolean }>();
  const cache = queryClient.getQueryCache();

  const isCurrent = (query: Query) => !cancelled && cache.get(query.queryHash) === query;

  const drain = async (query: Query, work: { dirty: boolean }) => {
    try {
      do {
        work.dirty = false;
        while (isCurrent(query) && query.state.fetchStatus !== "idle" && query.promise) {
          try {
            await query.promise;
          } catch {
            // A failed old request does not discharge the pending refresh.
          }
        }
        if (!isCurrent(query)) return;

        // A successful old response clears isInvalidated, even for an inactive
        // query. Restore it before deciding whether another request is useful.
        query.invalidate();
        if (!query.isActive()) return;
        if (documentHidden) {
          refreshDeferredWhileHidden = true;
          return;
        }

        // Everything reported before this fresh fetch is covered by it. Only
        // signals arriving during this fetch need another trailing pass.
        work.dirty = false;
        const refresh = queryClient.invalidateQueries(
          { queryKey: query.queryKey, exact: true, refetchType: "active" },
          { cancelRefetch: false },
        );
        try {
          // invalidateQueries resolves early for paused/offline queries. The
          // query promise still tracks their eventual response in that case.
          await (query.promise ?? refresh);
        } catch {
          // Keep failed queries stale; a later sync/mount can retry them.
        }
      } while (isCurrent(query) && work.dirty);
    } finally {
      pending.delete(query);
    }
  };

  const reconcile = () => {
    if (cancelled) return;
    settleQueuedInvalidations();
    const queries = new Map<string, Query>();
    for (const queryKey of workspaceQueryKeys) {
      for (const query of cache.findAll({ queryKey })) queries.set(query.queryHash, query);
    }
    // Cache invalidation is independent of whether this screen has observers.
    for (const query of queries.values()) query.invalidate();
    for (const query of queries.values()) {
      const work = pending.get(query);
      if (work) {
        work.dirty = true;
      } else {
        const next = { dirty: false };
        pending.set(query, next);
        void drain(query, next);
      }
    }
  };

  return {
    cancel() {
      cancelled = true;
      pending.clear();
    },
    onDocumentHidden(now) {
      documentHidden = true;
      gate.onDocumentHidden(now);
    },
    onStreamConnected(now) {
      const shouldReconcile = gate.onStreamConnected(now, { documentHidden });
      if (shouldReconcile) reconcile();
      return shouldReconcile;
    },
    onUserReturned(now) {
      const shouldReconcile = gate.onUserReturned(now) || refreshDeferredWhileHidden;
      documentHidden = false;
      refreshDeferredWhileHidden = false;
      if (shouldReconcile) reconcile();
      return shouldReconcile;
    },
    onWindowBlurred(now) {
      gate.onDocumentHidden(now);
    },
  };
};
