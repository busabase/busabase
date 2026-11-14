// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// A month of a very large Base is never read whole: past a few pages the grid
// asks each day for its first records and its count, and "+N" lists the day.
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { BusaBaseCalendar } = await import("./base-calendar");

const dateField: BaseFieldVO = {
  id: "fld_due",
  baseId: "bas_tasks",
  slug: "due",
  name: "Due",
  type: "date",
  required: false,
  position: 1,
  options: {},
};
const titleField: BaseFieldVO = {
  id: "fld_title",
  baseId: "bas_tasks",
  slug: "title",
  name: "Title",
  type: "text",
  required: true,
  position: 0,
  options: {},
};
const base: BaseVO = {
  id: "bas_tasks",
  nodeId: "nod_tasks",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-01T00:00:00Z",
  fields: [titleField, dateField],
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
const busyDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const record = (index: number): RecordVO => ({
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
    payload: { title: `Task ${index}`, due: busyDay },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

type PageInput = {
  dateRange?: { gte: string; lt: string };
  page: number;
  pageSize: number;
};
const DAY_MS = 86_400_000;
// `busyDay` holds `dayTotal` records; the whole grid holds `gridTotal`.
const makeClient = ({ dayTotal, gridTotal }: { dayTotal: number; gridTotal: number }) => {
  const listRecordsPage = vi.fn(async (input: PageInput) => {
    const span = Date.parse(input.dateRange?.lt ?? "") - Date.parse(input.dateRange?.gte ?? "");
    const isOneDay = span <= DAY_MS;
    const holdsBusyDay = input.dateRange?.gte === `${busyDay}T00:00:00.000Z`;
    const total = isOneDay ? (holdsBusyDay ? dayTotal : 0) : gridTotal;
    const from = (input.page - 1) * input.pageSize;
    const count = Math.max(0, Math.min(input.pageSize, Math.min(total, dayTotal) - from));
    return {
      records: Array.from({ length: count }, (_, i) => record(from + i + 1)),
      total,
      page: input.page,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  });
  return {
    client: { listRecordsPage } as unknown as BusabaseDashboardApiClient,
    listRecordsPage,
  };
};

const renderCalendar = (client: BusabaseDashboardApiClient) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="read">
          <BusaBaseCalendar activeView={view} base={base} client={client} fields={base.fields} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

const callsWith = (spy: ReturnType<typeof vi.fn>, pageSize: number) =>
  spy.mock.calls.filter(([input]) => (input as PageInput).pageSize === pageSize);

afterEach(cleanup);

describe("a busy calendar month", () => {
  it("asks each day for four records and its count instead of reading the month", async () => {
    const { client, listRecordsPage } = makeClient({ dayTotal: 806, gridTotal: 35_532 });
    renderCalendar(client);

    expect(await screen.findByRole("button", { name: "806 records" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "806 records" }).textContent).toBe("+802");
    const cell = screen.getByText("Task 1").closest("[data-calendar-day]") as HTMLElement;
    expect(within(cell).getAllByRole("link")).toHaveLength(4);
    // One page of the month (its total), then one small read per grid day.
    expect(callsWith(listRecordsPage, 100)).toHaveLength(1);
    expect(callsWith(listRecordsPage, 4)).toHaveLength(42);
  });

  it("lists the whole day behind +N, a page at a time", async () => {
    const { client, listRecordsPage } = makeClient({ dayTotal: 806, gridTotal: 35_532 });
    renderCalendar(client);
    fireEvent.click(await screen.findByRole("button", { name: "806 records" }));

    const dialog = await screen.findByTestId("calendar-day-dialog");
    expect(within(dialog).getByText("806 records")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(50));
    const [listInput] = callsWith(listRecordsPage, 50)[0] as [PageInput];
    expect(listInput.dateRange).toMatchObject({
      gte: `${busyDay}T00:00:00.000Z`,
      lt: new Date(Date.parse(`${busyDay}T00:00:00.000Z`) + DAY_MS).toISOString(),
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(within(dialog).getAllByRole("link")).toHaveLength(100));
    expect(callsWith(listRecordsPage, 50).map(([input]) => (input as PageInput).page)).toEqual([
      1, 2,
    ]);
  });
});

describe("an ordinary calendar month", () => {
  it("reads the month whole and lists +N from what it already has", async () => {
    const { client, listRecordsPage } = makeClient({ dayTotal: 6, gridTotal: 6 });
    renderCalendar(client);

    fireEvent.click(await screen.findByRole("button", { name: "6 records" }));
    const dialog = await screen.findByTestId("calendar-day-dialog");
    expect(within(dialog).getAllByRole("link")).toHaveLength(6);
    expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
    // No per-day reads and no day list fetch: the month already holds them.
    expect(callsWith(listRecordsPage, 4)).toHaveLength(0);
    expect(callsWith(listRecordsPage, 50)).toHaveLength(0);
  });
});
