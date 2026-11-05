import { QueryClient, QueryObserver, skipToken } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMobileQueryRecovery,
  getMobileQueryRecovery,
  invalidateMobileWorkspaceQueries,
  type MobileQueryRecovery,
  releaseMobileQueryRecovery,
} from "./mobile-query-recovery";

const scope = "mobile:space-a";
const recordKey = [[scope, "records", "get"], { input: { recordId: "record-a" } }] as const;
const otherRecordKey = [[scope, "records", "get"], { input: { recordId: "record-b" } }] as const;
const recordsKey = [scope, "base-records", "base-a", "view-a", 50] as const;
const cleanups: (() => void)[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const recovery = createMobileQueryRecovery(client, scope);
  cleanups.push(() => {
    recovery.cancel();
    client.clear();
  });
  return { client, recovery };
}

function mount(client: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<string>) {
  client.setQueryData(queryKey, "Before");
  const observer = new QueryObserver(client, { queryKey, queryFn, staleTime: Infinity });
  const stop = observer.subscribe(() => undefined);
  cleanups.push(() => observer.destroy());
  return { observer, stop };
}

function show(recovery: MobileQueryRecovery, keys: readonly (readonly unknown[])[]) {
  const token = Symbol("visible");
  recovery.registerRoute(token, keys);
  return () => recovery.unregisterRoute(token);
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe("native query recovery", () => {
  it("registers a cold screen without fetching its already loaded data again", async () => {
    const { client, recovery } = setup();
    const queryFn = vi.fn(async () => "After");
    mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("refreshes only the exact visible route, even while another record retains active observers", async () => {
    const { client, recovery } = setup();
    const visibleRead = vi.fn(async () => "After");
    const hiddenRead = vi.fn(async () => "Hidden after");
    mount(client, recordKey, visibleRead);
    mount(client, otherRecordKey, hiddenRead);
    show(recovery, [recordKey]);
    recovery.reconcile();
    await vi.waitFor(() => expect(client.getQueryData(recordKey)).toBe("After"));
    expect(hiddenRead).not.toHaveBeenCalled();
    expect(client.getQueryState(otherRecordKey)?.isInvalidated).toBe(true);
  });

  it("includes custom Base and calendar queries without touching other scopes", async () => {
    const { client, recovery } = setup();
    const calendarKey = [scope, "base-calendar-range", "base-a", "2026-11"];
    const outsideKey = ["mobile:space-b", "base-records", "base-a"];
    const recordsRead = vi.fn(async () => "Records after");
    const calendarRead = vi.fn(async () => "Calendar after");
    const outsideRead = vi.fn(async () => "Other after");
    mount(client, recordsKey, recordsRead);
    mount(client, calendarKey, calendarRead);
    mount(client, outsideKey, outsideRead);
    show(recovery, [recordsKey, calendarKey, outsideKey]);
    recovery.reconcile();
    await vi.waitFor(() => expect(calendarRead).toHaveBeenCalledTimes(1));
    expect(recordsRead).toHaveBeenCalledTimes(1);
    expect(outsideRead).not.toHaveBeenCalled();
    expect(client.getQueryState(outsideKey)?.isInvalidated).toBe(false);
  });

  it("does not cancel an old request and follows it with exactly one latest read", async () => {
    const { client, recovery } = setup();
    const old = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("After");
    const { observer } = mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    const oldRead = observer.refetch();
    recovery.reconcile();
    recovery.reconcile();
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(1);
    old.resolve("Old response");
    await oldRead;
    await vi.waitFor(() => expect(client.getQueryData(recordKey)).toBe("After"));
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("coalesces requests reported while waiting for the old response", async () => {
    const { client, recovery } = setup();
    const old = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("After");
    const { observer } = mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    const oldRead = observer.refetch();
    recovery.reconcile();
    await Promise.resolve();
    recovery.reconcile();
    await Promise.resolve();
    old.resolve("Old response");
    await oldRead;
    await vi.waitFor(() => expect(client.getQueryData(recordKey)).toBe("After"));
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("restores stale state after an inactive old response without downloading a hidden page", async () => {
    const { client, recovery } = setup();
    const old = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("After");
    const { observer, stop } = mount(client, recordsKey, queryFn);
    const oldRead = observer.refetch();
    stop();
    recovery.reconcile();
    await Promise.resolve();
    old.resolve("Old response");
    await oldRead;
    await vi.waitFor(() => expect(client.getQueryState(recordsKey)?.isInvalidated).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
    const returning = new QueryObserver(client, {
      queryKey: recordsKey,
      queryFn,
      staleTime: Infinity,
    });
    cleanups.push(() => returning.destroy());
    returning.subscribe(() => undefined);
    await vi.waitFor(() => expect(client.getQueryData(recordsKey)).toBe("After"));
  });

  it("defers reads while backgrounded and coalesces simultaneous foreground and network recovery", async () => {
    const { client, recovery } = setup();
    const queryFn = vi.fn(async () => "After");
    mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    recovery.setForeground(false);
    recovery.setOnline(false);
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
    expect(client.getQueryState(recordKey)?.isInvalidated).toBe(true);
    recovery.setForeground(true);
    recovery.setOnline(true);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(recordKey)).toBe("After");
  });

  it("does not fetch a route left while its old request was pending", async () => {
    const { client, recovery } = setup();
    const old = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("After");
    const { observer } = mount(client, recordKey, queryFn);
    const leave = show(recovery, [recordKey]);
    const oldRead = observer.refetch();
    recovery.reconcile();
    await Promise.resolve();
    leave();
    old.resolve("Old response");
    await oldRead;
    await vi.waitFor(() => expect(client.getQueryState(recordKey)?.isInvalidated).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
    show(recovery, [recordKey]);
    recovery.reconcile();
    await vi.waitFor(() => expect(client.getQueryData(recordKey)).toBe("After"));
  });

  it("respects family filters for a pending review without invalidating canonical records", async () => {
    const { client, recovery } = setup();
    const inboxKey = [scope, "inbox", "review"];
    const inboxRead = vi.fn(async () => "New pending review");
    const recordRead = vi.fn(async () => "After");
    mount(client, inboxKey, inboxRead);
    mount(client, recordKey, recordRead);
    show(recovery, [inboxKey, recordKey]);
    recovery.reconcile([[scope, "inbox"]]);
    await vi.waitFor(() => expect(inboxRead).toHaveBeenCalledTimes(1));
    expect(recordRead).not.toHaveBeenCalled();
    expect(client.getQueryState(recordKey)?.isInvalidated).toBe(false);
  });

  it("leaves disabled visible queries stale without forcing their query function", async () => {
    const { client, recovery } = setup();
    client.setQueryData(recordsKey, "Before");
    const observer = new QueryObserver(client, { queryKey: recordsKey, queryFn: skipToken });
    observer.subscribe(() => undefined);
    cleanups.push(() => observer.destroy());
    show(recovery, [recordsKey]);
    recovery.reconcile();
    await vi.waitFor(() => expect(client.getQueryState(recordsKey)?.isInvalidated).toBe(true));
    expect(client.getQueryState(recordsKey)?.fetchStatus).toBe("idle");
  });

  it("stops a scoped queued fetch and leaves another scope alone after disposal", async () => {
    const { client, recovery } = setup();
    const old = deferred<string>();
    const queryFn = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("After");
    const { observer } = mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    const oldRead = observer.refetch();
    recovery.reconcile();
    await Promise.resolve();
    recovery.cancel();
    old.resolve("Old response");
    await oldRead;
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(recordKey)).toBe("Before");
    expect(client.getQueryState(recordKey)?.isInvalidated).toBe(true);
  });

  it("keeps a failed refresh stale without an endless refresh loop", async () => {
    const { client, recovery } = setup();
    const queryFn = vi.fn(async () => {
      throw new Error("offline");
    });
    mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    recovery.reconcile();
    await vi.waitFor(() => expect(client.getQueryState(recordKey)?.status).toBe("error"));
    expect(client.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("uses the same recovery registry for route registration and successful writes", async () => {
    const { client } = setup();
    const recovery = getMobileQueryRecovery(client, scope);
    cleanups.push(() => releaseMobileQueryRecovery(client, scope));
    const queryFn = vi.fn(async () => "Saved");
    mount(client, recordKey, queryFn);
    show(recovery, [recordKey]);
    invalidateMobileWorkspaceQueries(client, scope);
    await vi.waitFor(() => expect(client.getQueryData(recordKey)).toBe("Saved"));
  });
});
