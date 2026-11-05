import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  createWorkspaceReconciliationScheduler,
  getActiveQueryKeys,
} from "./active-query-revalidation";
import {
  createLiveInvalidationBatcher,
  type LiveInvalidationBatch,
  type LiveInvalidationFlushOptions,
} from "./live-invalidation";
import {
  createWorkspaceRevalidationGate,
  TAB_RETURN_RECONCILE_AFTER_MS,
} from "./workspace-revalidation";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const activeKey = ["records", "listPage", { input: { page: 1 } }] as const;
const inactiveKey = ["records", "listPage", { input: { page: 2 } }] as const;
const workspaceQueryKeys = [["records"]] as const;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const event = (
  kind: BusabaseLiveEvent["kind"],
  overrides: Partial<BusabaseLiveEvent> = {},
): BusabaseLiveEvent => ({
  kind,
  spaceId: "space-1",
  actorId: "user-1",
  changeRequestId: kind === "node.metadata_updated" ? null : "cr-1",
  baseId: null,
  nodeIds: [],
  recordIds: [],
  viewIds: [],
  operationCount: 0,
  ...overrides,
});

const mountQuery = (
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  queryFn: () => Promise<string>,
) => {
  queryClient.setQueryData(queryKey, "cached");
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return observer.subscribe(() => undefined);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("active query revalidation", () => {
  it("selects only exact keys with live observers", () => {
    const queryClient = new QueryClient();
    const unsubscribe = mountQuery(queryClient, activeKey, async () => "active");
    queryClient.setQueryData(inactiveKey, "inactive");

    expect(getActiveQueryKeys(queryClient)).toEqual([activeKey]);

    unsubscribe();
    queryClient.clear();
  });

  it("does nothing on first connect and reconciles once on reconnect", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "refetched");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const settleQueuedInvalidations = vi.fn();
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations,
    });

    expect(scheduler.onStreamConnected(0)).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();

    expect(scheduler.onStreamConnected(20_000)).toBe(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    // A 3-second retry is inside the throttle and must not issue another pass.
    expect(scheduler.onStreamConnected(23_000)).toBe(false);
    expect(settleQueuedInvalidations).toHaveBeenCalledTimes(1);

    unsubscribe();
    queryClient.clear();
  });

  it("does not refetch a cached query variant without an observer", async () => {
    const queryClient = new QueryClient();
    const activeQueryFn = vi.fn(async () => "active");
    const unsubscribe = mountQuery(queryClient, activeKey, activeQueryFn);
    queryClient.setQueryData(inactiveKey, "inactive");

    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);

    await vi.waitFor(() => expect(activeQueryFn).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryCache().find({ queryKey: inactiveKey, exact: true })?.state.isInvalidated,
    ).toBe(true);

    unsubscribe();
    queryClient.clear();
  });

  it("defers a disabled query until its route enables it", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(inactiveKey, "inactive");
    const queryFn = vi.fn(async () => "inactive");
    const observer = new QueryObserver(queryClient, {
      queryKey: inactiveKey,
      queryFn,
      enabled: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    await Promise.resolve();

    expect(queryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    observer.setOptions({
      queryKey: inactiveKey,
      queryFn,
      enabled: true,
      staleTime: Number.POSITIVE_INFINITY,
    });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    unsubscribe();
    queryClient.clear();
  });

  it("defers a hidden reconnect until the next visible return, even when brief", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "refetched");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const settleQueuedInvalidations = vi.fn();
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations,
    });

    expect(scheduler.onStreamConnected(0)).toBe(false);
    scheduler.onDocumentHidden(10_000);
    expect(scheduler.onStreamConnected(11_000)).toBe(false);
    expect(queryFn).not.toHaveBeenCalled();

    // The reconnect proved a gap, so even a 1-second hide converges on return.
    expect(scheduler.onUserReturned(11_100)).toBe(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(scheduler.onUserReturned(11_110)).toBe(false);
    expect(settleQueuedInvalidations).toHaveBeenCalledTimes(1);

    unsubscribe();
    queryClient.clear();
  });

  it("reconciles a focus-only return after a long blur while the window stayed visible", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "refetched");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });

    // Desktop shell / side-by-side window: blur and focus, never hidden.
    scheduler.onWindowBlurred(0);
    expect(scheduler.onUserReturned(TAB_RETURN_RECONCILE_AFTER_MS - 1)).toBe(false);
    scheduler.onWindowBlurred(100_000);
    expect(scheduler.onUserReturned(100_000 + TAB_RETURN_RECONCILE_AFTER_MS)).toBe(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(scheduler.onUserReturned(100_000 + TAB_RETURN_RECONCILE_AFTER_MS + 10)).toBe(false);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("still reconciles a reconnect immediately while the window is blurred but visible", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "refetched");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });

    expect(scheduler.onStreamConnected(0)).toBe(false);
    scheduler.onWindowBlurred(10_000);
    expect(scheduler.onStreamConnected(11_000)).toBe(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("settles queued event batches before reconciling the current screen", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "refetched");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const settleQueuedInvalidations = vi.fn();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations,
      gate: createWorkspaceRevalidationGate(5_000, TAB_RETURN_RECONCILE_AFTER_MS),
    });

    scheduler.onDocumentHidden(0);
    expect(scheduler.onUserReturned(TAB_RETURN_RECONCILE_AFTER_MS)).toBe(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    expect(settleQueuedInvalidations).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith(
      { queryKey: activeKey, exact: true, refetchType: "active" },
      { cancelRefetch: false },
    );
    expect(settleQueuedInvalidations.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateQueries.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(scheduler.onUserReturned(TAB_RETURN_RECONCILE_AFTER_MS + 10)).toBe(false);

    unsubscribe();
    queryClient.clear();
  });

  it("preserves stale invalidation for an inactive cached query during reconciliation", async () => {
    const queryClient = new QueryClient();
    const activeQueryFn = vi.fn(async () => "active");
    const unsubscribe = mountQuery(queryClient, activeKey, activeQueryFn);
    queryClient.setQueryData(inactiveKey, "inactive");
    const flush = vi.fn((_batch: LiveInvalidationBatch, options?: LiveInvalidationFlushOptions) => {
      void queryClient.invalidateQueries({
        queryKey: inactiveKey,
        refetchType: options?.refetchType,
      });
    });
    const batcher = createLiveInvalidationBatcher(flush, 60_000);
    batcher.push(event("change_request.created"));
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: () => batcher.flush({ refetchType: "none" }),
    });

    scheduler.onStreamConnected(0);
    expect(scheduler.onStreamConnected(20_000)).toBe(true);
    await vi.waitFor(() => expect(activeQueryFn).toHaveBeenCalledTimes(1));

    expect(flush).toHaveBeenCalledWith(expect.anything(), { refetchType: "none" });
    expect(
      queryClient.getQueryCache().find({ queryKey: inactiveKey, exact: true })?.state.isInvalidated,
    ).toBe(true);

    unsubscribe();
    queryClient.clear();
  });

  it("settles queued events and marks caches stale even without active queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(inactiveKey, "inactive");
    const settleQueuedInvalidations = vi.fn();
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations,
    });

    scheduler.onStreamConnected(0);
    expect(scheduler.onStreamConnected(20_000)).toBe(true);
    expect(settleQueuedInvalidations).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true);

    queryClient.clear();
  });

  it("joins an old request and fetches a fresh snapshot after it finishes", async () => {
    const queryClient = new QueryClient();
    const oldResponse = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(oldResponse.promise).mockResolvedValue("new");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const oldFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });

    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    expect(queryFn).toHaveBeenCalledTimes(1);
    oldResponse.resolve("old");
    await oldFetch;

    await vi.waitFor(() => expect(queryClient.getQueryData(activeKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(false);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("coalesces reconnects during a request into one trailing refresh", async () => {
    const queryClient = new QueryClient();
    const firstResponse = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(firstResponse.promise).mockResolvedValue("new");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
      gate: createWorkspaceRevalidationGate(0),
    });

    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(1);
    for (let now = 2; now < 102; now++) scheduler.onStreamConnected(now);
    expect(queryFn).toHaveBeenCalledTimes(1);
    firstResponse.resolve("old");

    await vi.waitFor(() => expect(queryClient.getQueryData(activeKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(2);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("does not mistake a replacement in-flight request for the trailing refresh", async () => {
    const queryClient = new QueryClient();
    const firstResponse = deferred<string>();
    const replacementResponse = deferred<string>();
    const queryFn = vi
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(replacementResponse.promise)
      .mockResolvedValue("new");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const firstFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    // Another existing refresh path cancels A and starts B before the latest
    // missed change. B's older snapshot must not discharge that newer signal.
    const replacementFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
    scheduler.onStreamConnected(26_000);
    await Promise.resolve();
    await Promise.resolve();
    replacementResponse.resolve("replacement-old");
    await Promise.all([firstFetch, replacementFetch]);

    await vi.waitFor(() => expect(queryClient.getQueryData(activeKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(3);
    firstResponse.resolve("cancelled-old");
    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("refetches a missed-event cache on re-entry even within its stale time", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(inactiveKey, "old");
    const queryFn = vi.fn(async () => "new");
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    expect(queryFn).not.toHaveBeenCalled();

    const observer = new QueryObserver(queryClient, {
      queryKey: inactiveKey,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(queryClient.getQueryData(inactiveKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("keeps an inactive in-flight cache stale after the old response arrives", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(inactiveKey, "cached");
    const oldResponse = deferred<string>();
    const queryFn = vi.fn(() => oldResponse.promise);
    const oldFetch = queryClient.fetchQuery({ queryKey: inactiveKey, queryFn });
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    oldResponse.resolve("old");
    await oldFetch;

    await vi.waitFor(() =>
      expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true),
    );
    expect(queryFn).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    queryClient.clear();
  });

  it("does not issue a trailing fetch after the user leaves the query", async () => {
    const queryClient = new QueryClient();
    const oldResponse = deferred<string>();
    const queryFn = vi.fn(() => oldResponse.promise);
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const oldFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    unsubscribe();
    oldResponse.resolve("old");
    await oldFetch;

    await vi.waitFor(() => expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    queryClient.clear();
  });

  it("drops trailing work after cancellation or replacement of a cache entry", async () => {
    for (const removeQuery of [false, true]) {
      const queryClient = new QueryClient();
      const oldResponse = deferred<string>();
      const queryFn = vi.fn(() => oldResponse.promise);
      const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
      const oldFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
      const scheduler = createWorkspaceReconciliationScheduler({
        queryClient,
        workspaceQueryKeys,
        settleQueuedInvalidations: vi.fn(),
      });
      scheduler.onStreamConnected(0);
      scheduler.onStreamConnected(20_000);
      if (removeQuery) {
        queryClient.removeQueries({ queryKey: activeKey, exact: true });
        queryClient.setQueryData(activeKey, "replacement");
      } else {
        scheduler.cancel();
      }
      oldResponse.resolve("old");
      await oldFetch;
      await Promise.resolve();
      expect(queryFn).toHaveBeenCalledTimes(1);
      if (removeQuery) {
        expect(queryClient.getQueryData(activeKey)).toBe("replacement");
        expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(false);
      }
      scheduler.cancel();
      unsubscribe();
      queryClient.clear();
    }
  });

  it("resumes a trailing refresh deferred by a brief hidden period", async () => {
    const queryClient = new QueryClient();
    const oldResponse = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(oldResponse.promise).mockResolvedValue("new");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const oldFetch = queryClient.refetchQueries({ queryKey: activeKey, exact: true });
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    scheduler.onDocumentHidden(20_100);
    oldResponse.resolve("old");
    await oldFetch;
    await vi.waitFor(() => expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    expect(scheduler.onUserReturned(20_200)).toBe(true);
    await vi.waitFor(() => expect(queryClient.getQueryData(activeKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(scheduler.onUserReturned(20_210)).toBe(false);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("leaves a failed refresh stale without an endless retry loop", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    await vi.waitFor(() => expect(queryClient.getQueryState(activeKey)?.status).toBe("error"));
    expect(queryClient.getQueryState(activeKey)?.isInvalidated).toBe(true);
    expect(queryFn).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });

  it("leaves unrelated and other-workspace queries untouched", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "unrelated");
    const otherKey = ["other-workspace", ...activeKey];
    const unrelatedKey = ["billing"];
    const unsubscribes = [otherKey, unrelatedKey].map((key) =>
      mountQuery(queryClient, key, queryFn),
    );
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys,
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
    for (const key of [otherKey, unrelatedKey]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }

    scheduler.cancel();
    for (const unsubscribe of unsubscribes) unsubscribe();
    queryClient.clear();
  });

  it("deduplicates overlapping workspace families before issuing requests", async () => {
    const queryClient = new QueryClient();
    const queryFn = vi.fn(async () => "new");
    const unsubscribe = mountQuery(queryClient, activeKey, queryFn);
    const scheduler = createWorkspaceReconciliationScheduler({
      queryClient,
      workspaceQueryKeys: [...workspaceQueryKeys, ["records", "listPage"], activeKey],
      settleQueuedInvalidations: vi.fn(),
    });
    scheduler.onStreamConnected(0);
    scheduler.onStreamConnected(20_000);
    await vi.waitFor(() => expect(queryClient.getQueryData(activeKey)).toBe("new"));
    expect(queryFn).toHaveBeenCalledTimes(1);

    scheduler.cancel();
    unsubscribe();
    queryClient.clear();
  });
});
