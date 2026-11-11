// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  type BusabaseQueryUtils,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";
import { SearchDialog } from "./search-dialog";

interface SearchRequest {
  request: Request;
  input: { query: string; mode?: string; sources?: string[] };
}

const clients: QueryClient[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
});

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setup = (pending = false) => {
  const requests: SearchRequest[] = [];
  const actual = createBusabaseQueryUtils("http://localhost/api/rpc", {
    batch: false,
    fetch: async (request) => {
      const { json: input } = await request.clone().json();
      requests.push({ request, input });
      if (pending) {
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        });
      }
      return new Response(
        JSON.stringify({
          json: request.url.includes("/nodes/searchByName")
            ? []
            : {
                query: input.query,
                limit: 6,
                offset: 0,
                hasMore: false,
                contentTruncated: false,
                results: [],
              },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const orpc = {
    search: actual.search,
    nodes: {
      searchByName: actual.nodes.searchByName,
      list: {
        queryOptions: (opts: { input: unknown }) => ({
          queryKey: ["nodes.list", opts.input],
          queryFn: async () => [],
        }),
      },
    },
    searchMetrics: {
      report: { mutationOptions: () => ({ mutationFn: async () => ({ accepted: true }) }) },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const nodeCache = createKnownNodeCache(`composition-${Math.random()}`);
  nodeCache.merge([
    {
      id: "delivery",
      type: "doc",
      name: "交付",
      slug: "delivery",
      path: "/doc/delivery",
    },
  ]);
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Router hook={() => ["/home", () => undefined]} searchHook={() => ""}>
        <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
      </Router>
    </QueryClientProvider>
  );
  const dialog = (open: boolean) => (
    <SearchDialog
      nodeCache={nodeCache}
      onClose={onClose}
      onSelect={onSelect}
      open={open}
      orpc={orpc}
    />
  );
  const view = render(dialog(true), { wrapper });
  return {
    ...view,
    requests,
    onClose,
    onSelect,
    close: () => view.rerender(dialog(false)),
    reopen: () => view.rerender(dialog(true)),
  };
};

describe("quick-search input composition", () => {
  it("shows local matches immediately and searches a settled word after 500 ms", async () => {
    const view = setup();
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "交付" } });
    expect((input as HTMLInputElement).value).toBe("交付");
    expect(view.getByText("交付")).toBeTruthy();
    await advance(499);
    expect(view.requests).toHaveLength(0);
    await advance(1);
    expect(view.requests).toHaveLength(5);
    expect(view.requests.every(({ input }) => input.query === "交付")).toBe(true);
    expect(view.requests.filter(({ input }) => input.mode === "quick")).toHaveLength(4);
  });

  it("restarts the debounce when an English word continues after a typing pause", async () => {
    const view = setup();
    fireEvent.change(view.getByRole("combobox"), { target: { value: "del" } });
    await advance(300);
    fireEvent.change(view.getByRole("combobox"), { target: { value: "delivery" } });
    await advance(499);
    expect(view.requests).toHaveLength(0);
    await advance(1);
    expect(view.requests).toHaveLength(5);
    expect(view.requests.every(({ input }) => input.query === "delivery")).toBe(true);
  });

  it("clears the pending debounce and ignores long pauses until composition commits", async () => {
    const view = setup();
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "j" } });
    await advance(400);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "jiao" } });
    await advance(1_000);
    fireEvent.change(input, { target: { value: "jiaofu" } });
    await advance(1_000);
    expect(view.requests).toHaveLength(0);
    fireEvent.compositionEnd(input, { target: { value: "交付" }, data: "交付" });
    fireEvent.change(input, { target: { value: "交付" } });
    await advance(499);
    expect(view.requests).toHaveLength(0);
    await advance(1);
    expect(view.requests).toHaveLength(5);
    await advance(1_000);
    expect(view.requests).toHaveLength(5);
    expect(view.requests.every(({ input }) => input.query === "交付")).toBe(true);
  });

  it("does not announce an empty or slow search before composition submits any search", async () => {
    const view = setup();
    const input = view.getByRole("combobox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "jiaofu" } });
    await advance(1_500);
    expect(view.requests).toHaveLength(0);
    expect(view.queryByText("No matches")).toBeNull();
    expect(view.queryByText("Searching indexed fields…")).toBeNull();
    expect(view.queryByText("This search needs more time")).toBeNull();
    expect(view.container.querySelector("[aria-live]")?.textContent).toBe("");
    fireEvent.compositionEnd(input, { target: { value: "尚未录入" }, data: "尚未录入" });
    await advance(500);
    await advance(1);
    expect(view.requests).toHaveLength(5);
    expect(view.getAllByText("No matches").length).toBeGreaterThan(0);
  });

  it("cancels in-flight content and node-name requests as soon as composition starts", async () => {
    const view = setup(true);
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "delivery" } });
    await advance(500);
    expect(view.requests).toHaveLength(5);
    fireEvent.compositionStart(input);
    await advance(0);
    expect(view.requests.every(({ request }) => request.signal.aborted)).toBe(true);
    await advance(1_000);
    expect(view.requests).toHaveLength(5);
  });

  it("waits a full debounce after composition commits the previously searched text again", async () => {
    const view = setup(true);
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "delivery" } });
    await advance(500);
    expect(view.requests).toHaveLength(5);
    fireEvent.compositionStart(input);
    await advance(0);
    expect(view.requests.every(({ request }) => request.signal.aborted)).toBe(true);
    fireEvent.compositionEnd(input, { data: "delivery" });
    await advance(499);
    expect(view.requests).toHaveLength(5);
    await advance(1);
    expect(view.requests).toHaveLength(10);
    expect(view.requests.every(({ input }) => input.query === "delivery")).toBe(true);
  });

  it("leaves IME Enter, Escape and arrow keys to the input method", async () => {
    const view = setup();
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "交付" } });
    fireEvent.compositionStart(input);
    for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp"]) {
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    }
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { data: "交付" });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSelect).toHaveBeenCalledTimes(1);
  });

  it("resets composition on close and does not submit the closed dialog's text", async () => {
    const view = setup();
    const input = view.getByRole("combobox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "jiaofu" } });
    view.close();
    await advance(1_000);
    expect(view.requests).toHaveLength(0);
    view.reopen();
    const reopenedInput = view.getByRole("combobox");
    expect((reopenedInput as HTMLInputElement).value).toBe("");
    fireEvent.change(reopenedInput, { target: { value: "delivery" } });
    await advance(500);
    expect(view.requests).toHaveLength(5);
    expect(view.requests.every(({ input }) => input.query === "delivery")).toBe(true);
  });
});
