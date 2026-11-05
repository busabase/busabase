import { QueryClient, type QueryKey, QueryObserver } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateWorkspaceWrite } from "./invalidate-workspace-write";
import { getMobileQueryRecovery, releaseMobileQueryRecovery } from "./mobile-query-recovery";

const clients: { client: QueryClient; scopeKey: string; stops: (() => void)[] }[] = [];

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scopeKey = "mobile:workspace-a";
  const orpc = createBusabaseQueryUtils("http://server.test/api/rpc", { batch: false }, scopeKey);
  const stops: (() => void)[] = [];
  clients.push({ client, scopeKey, stops });
  const observe = (queryKey: QueryKey) => {
    client.setQueryData(queryKey, "Before");
    const queryFn = vi.fn(async () => "After");
    const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
    stops.push(observer.subscribe(() => undefined));
    return queryFn;
  };
  return { client, scopeKey, orpc, observe, recovery: getMobileQueryRecovery(client, scopeKey) };
};

afterEach(() => {
  for (const { client, scopeKey, stops } of clients.splice(0)) {
    for (const stop of stops) stop();
    releaseMobileQueryRecovery(client, scopeKey);
    client.clear();
  }
});

describe("workspace writes refresh the mobile cache families", () => {
  it("refreshes review/history after a pending proposal without pretending the canonical record changed", async () => {
    const { client, scopeKey, orpc, observe, recovery } = setup();
    const recordKey = orpc.records.get.queryOptions({ input: { recordId: "record-a" } }).queryKey;
    const historyKey = orpc.records.listChangeRequests.queryOptions({
      input: { recordId: "record-a" },
    }).queryKey;
    const inboxKey = [scopeKey, "inbox", "review"];
    const activityKey = [scopeKey, "activity", "infinite"];
    const recordRead = observe(recordKey);
    const historyRead = observe(historyKey);
    const inboxRead = observe(inboxKey);
    const activityRead = observe(activityKey);
    recovery.registerRoute(Symbol("current-screen"), [
      recordKey,
      historyKey,
      inboxKey,
      activityKey,
    ]);

    invalidateWorkspaceWrite(client, { scopeKey, orpc }, { id: "cr-pending", materialized: false });

    await vi.waitFor(() => expect(historyRead).toHaveBeenCalledTimes(1));
    expect(inboxRead).toHaveBeenCalledTimes(1);
    expect(activityRead).toHaveBeenCalledTimes(1);
    expect(recordRead).not.toHaveBeenCalled();
    expect(client.getQueryData(recordKey)).toBe("Before");
    expect(client.getQueryState(recordKey)?.isInvalidated).toBe(false);
  });

  it("invalidates lists and calendar after an immediate write, downloading only the displayed list", async () => {
    const { client, scopeKey, orpc, observe, recovery } = setup();
    const listKey = [scopeKey, "base-records", "base-a", "view-a"];
    const calendarKey = [scopeKey, "base-calendar-range", "base-a", "2026-11"];
    const otherWorkspaceKey = ["mobile:workspace-b", "base-records", "base-a", "view-a"];
    const listRead = observe(listKey);
    const hiddenCalendarRead = observe(calendarKey);
    const otherWorkspaceRead = observe(otherWorkspaceKey);
    recovery.registerRoute(Symbol("current-screen"), [listKey]);

    invalidateWorkspaceWrite(client, { scopeKey, orpc }, { id: "record-a", materialized: true });

    await vi.waitFor(() => expect(listRead).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(listKey)).toBe("After");
    expect(hiddenCalendarRead).not.toHaveBeenCalled();
    expect(client.getQueryState(calendarKey)?.isInvalidated).toBe(true);
    expect(otherWorkspaceRead).not.toHaveBeenCalled();
    expect(client.getQueryState(otherWorkspaceKey)?.isInvalidated).toBe(false);
  });

  it("refreshes canonical data after merging a proposal, but approval alone only refreshes review data", async () => {
    const { client, scopeKey, orpc, observe, recovery } = setup();
    const listKey = [scopeKey, "base-records", "base-a", "view-a"];
    const reviewKey = orpc.changeRequests.get.queryOptions({
      input: { changeRequestId: "cr-a" },
    }).queryKey;
    const listRead = observe(listKey);
    const reviewRead = observe(reviewKey);
    recovery.registerRoute(Symbol("current-screen"), [listKey, reviewKey]);

    invalidateWorkspaceWrite(client, { scopeKey, orpc }, "reviewed");
    await vi.waitFor(() => expect(reviewRead).toHaveBeenCalledTimes(1));
    expect(listRead).not.toHaveBeenCalled();

    invalidateWorkspaceWrite(client, { scopeKey, orpc }, "merged");
    await vi.waitFor(() => expect(listRead).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(listKey)).toBe("After");
  });
});
