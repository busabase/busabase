// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewConfigVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
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
    field("amount", "number", 1, {
      number: { format: "currency", currency: "USD", locale: "en-US" },
    }),
    field("notes", "longtext", 2),
    field("done", "checkbox", 3),
    field("created", "created_time", 4),
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

const groupRecords = vi.fn();
const client = { groupRecords } as unknown as BusabaseDashboardApiClient;

const renderTable = ({
  config = {},
  level = "write",
  onUpdateView = vi.fn().mockResolvedValue(undefined),
}: {
  config?: Partial<ViewConfigVO>;
  level?: ApiKeyPermissionLevel;
  onUpdateView?: ReturnType<typeof vi.fn>;
} = {}) => {
  const activeView = view(config);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onUpdateView,
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
              records={[record("r1", { title: "Acme", amount: 10 }), record("r2", { title: "" })]}
              pagination={{
                page: 1,
                pageSize: 25,
                total: 37,
                totalPages: 2,
                isLoading: false,
                onPageChange: vi.fn(),
                onPageSizeChange: vi.fn(),
              }}
              scrollElementRef={{ current: null }}
              views={[activeView]}
            />
          </SubmitPermissionProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    ),
  };
};

const footerCell = (slug: string) =>
  screen
    .getByTestId("grid-summary-footer")
    .querySelector(`[data-summary-field="${slug}"]`) as HTMLElement;

beforeEach(() => {
  groupRecords.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
});
afterEach(cleanup);

describe("grid summary footer", () => {
  it("shows whole-view values from one records.groupBy call, not the loaded page", async () => {
    groupRecords.mockResolvedValue({
      groups: [
        {
          value: null,
          count: 37,
          aggregates: { "sum:amount": 1234.5, "filled:notes": 9, "filled:title": 35 },
        },
      ],
      total: 37,
    });
    renderTable({
      config: { fieldSummaries: { amount: "sum", notes: "percent_filled", title: "empty" } },
    });
    await waitFor(() =>
      expect(
        footerCell("amount")
          .querySelector("[data-summary-value]")
          ?.getAttribute("data-summary-value"),
      ).toBe("$1,234.50"),
    );
    expect(groupRecords).toHaveBeenCalledTimes(1);
    expect(groupRecords).toHaveBeenCalledWith({
      baseId: "base",
      viewId: "view",
      aggregates: [
        { fn: "filled", fieldSlug: "notes" },
        { fn: "filled", fieldSlug: "title" },
        { fn: "sum", fieldSlug: "amount" },
      ],
    });
    // 9 of 37 filled, as a whole-number percentage; empty = count - filled.
    expect(footerCell("notes").textContent).toContain("24%");
    expect(footerCell("title").textContent).toContain("Empty");
    expect(
      footerCell("title").querySelector("[data-summary-value]")?.getAttribute("data-summary-value"),
    ).toBe("2");
    expect(screen.getByTestId("grid-summary-count").textContent).toBe("37 records");
  });

  it("offers only the functions valid for each field type and saves the choice in place", async () => {
    groupRecords.mockResolvedValue({ groups: [{ value: null, count: 2 }], total: 2 });
    const { onUpdateView } = renderTable({ config: { fieldSummaries: { amount: "avg" } } });
    fireEvent.click(within(footerCell("notes")).getByText("Summarize"));
    const textMenu = await screen.findByRole("menu");
    expect(
      within(textMenu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["None", "Filled", "Empty", "Percent filled"]);
    fireEvent.click(within(textMenu).getByText("Percent filled"));
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenCalledWith(
        expect.objectContaining({ id: "view" }),
        { config: { fieldSummaries: { amount: "avg", notes: "percent_filled" } } },
        { mergeImmediately: true, preserveLocation: true },
      ),
    );

    fireEvent.click(footerCell("amount"));
    const numberMenu = await screen.findByRole("menu");
    expect(
      within(numberMenu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["None", "Sum", "Average", "Min", "Max", "Filled", "Empty", "Percent filled"]);
    expect(
      within(numberMenu)
        .getByRole("menuitemradio", { name: "Average" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(numberMenu).getByText("None"));
    // Built on the choice just made, not on the stale saved config — which
    // would have dropped the Notes summary set a moment ago.
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "view" }),
        { config: { fieldSummaries: { notes: "percent_filled" } } },
        { mergeImmediately: true, preserveLocation: true },
      ),
    );
  });

  it("queues a proposer's choice for review and says so", async () => {
    const { onUpdateView } = renderTable({ level: "changeRequest" });
    fireEvent.click(within(footerCell("notes")).getByText("Summarize"));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Filled"));
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenCalledWith(
        expect.anything(),
        { config: { fieldSummaries: { notes: "filled" } } },
        { mergeImmediately: false, preserveLocation: true },
      ),
    );
    expect((await screen.findByRole("status")).textContent).toContain("after approval and merge");
    // No summaries configured yet: nothing to fetch.
    expect(groupRecords).not.toHaveBeenCalled();
  });

  it("shows saved values read-only and degrades to a dash when the aggregate fails", async () => {
    groupRecords.mockRejectedValue(new Error("forbidden"));
    renderTable({ level: "read", config: { fieldSummaries: { amount: "max" } } });
    // One retry (a transient failure should not blank the row), then the dash.
    await waitFor(() => expect(footerCell("amount").textContent).toContain("—"), {
      timeout: 5000,
    });
    expect(footerCell("amount").tagName).toBe("DIV");
    expect(screen.getByTestId("grid-summary-footer").querySelector("button")).toBeNull();
    expect(footerCell("amount").querySelector("[title]")?.getAttribute("title")).toBe(
      "Summary unavailable",
    );
    // The grid itself still renders.
    expect(document.querySelector('[data-record-id="r1"]')).not.toBeNull();
  });

  it("offers a checkbox only the checked family and computes it from the checked aggregate", async () => {
    groupRecords.mockResolvedValue({
      groups: [{ value: null, count: 37, aggregates: { "checked:done": 12 } }],
      total: 37,
    });
    const { onUpdateView } = renderTable({ config: { fieldSummaries: { done: "unchecked" } } });
    await waitFor(() =>
      expect(
        footerCell("done")
          .querySelector("[data-summary-value]")
          ?.getAttribute("data-summary-value"),
      ).toBe("25"),
    );
    expect(groupRecords).toHaveBeenCalledWith(
      expect.objectContaining({ aggregates: [{ fn: "checked", fieldSlug: "done" }] }),
    );
    expect(footerCell("done").textContent).toContain("Unchecked");
    fireEvent.click(footerCell("done"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["None", "Checked", "Unchecked", "Percent checked"]);
    fireEvent.click(within(menu).getByText("Percent checked"));
    await waitFor(() =>
      expect(onUpdateView).toHaveBeenCalledWith(
        expect.anything(),
        { config: { fieldSummaries: { done: "percent_checked" } } },
        { mergeImmediately: true, preserveLocation: true },
      ),
    );
  });

  it("leaves an always-set system field's cell plain, with no menu", () => {
    renderTable();
    expect(footerCell("created").tagName).toBe("DIV");
    expect(footerCell("created").textContent).not.toContain("Summarize");
    // Its neighbours stay clickable.
    expect(footerCell("notes").tagName).toBe("BUTTON");
  });

  it("hides the footer from read-only viewers when the view has no summaries", () => {
    renderTable({ level: "read" });
    expect(screen.queryByTestId("grid-summary-footer")).toBeNull();
  });

  it("ignores stale summaries whose field type no longer supports them", async () => {
    groupRecords.mockResolvedValue({ groups: [{ value: null, count: 2 }], total: 2 });
    renderTable({ level: "read", config: { fieldSummaries: { notes: "sum", gone: "filled" } } });
    expect(screen.queryByTestId("grid-summary-footer")).toBeNull();
    expect(groupRecords).not.toHaveBeenCalled();
  });

  // Two quick choices used to be two maps computed from the same saved config:
  // the second one dropped the first (or failed with a merge conflict).
  it("runs quick choices one at a time, each built on the last, and shows them at once", async () => {
    groupRecords.mockResolvedValue({ groups: [{ value: null, count: 2 }], total: 2 });
    let releaseFirst: () => void = () => undefined;
    const onUpdateView = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    renderTable({ onUpdateView });
    fireEvent.click(within(footerCell("amount")).getByText("Summarize"));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Sum"));
    // Shown before the save comes back.
    await waitFor(() =>
      expect(
        footerCell("amount").querySelector("[data-summary-fn]")?.getAttribute("data-summary-fn"),
      ).toBe("sum"),
    );
    fireEvent.click(within(footerCell("notes")).getByText("Summarize"));
    fireEvent.click(within(await screen.findByRole("menu", { name: /Notes/ })).getByText("Filled"));
    // The second write waits for the first (give a racing write time to fire).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onUpdateView).toHaveBeenCalledTimes(1);
    expect(onUpdateView).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { config: { fieldSummaries: { amount: "sum" } } },
      { mergeImmediately: true, preserveLocation: true },
    );
    releaseFirst();
    await waitFor(() => expect(onUpdateView).toHaveBeenCalledTimes(2));
    expect(onUpdateView).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { config: { fieldSummaries: { amount: "sum", notes: "filled" } } },
      { mergeImmediately: true, preserveLocation: true },
    );
  });

  it("keeps each proposal a change against the saved config alone", async () => {
    const { onUpdateView } = renderTable({ level: "changeRequest" });
    fireEvent.click(within(footerCell("amount")).getByText("Summarize"));
    fireEvent.click(within(await screen.findByRole("menu")).getByText("Sum"));
    await waitFor(() => expect(onUpdateView).toHaveBeenCalledTimes(1));
    fireEvent.click(within(footerCell("notes")).getByText("Summarize"));
    fireEvent.click(within(await screen.findByRole("menu", { name: /Notes/ })).getByText("Filled"));
    await waitFor(() => expect(onUpdateView).toHaveBeenCalledTimes(2));
    expect(onUpdateView).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { config: { fieldSummaries: { notes: "filled" } } },
      { mergeImmediately: false, preserveLocation: true },
    );
  });

  // Focusing a footer cell past the right edge scrolls the footer by itself;
  // if the table did not follow, every summary would sit under the wrong column.
  it("keeps the footer and the table on one horizontal position, both ways", () => {
    groupRecords.mockResolvedValue({ groups: [{ value: null, count: 2 }], total: 2 });
    const { container } = renderTable({ config: { fieldSummaries: { notes: "filled" } } });
    const table = container.querySelector<HTMLElement>("[data-base-table-scroll]");
    const footer = screen.getByTestId("grid-summary-footer");
    if (!table) throw new Error("table scroller missing");

    table.scrollLeft = 90;
    fireEvent.scroll(table);
    expect(footer.scrollLeft).toBe(90);

    footer.scrollLeft = 140;
    fireEvent.scroll(footer);
    expect(table.scrollLeft).toBe(140);
  });
});
