// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewConfigVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { GRID_GROUP_PAGE_SIZE } from "../hooks/use-grouped-grid-data";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "",
  useLocation: () => ["/base/deals/grid", vi.fn()],
}));
vi.mock("openlib/ui/dashboard", () => ({
  useAddDemoParam: () => (href: string) => href,
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { BusaBaseTable } = await import("./base-table");

const field = (slug: string, type: BaseFieldVO["type"], position: number, options = {}) =>
  ({
    id: `fld_${slug}`,
    baseId: "base",
    slug,
    name: slug[0]?.toUpperCase() + slug.slice(1),
    type,
    position,
    required: false,
    options,
  }) as BaseFieldVO;

const base: BaseVO = {
  id: "base",
  nodeId: "node",
  slug: "deals",
  name: "Deals",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-25T00:00:00Z",
  fields: [
    field("title", "text", 0),
    field("stage", "select", 1, {
      choices: [
        { id: "c_lead", name: "Lead", color: "cyan" },
        { id: "c_won", name: "Won", color: "emerald" },
        { id: "c_lost", name: "Lost", color: "rose" },
      ],
    }),
    field("amount", "number", 2),
    field("done", "checkbox", 3),
  ],
};
const record = (id: string, payload: Record<string, unknown>): RecordVO => ({
  id,
  baseId: base.id,
  headCommitId: `cmt_${id}`,
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  headCommit: {
    id: `cmt_${id}`,
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload,
    operation: "record_create",
    message: "",
    author: "owner",
    createdAt: base.createdAt,
  },
});
const view = (config: Partial<ViewConfigVO> = {}): ViewVO => ({
  id: "view",
  baseId: base.id,
  slug: "grid",
  name: "Grid",
  description: "",
  type: "table",
  config: { filters: [], sorts: [], ...config },
  status: "active",
  position: 0,
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});

// The server's records, bucketed the way the group filters select them.
const rowsByGroup: Record<string, RecordVO[]> = {
  c_lead: Array.from({ length: 60 }, (_, index) =>
    record(`lead-${index}`, { title: `Lead ${index}`, stage: "c_lead", amount: 1 }),
  ),
  c_won: [
    record("won-1", { title: "Won 1", stage: "c_won", amount: 10 }),
    record("won-2", { title: "Won 2", stage: "c_won", amount: 20 }),
  ],
  __empty__: [record("none-1", { title: "Unsorted" })],
};

const groupRecords = vi.fn();
const listRecordsPage = vi.fn();
const client = { groupRecords, listRecordsPage } as unknown as BusabaseDashboardApiClient;

const groupKeyOf = (filter: { operator: string; value?: unknown }) =>
  filter.operator === "is_empty" ? "__empty__" : String(filter.value);

beforeEach(() => {
  groupRecords.mockReset();
  listRecordsPage.mockReset();
  groupRecords.mockImplementation(async (params: { fieldSlug?: string }) =>
    params.fieldSlug
      ? {
          // Deliberately unordered: display order comes from the field's choices.
          groups: [
            { value: "c_won", count: 2, aggregates: { "sum:amount": 30 } },
            { value: null, count: 1, aggregates: { "sum:amount": null } },
            { value: "c_lead", count: 60, aggregates: { "sum:amount": 60 } },
          ],
          total: 63,
        }
      : { groups: [{ value: null, count: 63, aggregates: { "sum:amount": 90 } }], total: 63 },
  );
  listRecordsPage.mockImplementation(
    async (params: {
      filters: Array<{ operator: string; value?: unknown }>;
      page: number;
      pageSize: number;
      totalLimit: number;
    }) => {
      const all = rowsByGroup[groupKeyOf(params.filters[0] ?? { operator: "" })] ?? [];
      const total = Math.min(all.length, params.totalLimit);
      return {
        records: all.slice((params.page - 1) * params.pageSize, params.page * params.pageSize),
        total,
        totalPages: Math.ceil(total / params.pageSize),
        page: params.page,
        totalCapped: all.length > params.totalLimit,
      };
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
});
afterEach(cleanup);

const renderTable = ({
  config = { groupBy: [{ fieldSlug: "stage", fieldId: "fld_stage", direction: "asc" }] },
  level = "write",
  records = [] as RecordVO[],
  onUpdateView = vi.fn().mockResolvedValue(undefined),
  find,
}: {
  config?: Partial<ViewConfigVO>;
  level?: ApiKeyPermissionLevel;
  records?: RecordVO[];
  onUpdateView?: ReturnType<typeof vi.fn>;
  find?: { query: string; fieldId?: string };
} = {}) => {
  const activeView = view(config);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onUpdateView,
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CoreI18nProvider locale="en">
          <SubmitPermissionProvider permissionLevel={level}>
            <BusaBaseTable
              activeView={activeView}
              base={base}
              client={client}
              onCreateView={vi.fn()}
              onDeleteView={vi.fn()}
              onUpdateView={onUpdateView as never}
              records={records}
              recordFind={
                find
                  ? ({
                      input: find,
                      query: find.query,
                      fieldId: find.fieldId ?? "",
                      hasQuery: true,
                      isPending: false,
                      isFetching: false,
                      setQuery: vi.fn(),
                      setFieldId: vi.fn(),
                      startComposition: vi.fn(),
                      endComposition: vi.fn(),
                      clear: vi.fn(),
                    } as never)
                  : undefined
              }
              scrollElementRef={{ current: null }}
              views={[activeView]}
            />
          </SubmitPermissionProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    ),
  };
};

const headers = () =>
  screen.queryAllByTestId("grid-group-header").map((header) => ({
    id: header.getAttribute("data-group-id"),
    count: within(header).getByTestId("grid-group-count").textContent,
  }));
const rowIds = () =>
  [...document.querySelectorAll("[data-record-id]")].map((row) =>
    row.getAttribute("data-record-id"),
  );

describe("grouped table", () => {
  it("renders headers in choice order with exact counts, the empty group last", async () => {
    renderTable({
      config: {
        groupBy: [{ fieldSlug: "stage", direction: "asc" }],
        fieldSummaries: { amount: "sum" },
      },
    });
    await waitFor(() => expect(headers()).toHaveLength(3));
    expect(headers()).toEqual([
      { id: "c_lead", count: "60" },
      { id: "c_won", count: "2" },
      { id: "__empty__", count: "1" },
    ]);
    expect(groupRecords).toHaveBeenCalledWith({
      baseId: "base",
      viewId: "view",
      fieldSlug: "stage",
      aggregates: [{ fn: "sum", fieldSlug: "amount" }],
    });
    // Each group pages its own rows with the view and a filter selecting it.
    await waitFor(() => expect(rowIds()).toContain("none-1"));
    expect(listRecordsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        baseId: "base",
        viewId: "view",
        filters: [{ fieldSlug: "stage", fieldType: "select", operator: "equals", value: "c_won" }],
        page: 1,
        pageSize: GRID_GROUP_PAGE_SIZE,
      }),
    );
    expect(rowIds().slice(-3)).toEqual(["won-1", "won-2", "none-1"]);
    // Per-group summaries sit under their column in the header row.
    const wonHeader = screen
      .getAllByTestId("grid-group-header")
      .find((header) => header.getAttribute("data-group-id") === "c_won") as HTMLElement;
    expect(
      wonHeader
        .querySelector('[data-summary-field="amount"] [data-summary-value]')
        ?.getAttribute("data-summary-value"),
    ).toBe("30");
    // The footer's whole-view total is a second, ungrouped call.
    await waitFor(() =>
      expect(
        screen
          .getByTestId("grid-summary-footer")
          .querySelector('[data-summary-field="amount"] [data-summary-value]')
          ?.getAttribute("data-summary-value"),
      ).toBe("90"),
    );
    // The toolbar and the footer both count the whole grouped view.
    expect(screen.getAllByText("63 records")).toHaveLength(2);
    expect(screen.getByTestId("grid-summary-count").textContent).toBe("63 records");
  });

  it("reverses choice order for desc, keeping the empty group last", async () => {
    renderTable({ config: { groupBy: [{ fieldSlug: "stage", direction: "desc" }] } });
    await waitFor(() => expect(headers()).toHaveLength(3));
    expect(headers().map((header) => header.id)).toEqual(["c_won", "c_lead", "__empty__"]);
  });

  it("collapses a group without fetching its rows, and expands it again", async () => {
    renderTable();
    await waitFor(() => expect(rowIds()).toContain("won-2"));
    const won = () =>
      screen
        .getAllByTestId("grid-group-header")
        .find((header) => header.getAttribute("data-group-id") === "c_won") as HTMLElement;
    const toggle = within(won()).getByTestId("grid-group-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(rowIds()).not.toContain("won-1"));
    expect(rowIds()).toContain("none-1");
    expect(within(won()).getByTestId("grid-group-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
    // The header and its exact count stay.
    expect(within(won()).getByTestId("grid-group-count").textContent).toBe("2");
    fireEvent.click(within(won()).getByTestId("grid-group-toggle"));
    await waitFor(() => expect(rowIds()).toContain("won-1"));
  });

  it("fetches no rows for a collapsed group, even when records refresh", async () => {
    const { queryClient } = renderTable();
    await waitFor(() => expect(rowIds()).toContain("none-1"));
    const lead = screen
      .getAllByTestId("grid-group-header")
      .find((header) => header.getAttribute("data-group-id") === "c_lead") as HTMLElement;
    fireEvent.click(within(lead).getByTestId("grid-group-toggle"));
    await waitFor(() => expect(rowIds()).not.toContain("lead-0"));
    expect(screen.queryByTestId("grid-group-load-more")).toBeNull();
    const isLeadRequest = (call: unknown[]) =>
      (call[0] as { filters: Array<{ value?: unknown }> }).filters[0]?.value === "c_lead";
    const leadCallsBefore = listRecordsPage.mock.calls.filter(isLeadRequest).length;
    const callsBefore = listRecordsPage.mock.calls.length;
    // A refresh refetches every mounted row query; the collapsed group has none.
    await queryClient.invalidateQueries({ queryKey: ["busabase"] });
    await waitFor(() => expect(listRecordsPage.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(listRecordsPage.mock.calls.filter(isLeadRequest).length).toBe(leadCallsBefore);
    expect(rowIds()).toContain("won-1");
  });

  it("loads the next page of one group with Load more", async () => {
    renderTable();
    await waitFor(() => expect(rowIds()).toContain("lead-49"));
    expect(rowIds()).not.toContain("lead-50");
    const loadMore = screen.getByTestId("grid-group-load-more");
    expect(loadMore.textContent).toBe("Load 10 more");
    fireEvent.click(loadMore);
    await waitFor(() => expect(rowIds()).toContain("lead-59"));
    expect(listRecordsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ fieldSlug: "stage", fieldType: "select", operator: "equals", value: "c_lead" }],
        page: 2,
      }),
    );
    expect(screen.queryByTestId("grid-group-load-more")).toBeNull();
    // Lead rows still come before Won rows: groups never interleave.
    expect(rowIds().indexOf("lead-59")).toBeLessThan(rowIds().indexOf("won-1"));
  });

  it("moves an edited record to its new group when record queries are invalidated", async () => {
    const { queryClient } = renderTable();
    await waitFor(() => expect(rowIds()).toContain("won-1"));
    // The edit lands server-side: won-1 is now a lead. The dashboard's refresh
    // invalidates the records.listPage prefix, which these queries live under.
    const moved = record("won-1", { title: "Won 1", stage: "c_lead", amount: 10 });
    const original = { lead: rowsByGroup.c_lead, won: rowsByGroup.c_won };
    rowsByGroup.c_lead = [moved, ...(original.lead ?? [])];
    rowsByGroup.c_won = (original.won ?? []).filter((row) => row.id !== "won-1");
    groupRecords.mockImplementation(async () => ({
      groups: [
        { value: "c_won", count: 1 },
        { value: null, count: 1 },
        { value: "c_lead", count: 61 },
      ],
      total: 63,
    }));
    try {
      await queryClient.invalidateQueries({ queryKey: ["busabase"] });
      await waitFor(() =>
        expect(headers()).toEqual([
          { id: "c_lead", count: "61" },
          { id: "c_won", count: "1" },
          { id: "__empty__", count: "1" },
        ]),
      );
      await waitFor(() => expect(rowIds().indexOf("won-1")).toBe(0));
      expect(rowIds().indexOf("won-2")).toBeGreaterThan(rowIds().indexOf("lead-48"));
    } finally {
      rowsByGroup.c_lead = original.lead;
      rowsByGroup.c_won = original.won;
    }
  });

  it("scopes counts, summaries and every group's rows to the active find", async () => {
    const find = { query: "lead", fieldId: "fld_title" };
    renderTable({
      config: {
        groupBy: [{ fieldSlug: "stage", direction: "asc" }],
        fieldSummaries: { amount: "sum" },
      },
      find,
    });
    await waitFor(() => expect(rowIds()).toContain("none-1"));
    expect(groupRecords).toHaveBeenCalledWith(
      expect.objectContaining({ fieldSlug: "stage", find }),
    );
    // The footer's whole-view call carries the same find.
    await waitFor(() =>
      expect(groupRecords).toHaveBeenCalledWith(
        expect.not.objectContaining({ fieldSlug: expect.anything() }),
      ),
    );
    for (const [params] of groupRecords.mock.calls) expect(params).toMatchObject({ find });
    expect(listRecordsPage.mock.calls.length).toBeGreaterThan(0);
    for (const [params] of listRecordsPage.mock.calls) expect(params).toMatchObject({ find });
  });

  it("ignores the page query's rows while grouped", async () => {
    renderTable({ records: [record("page-row", { title: "From the page query" })] });
    await waitFor(() => expect(headers()).toHaveLength(3));
    expect(rowIds()).not.toContain("page-row");
  });

  it.each([
    ["a deleted field", { groupBy: [{ fieldSlug: "gone", direction: "asc" as const }] }],
    ["a non-groupable field", { groupBy: [{ fieldSlug: "amount", direction: "asc" as const }] }],
    [
      "a stale field id",
      { groupBy: [{ fieldSlug: "stage", fieldId: "fld_deleted", direction: "asc" as const }] },
    ],
  ])("falls back to the ungrouped grid for %s", async (_label, config) => {
    renderTable({ config, records: [record("page-row", { title: "From the page query" })] });
    expect(rowIds()).toEqual(["page-row"]);
    expect(screen.queryByTestId("grid-group-header")).toBeNull();
    expect(groupRecords).not.toHaveBeenCalled();
    expect(listRecordsPage).not.toHaveBeenCalled();
  });

  it("groups by a checkbox, unchecked first", async () => {
    groupRecords.mockResolvedValue({
      groups: [
        { value: "true", count: 1 },
        { value: "false", count: 2 },
      ],
      total: 3,
    });
    listRecordsPage.mockResolvedValue({ records: [], total: 0, totalPages: 0, page: 1 });
    renderTable({ config: { groupBy: [{ fieldSlug: "done", direction: "asc" }] } });
    await waitFor(() => expect(headers()).toHaveLength(2));
    expect(headers().map((header) => header.id)).toEqual(["false", "true"]);
    expect(screen.getByText("Unchecked")).toBeTruthy();
    expect(listRecordsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ fieldSlug: "done", fieldType: "checkbox", operator: "is_false" }],
      }),
    );
  });
});

describe("group control", () => {
  it("lists only select and checkbox fields and saves one level in place", async () => {
    const { onUpdateView } = renderTable({ config: {} });
    fireEvent.click(screen.getByTestId("group-control"));
    expect(screen.getByTestId("group-option-none")).toBeTruthy();
    expect(screen.getByTestId("group-option-stage")).toBeTruthy();
    expect(screen.getByTestId("group-option-done")).toBeTruthy();
    expect(screen.queryByTestId("group-option-title")).toBeNull();
    expect(screen.queryByTestId("group-option-amount")).toBeNull();
    fireEvent.click(screen.getByTestId("group-option-stage"));
    fireEvent.click(screen.getByTestId("group-order-desc"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenCalledWith(
        expect.objectContaining({ id: "view" }),
        { config: { groupBy: [{ fieldSlug: "stage", fieldId: "fld_stage", direction: "desc" }] } },
        { mergeImmediately: true, preserveLocation: true },
      ),
    );
  });

  it("clears the grouping with None, and is absent for read-only viewers", async () => {
    const { onUpdateView } = renderTable();
    fireEvent.click(screen.getByTestId("group-control"));
    expect((screen.getByTestId("group-option-stage") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("group-option-none"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenCalledWith(
        expect.anything(),
        { config: { groupBy: [] } },
        { mergeImmediately: true, preserveLocation: true },
      ),
    );
    cleanup();
    renderTable({ level: "read" });
    expect(screen.queryByTestId("group-control")).toBeNull();
    await waitFor(() => expect(headers()).toHaveLength(3));
  });
});
