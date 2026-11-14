// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// The timeline never drains the Base. A view of up to 500 rows is drawn whole
// (five pages, loaded on their own). A larger one is read a period at a time:
// the rows whose span overlaps it, one page at first, then "Load more".
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const { BusaBaseGantt } = await import("./base-gantt");

const field = (slug: string, type: BaseFieldVO["type"], position: number): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_tasks",
  slug,
  name: slug,
  type,
  required: slug === "title",
  position,
  options: {},
});
const fields = [field("title", "text", 0), field("start", "date", 1), field("end", "date", 2)];
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
  id: "viw_gantt",
  baseId: base.id,
  slug: "gantt",
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
const pad = (n: number) => String(n).padStart(2, "0");
const THIS_MONTH_DAY = (day: number) =>
  `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(day)}`;
// The period around today at the month scale: this month's 1st, six months on.
const periodFrom = new Date(today.getFullYear(), today.getMonth(), 1);
const periodTo = new Date(today.getFullYear(), today.getMonth() + 6, 1);
const utcMidnight = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01T00:00:00.000Z`;

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
    payload: { title: `Task ${index}`, start: THIS_MONTH_DAY(2), end: THIS_MONTH_DAY(5) },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

type PageInput = {
  page: number;
  pageSize: number;
  totalLimit?: number;
  dateRanges?: Array<{ fieldSlug: string; gte?: string; lt?: string }>;
  sort?: { fieldSlug: string; fieldType?: string; direction: "asc" | "desc" };
};
// `total` rows in the view, and `inPeriod` of them in any period asked for;
// counts stop at `totalLimit` the way the server's do.
const makeClient = ({ total, inPeriod }: { total: number; inPeriod: number }) => {
  const listRecordsPage = vi.fn(async (input: PageInput) => {
    const rows = input.dateRanges ? inPeriod : total;
    const from = (input.page - 1) * input.pageSize;
    const count = Math.max(0, Math.min(input.pageSize, rows - from));
    const limit = input.totalLimit ?? 1_000_000;
    const counted = Math.min(rows, limit);
    return {
      records: Array.from({ length: count }, (_, i) => record(from + i + 1)),
      total: counted,
      page: input.page,
      totalPages: Math.ceil(counted / input.pageSize),
      ...(rows > limit ? { totalCapped: true } : {}),
    };
  });
  return { client: { listRecordsPage } as unknown as BusabaseDashboardApiClient, listRecordsPage };
};
const renderGantt = (
  client: BusabaseDashboardApiClient,
  {
    activeView = view,
    baseFields = fields,
    onPatchRecord,
  }: {
    activeView?: ViewVO;
    baseFields?: BaseFieldVO[];
    onPatchRecord?: React.ComponentProps<typeof BusaBaseGantt>["onPatchRecord"];
  } = {},
) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel={onPatchRecord ? "write" : "read"}>
          <BusaBaseGantt
            activeView={activeView}
            base={{ ...base, fields: baseFields }}
            client={client}
            fields={baseFields}
            onPatchRecord={onPatchRecord}
          />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
const periodCalls = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.map(([input]) => input as PageInput).filter((input) => input.dateRanges);

afterEach(cleanup);

describe("Gantt rows", () => {
  it("draws a view of up to 500 rows whole, as before", async () => {
    const { client, listRecordsPage } = makeClient({ total: 250, inPeriod: 0 });
    renderGantt(client);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(250));
    expect(screen.queryByTestId("gantt-period")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(periodCalls(listRecordsPage)).toHaveLength(0);
    // Each page counts one past 500: enough to tell a whole view from a long one.
    for (const [input] of listRecordsPage.mock.calls) {
      expect((input as PageInput).totalLimit).toBe(501);
    }
  });

  it("opens a long schedule on one page and loads more only when asked", async () => {
    const { client, listRecordsPage } = makeClient({ total: 1_250, inPeriod: 700 });
    renderGantt(client);
    expect(await screen.findByTestId("gantt-period")).toBeTruthy();
    expect(await screen.findByText("1–100 of 100+", undefined, { timeout: 5_000 })).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const firstPeriod = periodCalls(listRecordsPage);
    expect(firstPeriod).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(100);
    // The rows whose span overlaps [periodFrom, periodTo), counted one page ahead.
    expect(firstPeriod[0]).toMatchObject({
      page: 1,
      totalLimit: 101,
      sort: { fieldSlug: "start", fieldType: "date", direction: "asc" },
      dateRanges: [
        { fieldSlug: "start", lt: utcMidnight(periodTo) },
        { fieldSlug: "end", gte: utcMidnight(periodFrom) },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("1–200 of 200+", undefined, { timeout: 5_000 })).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(periodCalls(listRecordsPage)).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(200);
    // Every page must ask the server for the same order; sorting just the
    // loaded slice would put newly loaded earlier tasks above the first page.
    for (const input of periodCalls(listRecordsPage)) {
      expect(input.sort).toEqual({ fieldSlug: "start", fieldType: "date", direction: "asc" });
    }

    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    const earlierFrom = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    await waitFor(() =>
      expect(periodCalls(listRecordsPage).at(-1)?.dateRanges).toEqual([
        { fieldSlug: "start", lt: utcMidnight(periodFrom) },
        { fieldSlug: "end", gte: utcMidnight(earlierFrom) },
      ]),
    );
  });

  it("says when a period is empty and keeps the way to another one", async () => {
    const { client } = makeClient({ total: 1_250, inPeriod: 0 });
    renderGantt(client);
    expect(await screen.findByText("Nothing is scheduled in this period.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Earlier" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Later" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });

  it("preserves an explicitly saved view order instead of replacing it with start date", async () => {
    const { client, listRecordsPage } = makeClient({ total: 1_250, inPeriod: 2 });
    renderGantt(client, {
      activeView: {
        ...view,
        config: { ...view.config, sorts: [{ fieldSlug: "end", direction: "desc" }] },
      },
    });
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(periodCalls(listRecordsPage)).toHaveLength(1);
    expect(periodCalls(listRecordsPage)[0]).not.toHaveProperty("sort");
  });

  it.each(["created_time", "updated_time"] as const)(
    "requests a typed date sort when the start field is %s",
    async (type) => {
      const { client, listRecordsPage } = makeClient({ total: 1_250, inPeriod: 2 });
      renderGantt(client, {
        baseFields: [fields[0], field("start", type, 1), fields[2]],
      });
      await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
      expect(periodCalls(listRecordsPage)[0].sort).toEqual({
        fieldSlug: "start",
        fieldType: "date",
        direction: "asc",
      });
    },
  );

  it("keeps a clipped task's title and both resize edges within the visible period", async () => {
    const longTask = record(1);
    const earlier = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const later = new Date(today.getFullYear(), today.getMonth() + 7, 1);
    const dayString = (date: Date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    longTask.headCommit.payload = {
      title: "Long launch",
      start: dayString(earlier),
      end: dayString(later),
    };
    const onPatchRecord = vi.fn(async () => ({ materialized: true as const }));
    const client = {
      listRecordsPage: vi.fn(async (input: PageInput) => ({
        records: [longTask],
        total: input.dateRanges ? 1 : 501,
        totalCapped: !input.dateRanges,
        totalPages: 1,
        page: 1,
      })),
    } as unknown as BusabaseDashboardApiClient;
    renderGantt(client, { onPatchRecord });
    await screen.findByTestId("gantt-period");
    const bar = await screen.findByTestId(`gantt-bar-${longTask.id}`);
    const track = bar.parentElement as HTMLDivElement;
    expect(bar.style.left).toBe("0px");
    expect(bar.style.width).toBe(track.style.width);
    expect(bar.textContent).toContain("Long launch");
    const startHandle = screen.getByTestId(`gantt-resize-start-${longTask.id}`);
    const endHandle = screen.getByTestId(`gantt-resize-end-${longTask.id}`);
    expect(bar.contains(startHandle)).toBe(true);
    expect(bar.contains(endHandle)).toBe(true);
    bar.getBoundingClientRect = () =>
      ({ left: 0, width: 900, top: 0, height: 20, right: 900, bottom: 20 }) as DOMRect;

    // Merely grabbing the clipped edge must not reset the real start date to
    // the first visible day.
    fireEvent.mouseDown(startHandle, { clientX: 1 });
    fireEvent.mouseUp(startHandle, { clientX: 1 });
    expect(onPatchRecord).not.toHaveBeenCalled();

    // Month scale is 5px/day. Resizing right by two days changes the actual
    // start by two days, even while it is still before the visible period.
    fireEvent.mouseDown(startHandle, { clientX: 1 });
    fireEvent.mouseMove(window, { clientX: 11 });
    fireEvent.mouseUp(startHandle, { clientX: 11 });
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledTimes(1));
    expect(onPatchRecord).toHaveBeenCalledWith(longTask, {
      ...longTask.headCommit.payload,
      start: dayString(new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate() + 2)),
    });

    // The far edge can be released outside the track; it still moves the real
    // end, rather than requiring a mouse-up on the bar itself.
    fireEvent.mouseDown(endHandle, { clientX: 899 });
    fireEvent.mouseMove(window, { clientX: 909 });
    fireEvent.mouseUp(window, { clientX: 909 });
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledTimes(2));
    expect(onPatchRecord).toHaveBeenLastCalledWith(longTask, {
      ...longTask.headCommit.payload,
      end: dayString(new Date(later.getFullYear(), later.getMonth(), later.getDate() + 2)),
    });

    // Native events can all arrive before React paints a drag preview. Do not
    // let a stale state snapshot turn a real quick resize into a no-op.
    act(() => {
      startHandle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 1 }));
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 16 }));
      window.dispatchEvent(new MouseEvent("mouseup", { clientX: 16 }));
    });
    await waitFor(() => expect(onPatchRecord).toHaveBeenCalledTimes(3));
    expect(onPatchRecord).toHaveBeenLastCalledWith(longTask, {
      ...longTask.headCommit.payload,
      start: dayString(new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate() + 3)),
    });
  });
});
