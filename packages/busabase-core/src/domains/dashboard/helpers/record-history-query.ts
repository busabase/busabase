import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";

export const RECORD_HISTORY_FALLBACK_KEY = ["busabase", "record-change-requests"] as const;

const clientScopes = new WeakMap<BusabaseDashboardApiClient, number>();
let nextScope = 0;
const scopeOf = (client: BusabaseDashboardApiClient) => {
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = ++nextScope;
    clientScopes.set(client, scope);
  }
  return scope;
};

export const recordHistoryQueryOptions = (
  client: BusabaseDashboardApiClient,
  recordId: string,
  orpc?: BusabaseQueryUtils | null,
) =>
  orpc?.records.listChangeRequests.queryOptions({ input: { recordId, limit: 5 } }) ?? {
    queryKey: [...RECORD_HISTORY_FALLBACK_KEY, recordId, scopeOf(client), { limit: 5 }],
    queryFn: () => client.listRecordChangeRequests(recordId, { limit: 5 }),
  };

// Shared per-query work makes overlapping local saves and live batches join one
// fetch, with one trailing pass if a newer save arrives while it is running.
const pending = new WeakMap<Query, { dirty: boolean; refetch: boolean; promise: Promise<void> }>();
const invalidateKey = (client: QueryClient, queryKey: QueryKey, staleOnly: boolean) => {
  const cache = client.getQueryCache();
  return Promise.all(
    cache.findAll({ queryKey }).map((query) => {
      query.invalidate();
      const existing = pending.get(query);
      if (existing) {
        existing.dirty = true;
        existing.refetch ||= !staleOnly;
        return existing.promise;
      }
      const work = { dirty: false, refetch: !staleOnly, promise: Promise.resolve() };
      pending.set(query, work);
      work.promise = (async () => {
        try {
          do {
            work.dirty = false;
            // An initial response may predate the save and clear invalidation.
            // Wait without cancelling, then restore stale state and fetch fresh.
            while (query.state.fetchStatus !== "idle" && query.promise) {
              try {
                await query.promise;
              } catch {
                /* A failed old read is still old. */
              }
            }
            if (cache.get(query.queryHash) !== query) return;
            query.invalidate();
            if (!work.refetch || !query.isActive()) return;
            work.dirty = false;
            await client.invalidateQueries(
              { queryKey: query.queryKey, exact: true },
              { cancelRefetch: false },
            );
          } while (work.dirty);
        } finally {
          pending.delete(query);
        }
      })();
      return work.promise;
    }),
  );
};

/** Active readers refetch; closed records are only marked stale. No polling. */
export const invalidateRecordHistory = (
  queryClient: QueryClient,
  orpc: BusabaseQueryUtils | null | undefined,
  recordIds?: readonly string[],
  refetchType?: "none",
) =>
  Promise.all([
    ...(orpc
      ? (recordIds?.length ? [...new Set(recordIds)] : [undefined]).map((recordId) =>
          invalidateKey(
            queryClient,
            orpc.records.listChangeRequests.key(recordId ? { input: { recordId } } : undefined),
            refetchType === "none",
          ),
        )
      : []),
    ...(recordIds?.length ? [...new Set(recordIds)] : [undefined]).map((recordId) =>
      invalidateKey(
        queryClient,
        recordId ? [...RECORD_HISTORY_FALLBACK_KEY, recordId] : RECORD_HISTORY_FALLBACK_KEY,
        refetchType === "none",
      ),
    ),
  ]);
