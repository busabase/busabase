import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceReconciliationScheduler } from "./active-query-revalidation";
import { invalidateRecordHistory, recordHistoryQueryOptions } from "./record-history-query";

const orpc = createBusabaseQueryUtils("/api/rpc", { batch: false }, "space");
const api = (read = vi.fn(async () => [])) =>
  ({ listRecordChangeRequests: read }) as unknown as BusabaseDashboardApiClient;

describe("record history refresh", () => {
  it("invalidates actual oRPC keys for the edited record, preserving other fresh records and all limit variants", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    const edited = orpc.records.listChangeRequests.queryOptions({
      input: { recordId: "edited", limit: 5 },
    });
    const otherLimit = orpc.records.listChangeRequests.queryOptions({
      input: { recordId: "edited", limit: 20 },
    });
    const other = orpc.records.listChangeRequests.queryOptions({
      input: { recordId: "other", limit: 5 },
    });
    for (const key of [edited.queryKey, otherLimit.queryKey, other.queryKey])
      client.setQueryData(key, []);
    await invalidateRecordHistory(client, orpc, ["edited", "edited"]);
    expect(client.getQueryState(edited.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherLimit.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other.queryKey)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("closed history is stale without a request, reopens fresh within 30 seconds, active history refreshes after a pending submission", async () => {
    const read = vi.fn(async () => [{ id: "created" }]);
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });
    const options = recordHistoryQueryOptions(api(read as never), "record");
    await client.fetchQuery(options);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue([{ id: "pending" }, { id: "created" }]);
    await invalidateRecordHistory(client, null, ["record"]);
    expect(read).toHaveBeenCalledTimes(1);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toHaveLength(2));
    read.mockResolvedValue([{ id: "merged" }, { id: "pending" }, { id: "created" }]);
    await invalidateRecordHistory(client, null, ["record"]);
    expect(observer.getCurrentResult().data).toHaveLength(3);
    expect(read).toHaveBeenCalledTimes(3);
    unsubscribe();
    client.clear();
  });

  it("scopes fallback cache by client and supports stale-only reconnection settling", async () => {
    const client = new QueryClient();
    const one = recordHistoryQueryOptions(api(), "record");
    const two = recordHistoryQueryOptions(api(), "record");
    expect(one.queryKey).not.toEqual(two.queryKey);
    client.setQueryData(one.queryKey, []);
    await invalidateRecordHistory(client, null, undefined, "none");
    expect(client.getQueryState(one.queryKey)?.isInvalidated).toBe(true);
    client.clear();
  });
});

it("reconciles only active canonical history on reconnect, without fetching closed histories", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const key = orpc.records.listChangeRequests.queryOptions({
    input: { recordId: "open", limit: 5 },
  }).queryKey;
  const closedKey = orpc.records.listChangeRequests.queryOptions({
    input: { recordId: "closed", limit: 5 },
  }).queryKey;
  const read = vi.fn(async () => ["new"]);
  client.setQueryData<unknown>(key, ["old"]);
  client.setQueryData<unknown>(closedKey, ["closed"]);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read });
  const unsubscribe = observer.subscribe(() => {});
  const scheduler = createWorkspaceReconciliationScheduler({
    queryClient: client,
    settleQueuedInvalidations: () => {},
    workspaceQueryKeys: [orpc.records.listChangeRequests.key()],
  });
  scheduler.onStreamConnected(0);
  scheduler.onStreamConnected(20_000);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(client.getQueryData(closedKey)).toEqual(["closed"]);
  scheduler.cancel();
  unsubscribe();
  client.clear();
});

it("waits for a pre-save initial read then performs one fresh trailing read", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  let resolve!: (value: string[]) => void;
  const oldRead = new Promise<string[]>((done) => {
    resolve = done;
  });
  const read = vi
    .fn()
    .mockImplementationOnce(() => oldRead)
    .mockResolvedValue(["saved"]);
  const options = recordHistoryQueryOptions(api(), "r1", orpc);
  const observer = new QueryObserver(client, { queryKey: options.queryKey, queryFn: read });
  const unsubscribe = observer.subscribe(() => {});
  expect(read).toHaveBeenCalledTimes(1);
  const invalidation = invalidateRecordHistory(client, orpc, ["r1", "r1"]);
  const overlapping = invalidateRecordHistory(client, orpc, ["r1"]);
  resolve(["before save"]);
  await Promise.all([invalidation, overlapping]);
  expect(client.getQueryData(options.queryKey)).toEqual(["saved"]);
  expect(read).toHaveBeenCalledTimes(2);
  unsubscribe();
  client.clear();
});
