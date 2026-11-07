// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  type BusabaseQueryUtils,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider, coreMessagesEn } from "../../../i18n";
import { SearchView } from "./search-view";

afterEach(cleanup);

const searchResponse = (contentTruncated: boolean) =>
  new Response(
    JSON.stringify({
      json: { query: "probe", limit: 20, offset: 0, hasMore: false, contentTruncated, results: [] },
    }),
    { headers: { "content-type": "application/json" } },
  );

function setup(contentTruncated: boolean) {
  const actual = createBusabaseQueryUtils("http://localhost/api/rpc", {
    fetch: async () => searchResponse(contentTruncated),
  });
  const orpc = {
    search: actual.search,
    grep: actual.grep,
    searchMetrics: {
      report: { mutationOptions: () => ({ mutationFn: async () => ({ accepted: true }) }) },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={() => ["/search", () => undefined]} searchHook={() => "q=probe&source=files"}>
        <CoreI18nProvider locale="en">
          <SearchView orpc={orpc} />
        </CoreI18nProvider>
      </Router>
    </QueryClientProvider>,
  );
}

describe("advanced search empty state discloses unindexed text", () => {
  const messages = coreMessagesEn;

  it("says a miss may not be the whole story when the index was truncated", async () => {
    const view = setup(true);
    await waitFor(() =>
      expect(view.getAllByText(messages.searchPage.noMatchesTitle).length).toBeGreaterThan(0),
    );
    expect(view.getByText(messages.search.partialContentBody)).toBeTruthy();
    expect(view.queryByText(messages.searchPage.noMatchesWithFilters)).toBeNull();
  });

  it("keeps the plain empty state when every searched document was fully indexed", async () => {
    const view = setup(false);
    await waitFor(() =>
      expect(view.getAllByText(messages.searchPage.noMatchesTitle).length).toBeGreaterThan(0),
    );
    // `source=files` counts as a narrowed search, so the filter-aware copy shows.
    expect(view.getByText(messages.searchPage.noMatchesWithFilters)).toBeTruthy();
    expect(view.queryByText(messages.search.partialContentBody)).toBeNull();
  });
});
