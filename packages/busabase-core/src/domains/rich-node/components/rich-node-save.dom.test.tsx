// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import {
  richNodeSaveStatusLabel,
  type SaveStatus,
  useNodeContentSave,
  useServerDocumentSync,
} from "./rich-node-shell";

const node = (id: string) => ({ id }) as NodeVO;
const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function setup(mutationFn: (input: unknown) => Promise<unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const reviewLookup = vi.fn(async (input: { changeRequestId: string }) => ({
    id: input.changeRequestId,
    status: "in_review",
  }));
  const orpc = {
    changeRequests: {
      get: {
        queryOptions: ({ input }: { input: { changeRequestId: string } }) => ({
          queryKey: ["changeRequests", "get", input],
          queryFn: () => reviewLookup(input),
        }),
      },
    },
    nodes: {
      updateContent: {
        mutationOptions: () => ({
          mutationFn: async (input: unknown) =>
            (await mutationFn(input)) ?? { id: "merged-save", status: "merged" },
        }),
      },
      list: { queryOptions: () => ({ queryKey: ["nodes", "list"] }) },
      get: {
        key: () => ["nodes", "get"],
        queryOptions: ({ input }: { input: { nodeId: string; type: string } }) => ({
          queryKey: ["nodes", "get", input],
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, orpc, reviewLookup, wrapper };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("rich-node manual saves", () => {
  it("refreshes the detail cache used when a saved board is revisited", async () => {
    let serverDocument = "original";
    const { client, orpc, wrapper } = setup(async () => {
      serverDocument = "saved drawing";
    });
    const queryOptions = {
      ...orpc.nodes.get.queryOptions({ input: { nodeId: "board-a-slug", type: "whiteboard" } }),
      queryFn: async () => serverDocument,
    };
    client.setQueryData(queryOptions.queryKey as readonly unknown[], "original");
    const { result } = renderHook(
      () => ({
        save: useNodeContentSave(orpc, node("board-a"), "whiteboard"),
        detail: useQuery(queryOptions),
      }),
      { wrapper },
    );
    await act(async () => {
      result.current.save.markDirty();
      await result.current.save.save({ version: 1, elements: [] });
    });
    expect(result.current.detail.data).toBe("saved drawing");
    expect(result.current.save.status).toBe("saved");
  });

  it("keeps edits made during a save unsaved and saves them on the next request", async () => {
    const request = deferred();
    const mutate = vi
      .fn()
      .mockImplementationOnce(() => request.promise)
      .mockResolvedValue(undefined);
    const { orpc, wrapper } = setup(mutate);
    const { result } = renderHook(() => useNodeContentSave(orpc, node("board-a"), "whiteboard"), {
      wrapper,
    });
    let firstSave!: Promise<boolean>;
    act(() => {
      result.current.markDirty();
      firstSave = result.current.save({ version: 1, elements: [{ id: "first" }] });
    });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    act(() => result.current.markDirty());
    expect(result.current.status).toBe("saving");
    await act(async () => {
      request.resolve();
      expect(await firstSave).toBe(true);
    });
    expect(result.current.status).toBe("dirty");
    await act(async () => {
      await result.current.save({ version: 1, elements: [{ id: "first" }, { id: "second" }] });
    });
    expect(result.current.status).toBe("saved");
    expect(mutate.mock.calls[1]?.[0]).toMatchObject({
      nodeId: "board-a",
      content: { document: { elements: [{ id: "first" }, { id: "second" }] } },
    });
  });

  it("does not carry a previous node's dirty state or failed request into another node", async () => {
    const request = deferred();
    const mutate = vi
      .fn()
      .mockImplementationOnce(() => request.promise)
      .mockResolvedValue(undefined);
    const { orpc, wrapper } = setup(mutate);
    const { result, rerender } = renderHook(
      ({ id }) => useNodeContentSave(orpc, node(id), "whiteboard"),
      { wrapper, initialProps: { id: "board-a" } },
    );
    let firstSave!: Promise<boolean>;
    act(() => {
      result.current.markDirty();
      firstSave = result.current.save({ version: 1, elements: [] });
    });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    rerender({ id: "board-b" });
    expect(result.current.status).toBe("saved");
    act(() => result.current.markDirty());
    await act(async () => {
      await result.current.save({ version: 1, elements: [{ id: "board-b-shape" }] });
    });
    expect(result.current.status).toBe("saved");
    await act(async () => {
      request.reject(new Error("old board failed"));
      expect(await firstSave).toBe(false);
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
  });

  it("rejects duplicate clicks synchronously and allows retry after a failed save", async () => {
    const request = deferred();
    const mutate = vi
      .fn()
      .mockImplementationOnce(() => request.promise)
      .mockResolvedValue(undefined);
    const { orpc, wrapper } = setup(mutate);
    const { result } = renderHook(() => useNodeContentSave(orpc, node("board-a"), "whiteboard"), {
      wrapper,
    });
    let firstSave!: Promise<boolean>;
    await act(async () => {
      firstSave = result.current.save({ version: 1, elements: [] });
      expect(await result.current.save({ version: 1, elements: [] })).toBe(false);
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.reject(new Error("network unavailable"));
      expect(await firstSave).toBe(false);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeTruthy();
    await act(async () => {
      expect(await result.current.save({ version: 1, elements: [] })).toBe(true);
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
  });

  it("shows a proposal as in review until the returned change request actually merges", async () => {
    const { client, orpc, wrapper } = setup(async () => ({
      id: "pending-save",
      status: "in_review",
    }));
    const { result } = renderHook(() => useNodeContentSave(orpc, node("board-a"), "whiteboard"), {
      wrapper,
    });
    await act(async () => {
      result.current.markDirty();
      expect(await result.current.save({ version: 1, elements: [{ id: "proposed" }] })).toBe(true);
    });
    expect(result.current.status).toBe("in_review");
    expect(result.current.reviewRequestId).toBe("pending-save");
    await act(async () => {
      client.setQueryData(["changeRequests", "get", { changeRequestId: "pending-save" }], {
        id: "pending-save",
        status: "merged",
      });
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.reviewRequestId).toBeNull();
  });

  it("keeps edits made during a proposal request dirty, including after that proposal merges", async () => {
    const request = deferred();
    const { client, orpc, wrapper } = setup(async () => {
      await request.promise;
      return { id: "pending-save", status: "in_review" };
    });
    const { result } = renderHook(() => useNodeContentSave(orpc, node("board-a"), "whiteboard"), {
      wrapper,
    });
    let submission!: Promise<boolean>;
    act(() => {
      result.current.markDirty();
      submission = result.current.save({ version: 1, elements: [{ id: "proposed" }] });
    });
    act(() => result.current.markDirty());
    await act(async () => {
      request.resolve();
      await submission;
    });
    expect(result.current.status).toBe("dirty");
    expect(result.current.reviewRequestId).toBe("pending-save");
    await act(async () => {
      client.setQueryData(["changeRequests", "get", { changeRequestId: "pending-save" }], {
        id: "pending-save",
        status: "merged",
      });
    });
    await waitFor(() => expect(result.current.reviewRequestId).toBeNull());
    expect(result.current.status).toBe("dirty");
  });

  it.each(["changes_requested", "rejected", "abandoned", "conflict"] as const)(
    "shows %s accurately, keeps the draft available for retry, and stops polling",
    async (reviewStatus) => {
      vi.useFakeTimers();
      const { client, orpc, reviewLookup, wrapper } = setup(async () => ({
        id: "pending-save",
        status: "in_review",
      }));
      const { result } = renderHook(() => useNodeContentSave(orpc, node("board-a"), "whiteboard"), {
        wrapper,
      });
      await act(async () => {
        await result.current.save({ version: 1, elements: [{ id: "draft" }] });
      });
      await act(async () => {
        client.setQueryData(["changeRequests", "get", { changeRequestId: "pending-save" }], {
          id: "pending-save",
          status: reviewStatus,
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe(reviewStatus);
      expect(result.current.reviewRequestId).toBe("pending-save");
      expect(richNodeSaveStatusLabel(result.current.status, coreMessagesByLocale.en)).toBe(
        reviewStatus === "conflict"
          ? "Conflict"
          : reviewStatus === "changes_requested"
            ? "Changes requested"
            : "Closed",
      );
      const calls = reviewLookup.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(reviewLookup).toHaveBeenCalledTimes(calls);
      act(() => result.current.markDirty());
      expect(result.current.status).toBe("dirty");
    },
  );
});

describe("rich-node server document sync", () => {
  const timestamp = "2026-10-22T10:00:00.000Z";
  const syncNode = { ...node("board-a"), updatedAt: timestamp };

  it("applies fresh content after a cached revisit even when the node timestamp is unchanged", () => {
    let localDocument = { elements: ["first"] };
    const apply = vi.fn((document: typeof localDocument) => {
      localDocument = document;
    });
    const { rerender } = renderHook(
      ({ serverDocument }) =>
        useServerDocumentSync({
          apply,
          getLocalDocument: () => localDocument,
          node: syncNode,
          serverDocument,
          status: "saved",
        }),
      { initialProps: { serverDocument: { elements: ["first"] } } },
    );
    expect(apply).not.toHaveBeenCalled();
    rerender({ serverDocument: { elements: ["first", "second"] } });
    expect(localDocument.elements).toEqual(["first", "second"]);
    expect(apply).toHaveBeenCalledTimes(1);
    rerender({ serverDocument: { elements: ["first", "second"] } });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it.each(["dirty", "saving", "in_review", "error"] as const)(
    "preserves local %s content while a fresh same-timestamp document arrives",
    (status) => {
      const initialDocument = { elements: ["first"] };
      let localDocument = initialDocument;
      const apply = vi.fn((document: typeof localDocument) => {
        localDocument = document;
      });
      const { rerender } = renderHook(
        ({
          serverDocument,
          status,
        }: {
          serverDocument: typeof localDocument;
          status: SaveStatus;
        }) =>
          useServerDocumentSync({
            apply,
            getLocalDocument: () => localDocument,
            node: syncNode,
            serverDocument,
            status,
          }),
        { initialProps: { serverDocument: initialDocument, status: "saved" as SaveStatus } },
      );
      localDocument = { elements: ["first", "local edit"] };
      const serverDocument = { elements: ["first", "server edit"] };
      rerender({ serverDocument, status });
      expect(apply).not.toHaveBeenCalled();
      expect(localDocument.elements).toEqual(["first", "local edit"]);
      rerender({ serverDocument, status: "saved" });
      expect(apply).toHaveBeenCalledExactlyOnceWith(serverDocument);
    },
  );

  it("does not restore stale cached content after saving, and acknowledges a matching fresh result", () => {
    const initialDocument = { elements: ["first"] };
    let localDocument = initialDocument;
    const apply = vi.fn((document: typeof localDocument) => {
      localDocument = document;
    });
    const { rerender } = renderHook(
      ({ serverDocument, status }: { serverDocument: typeof localDocument; status: SaveStatus }) =>
        useServerDocumentSync({
          apply,
          getLocalDocument: () => localDocument,
          node: syncNode,
          serverDocument,
          status,
        }),
      { initialProps: { serverDocument: initialDocument, status: "saved" as SaveStatus } },
    );
    localDocument = { elements: ["first", "newly saved"] };
    rerender({ serverDocument: initialDocument, status: "saving" });
    rerender({ serverDocument: initialDocument, status: "saved" });
    expect(apply).not.toHaveBeenCalled();
    expect(localDocument.elements).toEqual(["first", "newly saved"]);
    rerender({ serverDocument: { ...localDocument }, status: "saved" });
    expect(apply).not.toHaveBeenCalled();
    rerender({ serverDocument: { elements: ["first", "newly saved", "later"] }, status: "saved" });
    expect(localDocument.elements).toEqual(["first", "newly saved", "later"]);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
