import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  QueryClient,
  type QueryFunction,
  QueryObserver,
  type QueryState,
} from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createWorkspaceReconciliationScheduler } from "./active-query-revalidation";

const queryKey = ["records", "listPage", { input: { page: 1 } }] as const;
const workspaceQueryKeys = [["records"]] as const;
const beforeGap = "canonical-before-gap";
const afterGap = "canonical-after-gap";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const within = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const waitForQuery = async (
  queryClient: QueryClient,
  predicate: (state: QueryState<string> | undefined) => boolean,
) => {
  const ready = deferred();
  const check = () => {
    if (predicate(queryClient.getQueryState<string>(queryKey))) ready.resolve();
  };
  const unsubscribe = queryClient.getQueryCache().subscribe(check);
  try {
    check();
    await within(ready.promise, "the expected query state");
  } finally {
    unsubscribe();
  }
};

const createHttpFixture = (holdFirstResponse = false) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
  let settlements = 0;
  const scheduler = createWorkspaceReconciliationScheduler({
    queryClient,
    workspaceQueryKeys,
    settleQueuedInvalidations: () => {
      settlements++;
    },
  });
  const firstRequest = deferred();
  const cleanupController = new AbortController();
  const fetchSignals: AbortSignal[] = [];
  const observers: QueryObserver<string>[] = [];
  const requests: {
    method: string | undefined;
    path: string | undefined;
    snapshot: string;
    finished: boolean;
    closedBeforeFinish: boolean;
  }[] = [];
  let value = beforeGap;
  let url = "";
  let releaseHeldResponse: (() => void) | undefined;
  const server = createServer((request, response) => {
    // Freeze the snapshot at receipt, not when the slow response is released.
    const captured = {
      method: request.method,
      path: request.url,
      snapshot: value,
      finished: false,
      closedBeforeFinish: false,
    };
    requests.push(captured);
    response.once("finish", () => {
      captured.finished = true;
    });
    response.once("close", () => {
      captured.closedBeforeFinish = !response.writableFinished;
    });
    const send = () => {
      if (!response.destroyed) {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(captured.snapshot);
      }
    };
    if (holdFirstResponse && requests.length === 1) releaseHeldResponse = send;
    else send();
    firstRequest.resolve();
  });

  const releaseFirstResponse = () => {
    releaseHeldResponse?.();
    releaseHeldResponse = undefined;
  };

  return {
    queryClient,
    scheduler,
    requests,
    fetchSignals,
    firstRequest: firstRequest.promise,
    releaseFirstResponse,
    get settlements() {
      return settlements;
    },
    setValue(next: string) {
      value = next;
    },
    async listen() {
      await within(
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        }),
        "the HTTP listener",
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      url = `http://127.0.0.1:${address.port}/records`;
    },
    async fetchValue(signal?: AbortSignal) {
      const combinedSignal = signal
        ? AbortSignal.any([signal, cleanupController.signal])
        : cleanupController.signal;
      fetchSignals.push(combinedSignal);
      const response = await fetch(url, { signal: combinedSignal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
    observe(queryFn: QueryFunction<string>) {
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn,
        staleTime: Number.POSITIVE_INFINITY,
      });
      observers.push(observer);
      const unsubscribe = observer.subscribe(() => undefined);
      return { observer, unsubscribe };
    },
    async close() {
      scheduler.cancel();
      for (const observer of observers) observer.destroy();
      queryClient.clear();
      cleanupController.abort();
      releaseFirstResponse();
      if (!server.listening) return;
      await within(
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
        "HTTP server shutdown",
      );
    },
  };
};

describe("workspace reconciliation over real HTTP", () => {
  it("keeps an old active HTTP request and follows it with exactly one fresh GET", async () => {
    const fixture = createHttpFixture(true);
    const { queryClient, scheduler } = fixture;
    try {
      await fixture.listen();
      queryClient.setQueryData(queryKey, "cached");
      const { observer } = fixture.observe(({ signal }) => fixture.fetchValue(signal));
      const oldFetch = queryClient.refetchQueries({ queryKey, exact: true });
      await within(fixture.firstRequest, "the old HTTP snapshot");
      expect(fixture.requests[0]?.snapshot).toBe(beforeGap);

      expect(scheduler.onStreamConnected(0)).toBe(false);
      fixture.setValue(afterGap);
      expect(scheduler.onStreamConnected(20_000)).toBe(true);
      expect(fixture.fetchSignals).toHaveLength(1);
      expect(fixture.fetchSignals[0]?.aborted).toBe(false);
      expect(fixture.requests[0]?.finished).toBe(false);
      expect(fixture.requests[0]?.closedBeforeFinish).toBe(false);

      fixture.releaseFirstResponse();
      await within(oldFetch, "the original HTTP fetch to finish");
      await waitForQuery(
        queryClient,
        (state) => state?.data === afterGap && state.fetchStatus === "idle",
      );
      await nextTurn();

      expect(observer.getCurrentResult().data).toBe(afterGap);
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
      expect(fixture.requests).toEqual([
        {
          method: "GET",
          path: "/records",
          snapshot: beforeGap,
          finished: true,
          closedBeforeFinish: false,
        },
        {
          method: "GET",
          path: "/records",
          snapshot: afterGap,
          finished: true,
          closedBeforeFinish: false,
        },
      ]);
      expect(fixture.fetchSignals).toHaveLength(2);
      expect(fixture.fetchSignals.every((signal) => !signal.aborted)).toBe(true);
      expect(fixture.settlements).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("marks a warm inactive Infinity-staleTime query stale without HTTP until it mounts", async () => {
    const fixture = createHttpFixture();
    const { queryClient, scheduler } = fixture;
    try {
      await fixture.listen();
      const queryFn: QueryFunction<string> = ({ signal }) => fixture.fetchValue(signal);
      expect(await within(queryClient.fetchQuery({ queryKey, queryFn }), "cache warming")).toBe(
        beforeGap,
      );
      const query = queryClient.getQueryCache().find({ queryKey, exact: true });
      expect(query?.getObserversCount()).toBe(0);
      expect(query?.isStaleByTime(Number.POSITIVE_INFINITY)).toBe(false);
      expect(fixture.requests).toHaveLength(1);

      expect(scheduler.onStreamConnected(0)).toBe(false);
      fixture.setValue(afterGap);
      expect(scheduler.onStreamConnected(20_000)).toBe(true);
      await nextTurn();

      expect(queryClient.getQueryData(queryKey)).toBe(beforeGap);
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
      expect(query?.isStaleByTime(Number.POSITIVE_INFINITY)).toBe(true);
      expect(fixture.fetchSignals).toHaveLength(1);
      expect(fixture.requests).toHaveLength(1);

      const { observer } = fixture.observe(queryFn);
      await waitForQuery(
        queryClient,
        (state) => state?.data === afterGap && state.fetchStatus === "idle",
      );
      await nextTurn();

      expect(observer.getCurrentResult().data).toBe(afterGap);
      expect(observer.getCurrentResult().isStale).toBe(false);
      expect(fixture.fetchSignals).toHaveLength(2);
      expect(fixture.requests.map(({ method, snapshot }) => ({ method, snapshot }))).toEqual([
        { method: "GET", snapshot: beforeGap },
        { method: "GET", snapshot: afterGap },
      ]);
      expect(fixture.settlements).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("restores stale state without a trailing GET when the route leaves during an old request", async () => {
    const fixture = createHttpFixture(true);
    const { queryClient, scheduler } = fixture;
    try {
      await fixture.listen();
      queryClient.setQueryData(queryKey, "cached");
      // Not consuming TanStack's signal lets the old HTTP response warm the
      // cache after departure, rather than testing observer-driven cancellation.
      const { unsubscribe } = fixture.observe(() => fixture.fetchValue());
      const oldFetch = queryClient.refetchQueries({ queryKey, exact: true });
      await within(fixture.firstRequest, "the old HTTP snapshot");

      expect(scheduler.onStreamConnected(0)).toBe(false);
      fixture.setValue(afterGap);
      expect(scheduler.onStreamConnected(20_000)).toBe(true);
      unsubscribe();
      expect(queryClient.getQueryCache().find({ queryKey, exact: true })?.isActive()).toBe(false);

      fixture.releaseFirstResponse();
      await within(oldFetch, "the departed route's old HTTP fetch");
      await waitForQuery(
        queryClient,
        (state) => state?.data === beforeGap && state.fetchStatus === "idle" && state.isInvalidated,
      );
      await nextTurn();

      expect(queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount()).toBe(
        0,
      );
      expect(fixture.fetchSignals).toHaveLength(1);
      expect(fixture.fetchSignals[0]?.aborted).toBe(false);
      expect(fixture.requests).toEqual([
        {
          method: "GET",
          path: "/records",
          snapshot: beforeGap,
          finished: true,
          closedBeforeFinish: false,
        },
      ]);
    } finally {
      await fixture.close();
    }
  });
});
