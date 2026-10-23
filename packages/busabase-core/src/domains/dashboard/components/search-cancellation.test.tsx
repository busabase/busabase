// @vitest-environment jsdom

import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  type BusabaseQueryUtils,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { createKnownNodeCache } from "../helpers/known-node-cache";
import { SearchDialog } from "./search-dialog";

afterEach(cleanup);

function setup(fetchSearch: (request: Request) => Promise<Response>) {
  const actual = createBusabaseQueryUtils("http://localhost/api/rpc", { fetch: fetchSearch });
  const emptyList = (key: string) => ({
    queryOptions: () => ({ queryKey: [key], queryFn: async () => [] }),
  });
  let orpc = {
    search: actual.search,
    nodes: { list: emptyList("nodes"), searchByName: emptyList("node-names") },
    searchMetrics: {
      report: { mutationOptions: () => ({ mutationFn: async () => ({ accepted: true }) }) },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 10 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Router hook={() => ["/home", () => undefined]} searchHook={() => ""}>
        <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
      </Router>
    </QueryClientProvider>
  );
  const nodeCache = createKnownNodeCache(`search-cancel-${Math.random()}`);
  const dialog = (open: boolean) => (
    <SearchDialog nodeCache={nodeCache} onClose={() => undefined} open={open} orpc={orpc} />
  );
  const view = render(dialog(true), { wrapper });
  return {
    ...view,
    close: () => view.rerender(dialog(false)),
    recreateUtilities: () => {
      // React Compiler can observe a fresh oRPC procedure proxy on a parent
      // render even when all generated query keys remain identical.
      orpc = {
        ...orpc,
        search: createBusabaseQueryUtils("http://localhost/api/rpc", { fetch: fetchSearch }).search,
      };
      view.rerender(dialog(true));
    },
  };
}

const recordResult = {
  kind: "record",
  id: "recovered-record",
  title: "Recovered search result",
  href: "/base/probe/recovered-record",
  body: "",
  eyebrow: "Probe",
};

const searchResponse = (results: Array<typeof recordResult> = []) =>
  new Response(
    JSON.stringify({
      json: {
        query: "probe",
        limit: 6,
        offset: 0,
        hasMore: false,
        contentTruncated: false,
        results,
      },
    }),
    { headers: { "content-type": "application/json" } },
  );

describe("quick-search transport cancellation", () => {
  it("aborts each independent request immediately when typing supersedes it or closing", async () => {
    const requests: Request[] = [];
    const view = setup(
      (request) =>
        new Promise((_resolve, reject) => {
          requests.push(request);
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        }),
    );
    const input = view.getByRole("combobox");
    fireEvent.change(input, { target: { value: "first" } });
    await waitFor(() => expect(requests).toHaveLength(4));
    expect(requests.every((request) => !request.url.includes("__batch__"))).toBe(true);
    fireEvent.change(input, { target: { value: "second" } });
    // No second debounce is needed before the first queries are canceled.
    await waitFor(() =>
      expect(requests.slice(0, 4).every((request) => request.signal.aborted)).toBe(true),
    );
    await waitFor(() => expect(requests).toHaveLength(8));
    view.close();
    await waitFor(() => expect(requests.every((request) => request.signal.aborted)).toBe(true));
  });

  it("keeps current requests and successful results when utility proxy identities change", async () => {
    const pending: Array<{ request: Request; resolve: (response: Response) => void }> = [];
    const view = setup(
      (request) =>
        new Promise((resolve, reject) => {
          pending.push({ request, resolve });
          request.signal.addEventListener("abort", () => reject(request.signal.reason), {
            once: true,
          });
        }),
    );
    fireEvent.change(view.getByRole("combobox"), { target: { value: "probe" } });
    await waitFor(() => expect(pending).toHaveLength(4));
    view.recreateUtilities();
    expect(pending.every(({ request }) => !request.signal.aborted)).toBe(true);

    for (const entry of pending) {
      const input = await entry.request.clone().json();
      if (input.json.sources[0] === "records") entry.resolve(searchResponse([recordResult]));
    }
    await view.findByTestId("search-result");
    view.recreateUtilities();
    expect(view.getByText(recordResult.title)).toBeTruthy();
    expect(pending.every(({ request }) => !request.signal.aborted)).toBe(true);
    for (const entry of pending) entry.resolve(searchResponse());
    await waitFor(() => expect(view.getByText(recordResult.title)).toBeTruthy());
  });

  it("retries a timeout only on manual action and retains recovered results across new proxies", async () => {
    let attempts = 0;
    let timeout = true;
    const view = setup(async (request) => {
      attempts++;
      if (timeout) throw new ORPCError("TIMEOUT", { message: "Search took too long." });
      const input = await request.json();
      return searchResponse(input.json.sources[0] === "records" ? [recordResult] : []);
    });
    fireEvent.change(view.getByRole("combobox"), { target: { value: "slow" } });
    await waitFor(() => expect(attempts).toBe(4));
    const retry = await view.findByRole("button", { name: "Try again" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(attempts).toBe(4);
    timeout = false;
    view.recreateUtilities();
    fireEvent.click(retry);
    await waitFor(() => expect(attempts).toBe(8));
    await waitFor(() => expect(view.queryByRole("button", { name: "Try again" })).toBeNull());
    expect(view.getByText(recordResult.title)).toBeTruthy();
    view.recreateUtilities();
    expect(view.getByText(recordResult.title)).toBeTruthy();
    expect(attempts).toBe(8);
  });
});
