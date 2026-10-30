// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { RecordVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLinkedRecords } from "./use-linked-records";

afterEach(cleanup);

const makeRecord = (id: string) =>
  ({
    id,
    baseId: "targets",
    base: { id: "targets", slug: "targets", fields: [] },
    headCommit: { id: `c_${id}`, payload: { title: id } },
  }) as unknown as RecordVO;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ json: body }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * A fake RPC server. `hasGetMany: false` answers the batch procedure the way an
 * older Busabase does — a bare 404 for an unknown procedure — which is what a
 * remote-tunnel space forwarding to an outdated local server returns.
 */
const fakeServer = ({ hasGetMany = true } = {}) => {
  const calls: Array<{ path: string; input: unknown }> = [];
  const fetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname.replace("/api/rpc/", "");
    const input = ((await request.json()) as { json: unknown }).json;
    calls.push({ path, input });
    if (path === "records/getMany") {
      if (!hasGetMany) return new Response("Not Found", { status: 404 });
      const { recordIds } = input as { recordIds: string[] };
      return json({
        records: recordIds.filter((id) => id !== "hidden").map(makeRecord),
        missingIds: recordIds.filter((id) => id === "hidden"),
      });
    }
    if (path === "records/get") {
      const { recordId } = input as { recordId: string };
      if (recordId === "hidden") {
        return json(
          { defined: false, code: "NOT_FOUND", status: 404, message: "Record not found" },
          404,
        );
      }
      return json(makeRecord(recordId));
    }
    return new Response("Not Found", { status: 404 });
  });
  const orpc = createBusabaseQueryUtils(
    "http://localhost/api/rpc",
    { batch: false, fetch: fetch as never },
    "space-a",
  );
  return { calls, orpc };
};

const wrapperFor = (cache: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
  };

const newCache = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("useLinkedRecords", () => {
  it("loads 250 ids in three getMany calls of at most 100 and seeds records.get", async () => {
    const { calls, orpc } = fakeServer();
    const cache = newCache();
    const ids = Array.from({ length: 250 }, (_, i) => `rec_${String(i).padStart(3, "0")}`);
    const { result } = renderHook(() => useLinkedRecords({ ids, orpc }), {
      wrapper: wrapperFor(cache),
    });
    await waitFor(() => expect(result.current.records).toHaveLength(250));
    expect(calls.map((call) => call.path)).toEqual([
      "records/getMany",
      "records/getMany",
      "records/getMany",
    ]);
    expect(calls.map((call) => (call.input as { recordIds: string[] }).recordIds.length)).toEqual([
      100, 100, 50,
    ]);
    expect(
      cache.getQueryData(orpc.records.get.queryKey({ input: { recordId: "rec_042" } })),
    ).toMatchObject({ id: "rec_042" });
  });

  it("drops ids reported missing and keeps the same chunk keys for a reordered id set", async () => {
    const { calls, orpc } = fakeServer();
    const cache = newCache();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useLinkedRecords({ ids, orpc }),
      { initialProps: { ids: ["b", "hidden", "a"] }, wrapper: wrapperFor(cache) },
    );
    await waitFor(() => expect(result.current.records.map((r) => r.id)).toEqual(["a", "b"]));
    rerender({ ids: ["a", "b", "hidden", "a"] });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toEqual({ recordIds: ["a", "b", "hidden"] });
  });

  it("falls back to one records.get per id when the server predates records.getMany", async () => {
    const { calls, orpc } = fakeServer({ hasGetMany: false });
    const cache = newCache();
    const { result } = renderHook(() => useLinkedRecords({ ids: ["a", "hidden", "b"], orpc }), {
      wrapper: wrapperFor(cache),
    });
    await waitFor(() => expect(result.current.records.map((r) => r.id)).toEqual(["a", "b"]));
    expect(calls.map((call) => call.path).sort()).toEqual([
      "records/get",
      "records/get",
      "records/get",
      "records/getMany",
    ]);
    expect(
      cache.getQueryData(orpc.records.get.queryKey({ input: { recordId: "b" } })),
    ).toMatchObject({ id: "b" });
  });

  it("keeps still-requested records while a changed id set loads", async () => {
    const { orpc } = fakeServer();
    const cache = newCache();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useLinkedRecords({ ids, orpc }),
      { initialProps: { ids: ["a", "b"] }, wrapper: wrapperFor(cache) },
    );
    await waitFor(() => expect(result.current.records).toHaveLength(2));
    rerender({ ids: ["b", "c"] });
    // Before the new chunk resolves, "b" is still shown and "a" is gone.
    expect(result.current.records.map((r) => r.id)).toEqual(["b"]);
    await waitFor(() => expect(result.current.records.map((r) => r.id)).toEqual(["b", "c"]));
  });

  it("uses the dashboard client when no oRPC utils are wired, and makes no call when disabled", async () => {
    const getRecords = vi.fn(async (ids: string[]) => ({
      records: ids.map(makeRecord),
      missingIds: [],
    }));
    const getRecord = vi.fn();
    const client = { getRecords, getRecord } as never;
    const cache = newCache();
    const { result } = renderHook(() => useLinkedRecords({ client, ids: ["x"] }), {
      wrapper: wrapperFor(cache),
    });
    await waitFor(() => expect(result.current.records.map((r) => r.id)).toEqual(["x"]));
    expect(getRecords).toHaveBeenCalledWith(["x"]);
    expect(getRecord).not.toHaveBeenCalled();

    const disabled = renderHook(() => useLinkedRecords({ client, enabled: false, ids: ["y"] }), {
      wrapper: wrapperFor(cache),
    });
    expect(disabled.result.current.records).toEqual([]);
    expect(getRecords).toHaveBeenCalledTimes(1);
  });
});
