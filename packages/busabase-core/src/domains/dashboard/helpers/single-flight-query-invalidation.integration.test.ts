import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createSingleFlightQueryInvalidator } from "./single-flight-query-invalidation";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("single-flight query invalidation with TanStack Query", () => {
  it("preserves the initial fetch and then converges with one real trailing fetch", async () => {
    const initialFetch = deferred();
    const trailingFetch = deferred();
    let initialSignal: AbortSignal | undefined;
    const queryFn = vi
      .fn()
      .mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
        initialSignal = signal;
        await initialFetch.promise;
        return "initial";
      })
      .mockImplementationOnce(async () => {
        await trailingFetch.promise;
        return "latest";
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ["changeRequests", "inboxSnapshot"] as const;
    const observer = new QueryObserver(queryClient, { queryFn, queryKey });
    const unsubscribe = observer.subscribe(() => undefined);
    const invalidator = createSingleFlightQueryInvalidator(queryClient, queryKey);

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    invalidator.request();
    expect(initialSignal?.aborted).toBe(false);

    initialFetch.resolve();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    expect(initialSignal?.aborted).toBe(false);

    trailingFetch.resolve();
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe("latest"));

    invalidator.cancel();
    unsubscribe();
    queryClient.clear();
  });
});
