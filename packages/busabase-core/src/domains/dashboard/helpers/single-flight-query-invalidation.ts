import type { QueryClient, QueryKey } from "@tanstack/react-query";

type QueryInvalidationClient = Pick<QueryClient, "invalidateQueries" | "isFetching">;

export interface SingleFlightQueryInvalidator {
  cancel(): void;
  request(): void;
}

/**
 * Serializes invalidations for an expensive active query. A request that
 * arrives while a fetch is running marks the query dirty instead of cancelling
 * it, then performs one trailing refresh after that fetch settles.
 */
export const createSingleFlightQueryInvalidator = (
  queryClient: QueryInvalidationClient,
  queryKey: QueryKey,
): SingleFlightQueryInvalidator => {
  let cancelled = false;
  let dirty = false;
  let running = false;

  const drain = async (initialFetchInProgress: boolean) => {
    running = true;
    let needsTrailingRefresh = initialFetchInProgress;

    try {
      while (!cancelled) {
        dirty = false;
        try {
          await queryClient.invalidateQueries(
            { queryKey },
            // Joining an active fetch is essential here. The default cancels
            // it, which made live event storms repeatedly restart Snapshot.
            { cancelRefetch: false },
          );
        } catch {
          // Live synchronization is best-effort. A later event, reconnect, or
          // focus reconciliation can retry without surfacing an unhandled
          // rejection from this fire-and-forget scheduler.
        }

        if (!needsTrailingRefresh && !dirty) return;
        needsTrailingRefresh = false;
      }
    } finally {
      dirty = false;
      running = false;
    }
  };

  return {
    cancel() {
      cancelled = true;
      dirty = false;
    },
    request() {
      if (cancelled) return;
      if (running) {
        dirty = true;
        return;
      }

      // `invalidateQueries({ cancelRefetch: false })` joins an already-running
      // fetch. Remember that collision so we refresh once more after the
      // joined request completes and cannot lose the event that triggered us.
      const initialFetchInProgress = queryClient.isFetching({ queryKey }) > 0;
      void drain(initialFetchInProgress);
    },
  };
};
