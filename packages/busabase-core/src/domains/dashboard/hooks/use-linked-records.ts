import { type QueryKey, useQueries, useQueryClient } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { RecordVO } from "busabase-contract/types";
import { useMemo, useRef } from "react";
import {
  chunkRecordIds,
  fetchRecordsByIds,
  type LinkedRecordLoaders,
  type LinkedRecordsResult,
} from "../helpers/linked-records";

// Client instances are scoped to their host/workspace, unlike bare record ids,
// so a fallback (no-orpc) cache entry must never be shared between clients.
const clientScopes = new WeakMap<BusabaseDashboardApiClient, number>();
let nextClientScope = 0;
const clientScope = (client: BusabaseDashboardApiClient) => {
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = ++nextClientScope;
    clientScopes.set(client, scope);
  }
  return scope;
};

export interface LinkedRecordSnapshot {
  record: RecordVO;
  /** When the chunk carrying this record was fetched (for freshness merges). */
  fetchedAt: number;
}

export interface LinkedRecordsState {
  /** Resolved linked records, from successful chunks only. */
  records: RecordVO[];
  snapshots: LinkedRecordSnapshot[];
  /** Some chunk has not resolved yet (initial load of a new id set). */
  isPending: boolean;
}

/**
 * Load the records a view links to, one `records.getMany` per 100 ids instead
 * of one `records.get` each. Every loaded record is also seeded into its
 * `records.get` cache entry, so opening its detail panel is a cache hit.
 *
 * - With `orpc`, chunk keys live under the `records.get` prefix: every existing
 *   record-detail invalidation (live sync, refresh) refreshes them too.
 * - Without `orpc`, the dashboard `client` is used and the key is scoped to it.
 * - Older servers without `records.getMany` fall back to per-id reads.
 * - A chunk that errors contributes nothing — never a title cached before
 *   access was revoked. While a NEW chunk is loading, ids still requested keep
 *   their last resolved record so chips do not flash on page changes (React
 *   Query's `keepPreviousData` cannot do this: `useQueries` pairs observers by
 *   key, so a changed chunk key always starts with no data).
 */
export function useLinkedRecords({
  client,
  enabled = true,
  ids,
  orpc,
}: {
  client?: BusabaseDashboardApiClient;
  enabled?: boolean;
  ids: readonly string[];
  orpc?: BusabaseQueryUtils;
}): LinkedRecordsState {
  const queryClient = useQueryClient();
  const idsKey = [...new Set(ids)].sort().join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `idsKey` is the stable identity of `ids`
  const chunks = useMemo(() => (enabled ? chunkRecordIds(ids) : []), [enabled, idsKey]);
  const loaders: LinkedRecordLoaders | null = orpc
    ? {
        getMany: (recordIds, signal) => orpc.records.getMany.call({ recordIds }, { signal }),
        getOne: (recordId, signal) => orpc.records.get.call({ recordId }, { signal }),
      }
    : client
      ? {
          getMany: (recordIds) => client.getRecords(recordIds),
          getOne: (recordId) => client.getRecord(recordId),
        }
      : null;
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: (orpc
        ? [...orpc.records.get.key(), "linked-records", chunk]
        : ["busabase", "linked-records", client ? clientScope(client) : 0, chunk]) as QueryKey,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<LinkedRecordsResult> => {
        if (!loaders) return { records: [], missingIds: chunk };
        const result = await fetchRecordsByIds(loaders, chunk, signal);
        if (orpc) {
          for (const record of result.records) {
            // Untagged key: the dashboard's `RecordVO` and the contract's
            // zod-inferred output differ only in optionality details.
            queryClient.setQueryData<RecordVO>(
              orpc.records.get.queryKey({ input: { recordId: record.id } }) as QueryKey,
              record,
            );
          }
        }
        return result;
      },
      enabled: Boolean(loaders),
      retry: false,
    })),
  });

  const previous = useRef(new Map<string, LinkedRecordSnapshot>());
  // Identity of what the queries currently hold, so the returned arrays stay
  // referentially stable across renders that changed nothing (consumers feed
  // them into memos that rebuild the whole record list).
  const signature = queries
    .map((query, index) =>
      [chunks[index]?.join(",") ?? "", query.dataUpdatedAt, query.isError ? "e" : ""].join("|"),
    )
    .join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` captures every query field read here
  const snapshots = useMemo(() => {
    const result: LinkedRecordSnapshot[] = [];
    const next = new Map<string, LinkedRecordSnapshot>();
    queries.forEach((query, index) => {
      if (query.isError) return;
      if (query.data) {
        for (const record of query.data.records) {
          const snapshot = { record, fetchedAt: query.dataUpdatedAt };
          result.push(snapshot);
          next.set(record.id, snapshot);
        }
        return;
      }
      for (const id of chunks[index] ?? []) {
        const kept = previous.current.get(id);
        if (kept) {
          result.push(kept);
          next.set(id, kept);
        }
      }
    });
    previous.current = next;
    return result;
  }, [signature]);
  const records = useMemo(() => snapshots.map((snapshot) => snapshot.record), [snapshots]);

  return {
    records,
    snapshots,
    isPending: queries.some((query) => query.isPending && query.fetchStatus !== "idle"),
  };
}
