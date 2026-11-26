// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordFindControl } from "../hooks/use-record-find";
import { BusaBaseCalendar } from "./base-calendar";
import { BusaBaseTable } from "./base-table";
import { SubmitPermissionProvider } from "./split-submit-button";

const route = vi.hoisted(() => ({ search: "", navigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: () => route.search,
  useLocation: () => ["/base/tasks/calendar", route.navigate],
}));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const fields: BaseFieldVO[] = [
  {
    id: "fld_title",
    baseId: "bas_tasks",
    slug: "title",
    name: "Title",
    type: "text",
    required: true,
    position: 0,
    options: {},
  },
  {
    id: "fld_due",
    baseId: "bas_tasks",
    slug: "due",
    name: "Due",
    type: "date",
    required: false,
    position: 1,
    options: {},
  },
];
const base: BaseVO = {
  id: "bas_tasks",
  nodeId: "nod_tasks",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-01T00:00:00Z",
  fields,
};
const view: ViewVO = {
  id: "viw_calendar",
  baseId: base.id,
  slug: "calendar",
  name: "Calendar",
  description: "",
  type: "calendar",
  config: { filters: [], sorts: [], dateFieldSlug: "due" },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const today = new Date();
const currentDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
const record = (index: number, title = `Acme ${index}`, due = currentDay): RecordVO => ({
  id: `rec_${index}`,
  baseId: base.id,
  headCommitId: `cmt_${index}`,
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  base,
  headCommit: {
    id: `cmt_${index}`,
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title, due },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});
type PageInput = Parameters<BusabaseDashboardApiClient["listRecordsPage"]>[0];
type PageOutput = Awaited<ReturnType<BusabaseDashboardApiClient["listRecordsPage"]>>;
const makeClient = (records: RecordVO[]) => {
  const listRecordsPage = vi.fn(async (input: PageInput): Promise<PageOutput> => {
    const matching = records.filter((item) => {
      const date = Date.parse(String(item.headCommit.payload.due));
      return (
        (!input.find ||
          String(item.headCommit.payload.title)
            .toLowerCase()
            .includes(input.find.query.toLowerCase())) &&
        (!input.dateRange ||
          (date >= Date.parse(input.dateRange.gte) && date < Date.parse(input.dateRange.lt)))
      );
    });
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 100;
    return {
      records: matching.slice((page - 1) * pageSize, page * pageSize),
      page,
      total: matching.length,
      totalPages: Math.ceil(matching.length / pageSize),
    };
  });
  return { client: { listRecordsPage } as unknown as BusabaseDashboardApiClient, listRecordsPage };
};
const find = (query = "Acme", pending = false): RecordFindControl => ({
  input: { query, fieldId: "fld_title" },
  query,
  fieldId: "fld_title",
  hasQuery: true,
  isPending: pending,
  setQuery: vi.fn(),
  setFieldId: vi.fn(),
  startComposition: vi.fn(),
  endComposition: vi.fn(),
  clear: vi.fn(),
});
const renderCalendar = (
  client: BusabaseDashboardApiClient,
  extra: Partial<ComponentProps<typeof BusaBaseCalendar>> = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (props = extra) => (
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="write">
          <BusaBaseCalendar
            activeView={view}
            base={base}
            client={client}
            fields={fields}
            {...props}
          />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>
  );
  const result = render(element());
  return {
    ...result,
    queryClient,
    refresh: (props: typeof extra) => result.rerender(element(props)),
  };
};

afterEach(() => {
  cleanup();
  route.search = "";
  route.navigate.mockClear();
});

describe("calendar record find", () => {
  it("finds across month pages and opens a day with only its matching records", async () => {
    const { client, listRecordsPage } = makeClient([
      ...Array.from({ length: 130 }, (_, i) => record(i + 1)),
      record(131, "Other customer"),
      record(132, "Acme outside", "2030-01-01"),
    ]);
    const status = vi.fn();
    renderCalendar(client, { recordFind: find(), onCollectionStatusChange: status });
    fireEvent.click(await screen.findByRole("button", { name: "130 records" }));
    const dialog = await screen.findByTestId("calendar-day-dialog");
    expect(within(dialog).getAllByRole("link")).toHaveLength(130);
    expect(listRecordsPage).toHaveBeenCalledTimes(2);
    expect(listRecordsPage.mock.calls.map(([input]) => input.page)).toEqual([1, 2]);
    for (const [input] of listRecordsPage.mock.calls)
      expect(input.find).toEqual({ query: "Acme", fieldId: "fld_title" });
    expect(status).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 130, isFetching: false, isError: false }),
    );
  });

  it("keeps a busy month's previews, counts and paged day list on the same find", async () => {
    const { client, listRecordsPage } = makeClient([
      ...Array.from({ length: 1_101 }, (_, i) => record(i + 1)),
      record(1_102, "Another customer"),
    ]);
    renderCalendar(client, { recordFind: find() });
    fireEvent.click(await screen.findByRole("button", { name: "1101 records" }));
    const dialog = await screen.findByTestId("calendar-day-dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(50));
    fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(100));
    expect(listRecordsPage.mock.calls.filter(([input]) => input.pageSize === 100)).toHaveLength(1);
    expect(listRecordsPage.mock.calls.filter(([input]) => input.pageSize === 4)).toHaveLength(42);
    expect(
      listRecordsPage.mock.calls
        .filter(([input]) => input.pageSize === 50)
        .map(([input]) => input.page),
    ).toEqual([1, 2]);
    for (const [input] of listRecordsPage.mock.calls)
      expect(input.find).toEqual({ query: "Acme", fieldId: "fld_title" });
  });

  it("retains a busy day's first page and retries its failed second page directly", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 1_101 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected page reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.pageSize === 50 && input.page === 2 && fail)
        throw new Error("Day next page failed");
      return original(input);
    });
    renderCalendar(client, { recordFind: find() });
    fireEvent.click(await screen.findByRole("button", { name: "1101 records" }));
    const dialog = await screen.findByTestId("calendar-day-dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(50));
    fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    await within(dialog).findByRole("alert");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(within(dialog).getAllByRole("link")).toHaveLength(50);
    expect(
      listRecordsPage.mock.calls
        .filter(([input]) => input.pageSize === 50)
        .map(([input]) => input.page),
    ).toEqual([1, 2]);
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(100));
    expect(
      listRecordsPage.mock.calls
        .filter(([input]) => input.pageSize === 50)
        .map(([input]) => input.page),
    ).toEqual([1, 2, 2]);
    expect(
      new Set(
        within(dialog)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).size,
    ).toBe(100);
  });

  it("shows a scoped zero result with a clear action instead of claiming the whole view is empty", async () => {
    const control = find("Absent");
    const { client } = makeClient([record(1)]);
    renderCalendar(client, { recordFind: control });
    const empty = await screen.findByTestId("base-record-find-empty");
    expect(empty.textContent).toContain("No matching records in the displayed date range.");
    expect(screen.getByTestId("calendar-find-scope").textContent).toContain("42 displayed dates");
    fireEvent.click(within(empty).getByRole("button", { name: "Clear find" }));
    expect(control.clear).toHaveBeenCalledOnce();
  });

  it("hides the old day's cards and dialog during a draft, then ignores an older query response", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 6 }, (_, i) => record(i + 1)),
    );
    const result = renderCalendar(client, { recordFind: find() });
    fireEvent.click(await screen.findByRole("button", { name: "6 records" }));
    expect(screen.getByTestId("calendar-day-dialog")).toBeTruthy();
    result.refresh({ recordFind: find("Acme", true) });
    expect(screen.queryByTestId("calendar-day-dialog")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Move Acme 1 to another day" })).toBeNull();
    let resolveOld!: (value: PageOutput) => void;
    listRecordsPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    result.refresh({ recordFind: find("Older") });
    await waitFor(() => expect(listRecordsPage.mock.calls.at(-1)?.[0].find?.query).toBe("Older"));
    result.refresh({ recordFind: find("Newest") });
    expect(await screen.findByTestId("base-record-find-empty")).toBeTruthy();
    await act(async () =>
      resolveOld({ records: [record(50, "Older stale")], total: 1, page: 1, totalPages: 1 }),
    );
    expect(screen.queryByText("Older stale")).toBeNull();
  });

  it("stops after a later-page error and resumes only after retry", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 130 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected page reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.page === 2 && fail) throw new Error("Range failed");
      return original(input);
    });
    renderCalendar(client, { recordFind: find() });
    expect(await screen.findByRole("alert")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(listRecordsPage).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(4);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "130 records" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("restores the URL month, keeps it on clear, and carries it to record details", async () => {
    route.search =
      "space=connected&calendarMonth=2027-03&calendarScope=bas_tasks%3Aviw_calendar&recordFind=Acme";
    const { client } = makeClient([record(1, "Acme March", "2027-03-15")]);
    const result = renderCalendar(client, { recordFind: find() });
    const link = await screen.findByRole("link", { name: "Acme March" });
    expect(screen.getByText("March 2027")).toBeTruthy();
    expect(
      new URL(link.getAttribute("href") ?? "", "https://test.invalid").searchParams.get(
        "calendarMonth",
      ),
    ).toBe("2027-03");
    result.refresh({ recordFind: undefined });
    expect(screen.getByText("March 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("April 2027")).toBeTruthy();
    const next = new URL(route.navigate.mock.calls.at(-1)?.[0], "https://test.invalid");
    expect(next.searchParams.get("calendarMonth")).toBe("2027-04");
    expect(next.searchParams.get("space")).toBe("connected");
    route.search = next.search.slice(1);
    result.refresh({ recordFind: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("May 2027")).toBeTruthy();
    const may = new URL(route.navigate.mock.calls.at(-1)?.[0], "https://test.invalid");
    route.search = may.search.slice(1);
    result.refresh({ recordFind: undefined });
    route.search = next.search.slice(1);
    result.refresh({ recordFind: undefined });
    expect(screen.getByText("April 2027")).toBeTruthy();
  });

  it("keeps capped day counts visibly bounded and explains the numbered-page limit", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 4 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected page reader");
    listRecordsPage.mockImplementation(async (input) => {
      const response = await original(input);
      if (input.pageSize === 100)
        return { ...response, total: 1_000_000, totalCapped: true, totalPages: 10_000 };
      if (input.pageSize === 4) {
        return response.records.length
          ? { ...response, total: 1_000_000, totalCapped: true }
          : response;
      }
      return { ...response, total: 1_000_000, totalCapped: true, pagesCapped: true, totalPages: 1 };
    });
    renderCalendar(client, { recordFind: find() });
    const overflow = await screen.findByRole("button", { name: "1000000+ records" });
    expect(overflow.textContent).toBe("1000000+");
    fireEvent.click(overflow);
    const dialog = await screen.findByTestId("calendar-day-dialog");
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(4));
    expect(within(dialog).getByText("1000000+ records")).toBeTruthy();
    expect(within(dialog).getByRole("status").textContent).toContain("Add a filter");
    expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("reports the range's count to the existing toolbar and never uses the unrelated parent-page count", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    const { client } = makeClient([record(1), record(2), record(3, "Other")]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="en">
          <BusaBaseTable
            activeView={view}
            base={base}
            client={client}
            onCreateView={vi.fn()}
            onDeleteView={vi.fn()}
            onUpdateView={vi.fn()}
            records={[record(90, "Unrelated parent snapshot")]}
            recordFind={find()}
            scrollElementRef={{ current: null }}
            views={[view]}
          />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    const toolbar = screen.getByTestId("base-record-actions");
    await waitFor(() => expect(toolbar.textContent).toContain("2 records"));
    expect(toolbar.textContent).not.toContain("1 record");
    expect(screen.getByTestId("base-record-find-input")).toBeTruthy();
  });

  it("keeps reschedule available while a background refresh rereads the month", async () => {
    const { client, listRecordsPage } = makeClient([record(1)]);
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    const result = renderCalendar(client, { recordFind: find(), onPatchRecord });
    expect(await screen.findByRole("button", { name: "Move Acme 1 to another day" })).toBeTruthy();
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected page reader");
    let release = () => {};
    listRecordsPage.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(input);
    });
    await act(async () => {
      void result.queryClient.invalidateQueries();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(listRecordsPage).toHaveBeenCalledTimes(2);
    // Another member's edit refreshes the month; the card on screen stays movable.
    expect(screen.getByRole("button", { name: "Move Acme 1 to another day" })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    await act(async () => {
      release();
    });
  });

  it("withholds reschedule after a later page fails until retry completes the month", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 130 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected page reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.page === 2 && fail) throw new Error("Range failed");
      return original(input);
    });
    renderCalendar(client, {
      recordFind: find(),
      onPatchRecord: vi.fn(async () => ({ materialized: true as const })),
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Move .* to another day$/ })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Move Acme 1 to another day" })).toBeTruthy();
  });
});
