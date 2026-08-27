import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createSingleFlightQueryInvalidator } from "./single-flight-query-invalidation";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type QueryInvalidationClient = Pick<QueryClient, "invalidateQueries" | "isFetching">;

const createClient = (fetching: number, responses: Promise<void>[]) => {
  const invalidateQueries = vi.fn(async () => {
    await responses.shift();
  });
  const client = {
    invalidateQueries,
    isFetching: vi.fn(() => fetching),
  } as unknown as QueryInvalidationClient;
  return { client, invalidateQueries };
};

describe("single-flight query invalidation", () => {
  it("does not cancel an active fetch and performs one trailing refresh", async () => {
    const activeFetch = deferred();
    const trailingFetch = deferred();
    const { client, invalidateQueries } = createClient(1, [
      activeFetch.promise,
      trailingFetch.promise,
    ]);
    const queryKey: QueryKey = ["changeRequests", "inboxSnapshot"];
    const invalidator = createSingleFlightQueryInvalidator(client, queryKey);

    invalidator.request();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey }, { cancelRefetch: false });

    activeFetch.resolve();
    await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
    trailingFetch.resolve();
  });

  it("collapses an event storm during a fetch into one dirty trailing refresh", async () => {
    const firstFetch = deferred();
    const trailingFetch = deferred();
    const { client, invalidateQueries } = createClient(0, [
      firstFetch.promise,
      trailingFetch.promise,
    ]);
    const invalidator = createSingleFlightQueryInvalidator(client, ["inboxSnapshot"]);

    invalidator.request();
    for (let index = 0; index < 100; index++) invalidator.request();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    firstFetch.resolve();
    await vi.waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(2));
    trailingFetch.resolve();
    await Promise.resolve();
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("drops a queued trailing refresh after cancellation", async () => {
    const activeFetch = deferred();
    const { client, invalidateQueries } = createClient(0, [activeFetch.promise]);
    const invalidator = createSingleFlightQueryInvalidator(client, ["inboxSnapshot"]);

    invalidator.request();
    invalidator.request();
    invalidator.cancel();
    activeFetch.resolve();
    await Promise.resolve();

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });
});
