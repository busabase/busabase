// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordFindControl } from "../hooks/use-record-find";
import { BusaBaseGantt } from "./base-gantt";
import { BusaBaseTable } from "./base-table";
import { SubmitPermissionProvider } from "./split-submit-button";

const route = vi.hoisted(() => ({ search: "", navigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: () => route.search,
  useLocation: () => ["/base/tasks/timeline", route.navigate],
}));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const fields: BaseFieldVO[] = ["title", "start", "end", "notes"].map((slug, index) => ({
  id: `fld_${slug}`,
  baseId: "bas_tasks",
  slug,
  name: slug,
  type: slug === "start" || slug === "end" ? "date" : "text",
  required: slug === "title",
  position: index,
  options: {},
}));
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
  id: "viw_timeline",
  baseId: base.id,
  slug: "timeline",
  name: "Timeline",
  description: "",
  type: "gantt",
  config: { filters: [], sorts: [], startFieldSlug: "start", endFieldSlug: "end" },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const today = new Date();
const dateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const day = dateString(new Date(today.getFullYear(), today.getMonth(), 5));
const oldDay = dateString(new Date(today.getFullYear() - 2, today.getMonth(), 5));
const laterDay = dateString(new Date(today.getFullYear(), today.getMonth() + 6, 5));
const record = (
  index: number,
  title = `Acme ${index}`,
  start: string | null = day,
  end: string | null = day,
): RecordVO => ({
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
    payload: { title, start, end, notes: `Notes ${index}` },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});
type PageInput = Parameters<BusabaseDashboardApiClient["listRecordsPage"]>[0];
type PageOutput = Awaited<ReturnType<BusabaseDashboardApiClient["listRecordsPage"]>>;
const largeRecords = (matching = 120) => [
  ...Array.from({ length: 501 }, (_, i) => record(i + 1, `Old ${i}`, oldDay, oldDay)),
  ...Array.from({ length: matching }, (_, i) => record(600 + i)),
  record(900, "Acme later", laterDay, laterDay),
];
const makeClient = (all: RecordVO[]) => {
  const listRecordsPage = vi.fn(async (input: PageInput): Promise<PageOutput> => {
    const field = input.find?.fieldId?.replace("fld_", "") ?? "title";
    const matches = all.filter(
      (item) =>
        (!input.find ||
          String(item.headCommit.payload[field])
            .toLowerCase()
            .includes(input.find.query.toLowerCase())) &&
        (input.dateRanges ?? []).every((range) => {
          const value = item.headCommit.payload[range.fieldSlug];
          if (typeof value !== "string") return false;
          const date = Date.parse(value);
          return (
            !Number.isNaN(date) &&
            (range.gte === undefined || date >= Date.parse(range.gte)) &&
            (range.lt === undefined || date < Date.parse(range.lt))
          );
        }),
    );
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 100;
    const counted = Math.min(matches.length, input.totalLimit ?? matches.length);
    return {
      records: matches.slice((page - 1) * pageSize, page * pageSize),
      page,
      total: counted,
      totalPages: Math.ceil(counted / pageSize),
      ...(matches.length > counted ? { totalCapped: true } : {}),
    };
  });
  return { client: { listRecordsPage } as unknown as BusabaseDashboardApiClient, listRecordsPage };
};
const find = (query = "Acme", fieldId = "fld_title", isPending = false): RecordFindControl => ({
  input: { query, fieldId },
  query,
  fieldId,
  hasQuery: true,
  isPending,
  setQuery: vi.fn(),
  setFieldId: vi.fn(),
  startComposition: vi.fn(),
  endComposition: vi.fn(),
  clear: vi.fn(),
});
const renderGantt = (
  client: BusabaseDashboardApiClient,
  extra: Partial<ComponentProps<typeof BusaBaseGantt>> = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (props = extra) => (
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="write">
          <BusaBaseGantt activeView={view} base={base} client={client} fields={fields} {...props} />
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

describe("timeline route A record find", () => {
  it("keeps a large saved view in period mode even for one match and never searches it globally", async () => {
    const { client, listRecordsPage } = makeClient(largeRecords(1));
    const result = renderGantt(client, { recordFind: find() });
    await screen.findByRole("link", { name: "Acme 600" });
    expect(screen.getByTestId("gantt-period")).toBeTruthy();
    expect(screen.getByTestId("gantt-find-scope").textContent).toContain("only this period");
    expect(screen.queryByRole("link", { name: "Acme later" })).toBeNull();
    const probes = listRecordsPage.mock.calls.filter(([input]) => !input.find && !input.dateRanges);
    expect(probes).toHaveLength(1);
    expect(probes[0]?.[0]).toMatchObject({ pageSize: 1, totalLimit: 501 });
    expect(
      listRecordsPage.mock.calls
        .filter(([input]) => input.find)
        .every(([input]) => Boolean(input.dateRanges)),
    ).toBe(true);
    result.refresh({ recordFind: find("absent") });
    expect(await screen.findByTestId("base-record-find-empty")).toBeTruthy();
    expect(screen.getByTestId("gantt-period")).toBeTruthy();
    expect(
      listRecordsPage.mock.calls.filter(([input]) => !input.find && !input.dateRanges),
    ).toHaveLength(1);
  });

  it("searches and automatically loads a small view but stops after a page error until manual retry", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 130 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.page === 2 && fail) throw new Error("Later page failed");
      return original(input);
    });
    renderGantt(client, { recordFind: find() });
    expect(await screen.findByRole("alert")).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(listRecordsPage).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("link")).toHaveLength(100);
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(130));
    expect(screen.queryByTestId("gantt-period")).toBeNull();
    expect(screen.getByTestId("gantt-find-scope").textContent).toContain("every record");
  });

  it("retains a period's first page after failure and retries the failed next page directly", async () => {
    const { client, listRecordsPage } = makeClient(largeRecords());
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.dateRanges && input.page === 2 && fail) throw new Error("Period next page failed");
      return original(input);
    });
    renderGantt(client, { recordFind: find() });
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(100));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("alert");
    expect(screen.getAllByRole("link")).toHaveLength(100);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(120));
    expect(
      listRecordsPage.mock.calls.filter(([input]) => input.dateRanges).map(([input]) => input.page),
    ).toEqual([1, 2, 2]);
  });

  it("distinguishes zero matches from matches with invalid dates and provides clear", async () => {
    const { client } = makeClient([
      record(1, "Acme undated", null, null),
      record(2, "Acme invalid", "2027-03-05", "2027-03-01"),
    ]);
    const result = renderGantt(client, { recordFind: find() });
    expect((await screen.findByTestId("gantt-find-invalid-dates")).textContent).toContain(
      "2 records have missing",
    );
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    const control = find("absent");
    result.refresh({ recordFind: control });
    const empty = await screen.findByTestId("base-record-find-empty");
    expect(screen.queryByTestId("gantt-find-invalid-dates")).toBeNull();
    fireEvent.click(within(empty).getByRole("button", { name: "Clear find" }));
    expect(control.clear).toHaveBeenCalledOnce();
  });

  it("isolates fields and ignores an older response while draft changes disable old tasks", async () => {
    const { client, listRecordsPage } = makeClient([record(1)]);
    const result = renderGantt(client, { recordFind: find() });
    await screen.findByRole("link", { name: "Acme 1" });
    result.refresh({ recordFind: find("Acme", "fld_title", true) });
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    result.refresh({ recordFind: find("Notes", "fld_notes") });
    await screen.findByRole("link", { name: "Acme 1" });
    expect(listRecordsPage.mock.calls.at(-1)?.[0].find).toEqual({
      query: "Notes",
      fieldId: "fld_notes",
    });
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
    await screen.findByTestId("base-record-find-empty");
    await act(async () =>
      resolveOld({ records: [record(50, "Older stale")], total: 1, page: 1, totalPages: 1 }),
    );
    expect(screen.queryByRole("link", { name: "Older stale" })).toBeNull();
  });

  it("restores period and scale from the URL, preserves them on clear, and accepts earlier URL restorations", async () => {
    route.search =
      "space=connected&timelineScale=month&timelineStart=2027-03-01&timelineScope=bas_tasks%3Aviw_timeline";
    const { client } = makeClient(largeRecords(1));
    const result = renderGantt(client, { recordFind: find() });
    await screen.findByTestId("gantt-period");
    expect(screen.getByTestId("gantt-period").textContent).toContain("Mar 2027");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const week = new URL(route.navigate.mock.calls.at(-1)?.[0], "https://test.invalid");
    expect(week.searchParams.get("timelineScale")).toBe("week");
    route.search = week.search.slice(1);
    result.refresh({ recordFind: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    const later = new URL(route.navigate.mock.calls.at(-1)?.[0], "https://test.invalid");
    route.search = later.search.slice(1);
    result.refresh({});
    route.search = week.search.slice(1);
    result.refresh({});
    expect(screen.getByTestId("gantt-period").textContent).toContain("Feb 28, 2027");
    expect(week.searchParams.get("space")).toBe("connected");
  });

  it("cancels a drag when find changes and still permits a current-query drag", async () => {
    const { client } = makeClient([record(1)]);
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    const result = renderGantt(client, { recordFind: find(), onPatchRecord });
    const bar = await screen.findByTestId("gantt-bar-rec_1");
    bar.getBoundingClientRect = () =>
      ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20 }) as DOMRect;
    fireEvent.mouseDown(bar, { clientX: 50 });
    result.refresh({ recordFind: find("Acme", "fld_title", true), onPatchRecord });
    fireEvent.mouseMove(window, { clientX: 60 });
    fireEvent.mouseUp(window, { clientX: 60 });
    expect(onPatchRecord).not.toHaveBeenCalled();
    result.refresh({ recordFind: find(), onPatchRecord });
    const current = await screen.findByTestId("gantt-bar-rec_1");
    current.getBoundingClientRect = bar.getBoundingClientRect;
    fireEvent.mouseDown(current, { clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 60 });
    fireEvent.mouseUp(window, { clientX: 60 });
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledOnce());
  });

  it("reports the period's matched total to the shared toolbar", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    const { client } = makeClient(largeRecords(1));
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
            records={[]}
            recordFind={find()}
            scrollElementRef={{ current: null }}
            views={[view]}
          />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("base-record-actions").textContent).toContain("1 record"),
    );
    expect(screen.getByTestId("gantt-find-scope").textContent).toContain("only this period");
  });

  it("shows a failed mode probe as an error with retry, never as a zero-match result", async () => {
    const { client, listRecordsPage } = makeClient([record(1)]);
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    listRecordsPage.mockRejectedValueOnce(new Error("Size read failed"));
    renderGantt(client, { recordFind: find() });
    await screen.findByRole("alert");
    expect(listRecordsPage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: "Acme 1" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("halts small-view auto paging when a cached mode probe fails until the user retries", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 130 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    let failProbe = false;
    let resolveFirstPage!: (value: PageOutput) => void;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.pageSize === 1 && failProbe) throw new Error("Mode refresh failed");
      if (input.find && input.page === 1) {
        return new Promise((resolve) => {
          resolveFirstPage = resolve;
        });
      }
      return original(input);
    });
    const result = renderGantt(client, { recordFind: find() });
    await waitFor(() => expect(listRecordsPage.mock.calls.at(-1)?.[0].find).toBeTruthy());
    failProbe = true;
    await act(async () => {
      await result.queryClient.invalidateQueries({ queryKey: ["busabase", "gantt-mode"] });
    });
    await screen.findByRole("alert");
    const first = await original({
      baseId: base.id,
      page: 1,
      pageSize: 100,
      find: { query: "Acme", fieldId: "fld_title" },
    });
    await act(async () => resolveFirstPage(first));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(100));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(listRecordsPage.mock.calls.some(([input]) => input.page === 2)).toBe(false);
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    failProbe = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(130));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("states the page-depth limit instead of silently presenting reachable rows as all matches", async () => {
    const { client, listRecordsPage } = makeClient(largeRecords(1));
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    listRecordsPage.mockImplementation(async (input) => {
      const output = await original(input);
      return input.dateRanges
        ? { ...output, total: 100_001, totalPages: 1, pagesCapped: true }
        : output;
    });
    renderGantt(client, { recordFind: find() });
    await screen.findByRole("link", { name: "Acme 600" });
    expect(screen.getByRole("status").textContent).toContain("Add a filter");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("discards an in-flight gesture when the period changes", async () => {
    const { client } = makeClient(largeRecords(1));
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    renderGantt(client, { recordFind: find(), onPatchRecord });
    const bar = await screen.findByTestId("gantt-bar-rec_600");
    bar.getBoundingClientRect = () =>
      ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20 }) as DOMRect;
    fireEvent.mouseDown(bar, { clientX: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.mouseMove(window, { clientX: 60 });
    fireEvent.mouseUp(window, { clientX: 60 });
    expect(onPatchRecord).not.toHaveBeenCalled();
    await screen.findByRole("link", { name: "Acme later" });
  });

  it("saves a drag released while a background refresh rereads the rows", async () => {
    const { client, listRecordsPage } = makeClient([record(1)]);
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    const result = renderGantt(client, { recordFind: find(), onPatchRecord });
    await waitFor(() => expect(screen.getByTestId("gantt-resize-end-rec_1")).toBeTruthy());
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    let release = () => {};
    listRecordsPage.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(input);
    });
    const bar = screen.getByTestId("gantt-bar-rec_1");
    bar.getBoundingClientRect = () =>
      ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20 }) as DOMRect;
    fireEvent.mouseDown(bar, { clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 200 });
    // Another member's edit refreshes the timeline mid-gesture.
    await act(async () => {
      void result.queryClient.invalidateQueries();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(listRecordsPage.mock.calls.length).toBeGreaterThan(2);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.mouseUp(window, { clientX: 200 });
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledOnce());
    await act(async () => {
      release();
    });
  });

  it("withholds rescheduling after a later page fails until retry completes the rows", async () => {
    const { client, listRecordsPage } = makeClient(
      Array.from({ length: 130 }, (_, i) => record(i + 1)),
    );
    const original = listRecordsPage.getMockImplementation();
    if (!original) throw new Error("Expected reader");
    let fail = true;
    listRecordsPage.mockImplementation(async (input) => {
      if (input.page === 2 && fail) throw new Error("Later page failed");
      return original(input);
    });
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    renderGantt(client, { recordFind: find(), onPatchRecord });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("gantt-resize-end-rec_1")).toBeNull();
    const bar = screen.getByTestId("gantt-bar-rec_1");
    bar.getBoundingClientRect = () =>
      ({ left: 0, width: 120, top: 0, height: 20, right: 120, bottom: 20 }) as DOMRect;
    fireEvent.mouseDown(bar, { clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 200 });
    fireEvent.mouseUp(window, { clientX: 200 });
    expect(onPatchRecord).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("gantt-resize-end-rec_1")).toBeTruthy());
  });
});
