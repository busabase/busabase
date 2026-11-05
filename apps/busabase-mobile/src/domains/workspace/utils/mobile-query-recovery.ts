import { hashKey, type Query, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { isMobileQueryInScope } from "./mobile-query-scope";

export interface MobileQueryRecovery {
  registerRoute(token: symbol, queryKeys: readonly QueryKey[]): void;
  unregisterRoute(token: symbol): void;
  reconcile(queryKeys?: readonly QueryKey[]): void;
  setForeground(foreground: boolean): void;
  setOnline(online: boolean): void;
  subscribe(listener: () => void): () => void;
  isAvailable(): boolean;
  cancel(): void;
}

export function createMobileQueryRecovery(
  queryClient: QueryClient,
  scopeKey: string,
): MobileQueryRecovery {
  const routes = new Map<symbol, readonly QueryKey[]>();
  const pending = new Map<Query, { dirty: boolean }>();
  const cache = queryClient.getQueryCache();
  let foreground = true;
  let online = true;
  let cancelled = false;
  let queued = false;
  const filters: QueryKey[] = [];
  const listeners = new Set<() => void>();
  let wholeScope = false;

  const isCurrent = (query: Query) => cache.get(query.queryHash) === query;
  const isVisible = (query: Query) =>
    [...routes.values()].some((keys) => keys.some((key) => hashKey(key) === query.queryHash));

  const drain = async (query: Query, work: { dirty: boolean }) => {
    try {
      do {
        work.dirty = false;
        while (isCurrent(query) && query.state.fetchStatus !== "idle" && query.promise) {
          try {
            await query.promise;
          } catch {}
          if (cancelled) break;
        }
        if (!isCurrent(query)) return;
        query.invalidate();
        if (cancelled || !foreground || !online || !isVisible(query) || !query.isActive()) return;
        work.dirty = false;
        const refresh = queryClient.invalidateQueries(
          { queryKey: query.queryKey, exact: true, refetchType: "active" },
          { cancelRefetch: false },
        );
        try {
          await (query.promise ?? refresh);
        } catch {}
      } while (!cancelled && isCurrent(query) && work.dirty);
    } finally {
      pending.delete(query);
    }
  };

  const flush = () => {
    queued = false;
    if (cancelled) return;
    const selected = new Map<string, Query>();
    if (wholeScope) {
      for (const query of cache.getAll()) {
        if (isMobileQueryInScope(query.queryKey, scopeKey)) selected.set(query.queryHash, query);
      }
    } else {
      for (const queryKey of filters) {
        for (const query of cache.findAll({ queryKey })) {
          if (isMobileQueryInScope(query.queryKey, scopeKey)) selected.set(query.queryHash, query);
        }
      }
    }
    filters.length = 0;
    wholeScope = false;
    for (const query of selected.values()) query.invalidate();
    for (const query of selected.values()) {
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

  const reconcile = (queryKeys?: readonly QueryKey[]) => {
    if (cancelled) return;
    if (queryKeys) filters.push(...queryKeys);
    else wholeScope = true;
    if (!queued) {
      queued = true;
      queueMicrotask(flush);
    }
  };

  return {
    registerRoute(token, queryKeys) {
      if (!cancelled) routes.set(token, queryKeys);
    },
    unregisterRoute(token) {
      routes.delete(token);
    },
    reconcile,
    setForeground(next) {
      if (foreground === next) return;
      foreground = next;
      for (const listener of listeners) listener();
      reconcile();
    },
    setOnline(next) {
      if (online === next) return;
      online = next;
      for (const listener of listeners) listener();
      reconcile();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAvailable() {
      return foreground && online && !cancelled;
    },
    cancel() {
      cancelled = true;
      routes.clear();
      filters.length = 0;
      for (const listener of listeners) listener();
      void queryClient.cancelQueries({
        predicate: (query) => isMobileQueryInScope(query.queryKey, scopeKey),
      });
    },
  };
}

const recoveries = new WeakMap<QueryClient, Map<string, MobileQueryRecovery>>();

export function getMobileQueryRecovery(queryClient: QueryClient, scopeKey: string) {
  let byScope = recoveries.get(queryClient);
  if (!byScope) {
    byScope = new Map();
    recoveries.set(queryClient, byScope);
  }
  let recovery = byScope.get(scopeKey);
  if (!recovery) {
    recovery = createMobileQueryRecovery(queryClient, scopeKey);
    byScope.set(scopeKey, recovery);
  }
  return recovery;
}

export function releaseMobileQueryRecovery(queryClient: QueryClient, scopeKey: string) {
  const byScope = recoveries.get(queryClient);
  byScope?.get(scopeKey)?.cancel();
  byScope?.delete(scopeKey);
}

export function invalidateMobileWorkspaceQueries(
  queryClient: QueryClient,
  scopeKey: string,
  queryKeys?: readonly QueryKey[],
) {
  getMobileQueryRecovery(queryClient, scopeKey).reconcile(queryKeys);
}
