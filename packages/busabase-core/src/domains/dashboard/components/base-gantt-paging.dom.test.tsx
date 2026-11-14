// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// The timeline reads its view a page at a time and never drains the Base: it
// loads five pages on its own, then one more per "Load more".
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
    payload: { title: `Task ${index}`, start: "2026-11-02", end: "2026-11-05" },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

const TOTAL = 1_250;
const listRecordsPage = vi.fn(async (input: { page: number; pageSize: number }) => {
  const from = (input.page - 1) * input.pageSize;
  const count = Math.max(0, Math.min(input.pageSize, TOTAL - from));
  return {
    records: Array.from({ length: count }, (_, i) => record(from + i + 1)),
    total: TOTAL,
    page: input.page,
    totalPages: Math.ceil(TOTAL / input.pageSize),
  };
});
const client = { listRecordsPage } as unknown as BusabaseDashboardApiClient;

afterEach(() => {
  cleanup();
  listRecordsPage.mockClear();
});

describe("Gantt rows", () => {
  it("shows an ordinary project whole and a large one five pages at a time", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="en">
          <SubmitPermissionProvider permissionLevel="read">
            <BusaBaseGantt activeView={view} base={base} client={client} fields={fields} />
          </SubmitPermissionProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1–500 of 1250", undefined, { timeout: 5_000 })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(500);
    expect(listRecordsPage.mock.calls[0]?.[0]).toMatchObject({
      baseId: base.id,
      viewId: view.id,
      page: 1,
      pageSize: 100,
    });
    // It stops on its own after five pages: with the fifth on screen and the
    // button idle, nothing more has been asked for.
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(listRecordsPage).toHaveBeenCalledTimes(5);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("1–600 of 1250", undefined, { timeout: 5_000 })).toBeTruthy();
    expect(listRecordsPage.mock.calls.map(([input]) => input.page)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("leaves no count and no button once every row is loaded", async () => {
    listRecordsPage.mockImplementationOnce(async () => ({
      records: [record(1), record(2)],
      total: 2,
      page: 1,
      totalPages: 1,
    }));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="en">
          <SubmitPermissionProvider permissionLevel="read">
            <BusaBaseGantt activeView={view} base={base} client={client} fields={fields} />
          </SubmitPermissionProvider>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(listRecordsPage).toHaveBeenCalledTimes(1);
  });
});
