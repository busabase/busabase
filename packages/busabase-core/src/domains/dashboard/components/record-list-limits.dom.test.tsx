// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider, loadCoreMessages } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { SubmitPermissionProvider } from "./split-submit-button";

// What a reader sees when a Base outgrows the record-list limits: a total that
// says "at least", page numbers that say where they stop, and "too many
// records, add a filter" where a view would otherwise look empty.
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { RecordsPaginationBar } = await import("./records-pagination-bar");
const { BusaBaseKanban } = await import("./base-kanban");
const { BusaBaseCalendar } = await import("./base-calendar");

// The server's text (domains/base/logic/record-list-guards.ts) — it reaches the
// client only as an error message.
const VIEW_TOO_LARGE =
  "This view has too many records to work through. Add a filter to narrow it, then try again.";

const field = (slug: string, type: BaseFieldVO["type"], options = {}): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_tasks",
  slug,
  name: slug,
  type,
  required: slug === "title",
  position: 0,
  options,
});
const fields = [
  field("title", "text"),
  field("state", "select", { choices: [{ id: "todo", name: "To do" }] }),
  field("due", "date"),
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
const view = (type: ViewVO["type"]): ViewVO => ({
  id: `viw_${type}`,
  baseId: base.id,
  slug: type,
  name: type,
  description: "",
  type,
  config: { filters: [], sorts: [], stackByFieldSlug: "state", dateFieldSlug: "due" },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const harness = (children: ReactNode, locale: "en" | "zh-CN" = "en") => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CoreI18nProvider locale={locale}>
      <SubmitPermissionProvider permissionLevel="read">{children}</SubmitPermissionProvider>
    </CoreI18nProvider>
  </QueryClientProvider>
);
const failingClient = () => {
  const listRecordsPage = vi.fn(async (input: { filters?: Array<{ operator: string }> }) => {
    if (input.filters?.[0]?.operator === "is_empty") {
      return { records: [], total: 0, page: 1, totalPages: 1 };
    }
    throw new Error(VIEW_TOO_LARGE);
  });
  return {
    client: {
      listRecordsPage,
      groupRecords: vi.fn(async () => ({ groups: [{ value: "todo", count: 3 }], total: 3 })),
    } as unknown as BusabaseDashboardApiClient,
    listRecordsPage,
  };
};

afterEach(cleanup);

describe("a capped page", () => {
  const bar = (flags: { totalCapped?: boolean; pagesCapped?: boolean }) =>
    render(
      harness(
        <RecordsPaginationBar
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
          page={1}
          pageSize={50}
          total={1_000_000}
          totalPages={2_000}
          {...flags}
        />,
      ),
    );

  it("shows the total as a lower bound and says where page numbers stop", () => {
    bar({ totalCapped: true, pagesCapped: true });
    expect(screen.getByText("1–50 of 1000000+")).toBeTruthy();
    expect(
      screen.getByText(
        "Page numbers reach the first 100000 records. Filter or sort to find the rest.",
      ),
    ).toBeTruthy();
  });

  it("says nothing extra for a page that is not capped", () => {
    bar({});
    expect(screen.getByText("1–50 of 1000000")).toBeTruthy();
    expect(screen.queryByText(/Page numbers reach/)).toBeNull();
  });
});

describe("a view too large to read", () => {
  // The other tests here turn retries off; this one keeps React Query's default
  // (three tries, the first after about a second) because that is what ran the
  // 15 s query again and again while the reader waited for the message.
  it("is asked for once, not retried", async () => {
    const { client, listRecordsPage } = failingClient();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CoreI18nProvider locale="en">
          <SubmitPermissionProvider permissionLevel="read">
            <BusaBaseKanban
              activeView={view("kanban")}
              base={base}
              client={client}
              fields={fields}
            />
          </SubmitPermissionProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    expect((await screen.findByRole("alert")).textContent).toBe(VIEW_TOO_LARGE);
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    expect(
      listRecordsPage.mock.calls.filter(([input]) => input.filters?.[0]?.operator !== "is_empty"),
    ).toHaveLength(1);
  });

  it("is translated from the server's message", async () => {
    expect(localizeCoreErrorMessage(await loadCoreMessages("zh-CN"), VIEW_TOO_LARGE)).toBe(
      "这个视图的记录太多，处理不过来。请添加筛选条件缩小范围后重试。",
    );
  });

  it("tells a Kanban column's reader, who can retry", async () => {
    const { client, listRecordsPage } = failingClient();
    render(
      harness(
        <BusaBaseKanban activeView={view("kanban")} base={base} client={client} fields={fields} />,
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(VIEW_TOO_LARGE);
    const calls = listRecordsPage.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(listRecordsPage.mock.calls.length).toBe(calls + 1));
  });

  it("tells the Calendar's reader instead of showing an empty month", async () => {
    const { client, listRecordsPage } = failingClient();
    render(
      harness(
        <BusaBaseCalendar
          activeView={view("calendar")}
          base={base}
          client={client}
          fields={fields}
        />,
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(VIEW_TOO_LARGE);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(listRecordsPage).toHaveBeenCalledTimes(2));
  });
});
