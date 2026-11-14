// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// Every header must come from its own bounded cards read. The board must not
// start a whole-Base groupBy simply to show counts.
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const { BusaBaseKanban } = await import("./base-kanban");

const stackField: BaseFieldVO = {
  id: "fld_state",
  baseId: "bas_tasks",
  slug: "state",
  name: "State",
  type: "select",
  required: false,
  position: 1,
  options: {
    choices: [
      { id: "todo", name: "To do" },
      { id: "done", name: "Done" },
    ],
  },
};
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
  stackField,
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
  id: "viw_board",
  baseId: base.id,
  slug: "board",
  name: "Board",
  description: "",
  type: "kanban",
  config: { filters: [], sorts: [], stackByFieldSlug: "state" },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

type ColumnInput = Parameters<BusabaseDashboardApiClient["listRecordsPage"]>[0];
type Page = Awaited<ReturnType<BusabaseDashboardApiClient["listRecordsPage"]>>;
const emptyPage: Page = { records: [], total: 0, page: 1, totalPages: 1 };
const makeClient = (read: (input: ColumnInput) => Promise<Page> = async () => emptyPage) => {
  const listRecordsPage = vi.fn(read);
  const groupRecords = vi.fn(async () => {
    throw new Error("A board must not aggregate the Base");
  });
  return {
    client: { groupRecords, listRecordsPage } as unknown as BusabaseDashboardApiClient,
    groupRecords,
    listRecordsPage,
  };
};
const record = (index: number): RecordVO => ({
  id: `rec_${index}`,
  base,
  baseId: base.id,
  headCommitId: `com_${index}`,
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  headCommit: {
    id: `com_${index}`,
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: `Task ${index}`, state: "todo" },
    operation: "record_create",
    message: "",
    author: "owner",
    createdAt: base.createdAt,
  },
});
const renderBoard = (client: BusabaseDashboardApiClient) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="read">
          <BusaBaseKanban activeView={view} base={base} client={client} fields={fields} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe("a Kanban column", () => {
  it("gets cards and bounded headers without aggregating the Base", async () => {
    const { client, groupRecords, listRecordsPage } = makeClient();
    renderBoard(client);
    await waitFor(() => expect(listRecordsPage).toHaveBeenCalledTimes(3));
    expect(groupRecords).not.toHaveBeenCalled();
    for (const [input] of listRecordsPage.mock.calls) {
      expect(input.totalLimit).toBe((input.page ?? 1) * 20 + 1);
      expect(input.viewId).toBe(view.id);
    }
    expect(await within(screen.getByTestId("kanban-column-todo")).findByText("0")).toBeTruthy();
  });

  it("shows a lower bound while paginating, then the exact total, without losing cards", async () => {
    const { client, groupRecords, listRecordsPage } = makeClient(async (input) => {
      if (input.filters?.[0]?.value !== "todo") return emptyPage;
      const page = input.page ?? 1;
      return {
        records: Array.from({ length: page === 3 ? 5 : 20 }, (_, i) => record((page - 1) * 20 + i)),
        page,
        total: page === 3 ? 45 : page * 20 + 1,
        totalPages: 3,
        totalCapped: page < 3,
      };
    });
    renderBoard(client);
    const column = within(screen.getByTestId("kanban-column-todo"));
    expect(await column.findByText("20+")).toBeTruthy();
    expect(column.getAllByRole("link")).toHaveLength(20);
    fireEvent.click(column.getByRole("button", { name: "Load more" }));
    expect(await column.findByText("40+")).toBeTruthy();
    expect(column.getAllByRole("link")).toHaveLength(40);
    fireEvent.click(column.getByRole("button", { name: "Load more" }));
    expect(await column.findByText("45")).toBeTruthy();
    expect(column.getAllByRole("link")).toHaveLength(45);
    expect(column.queryByRole("button", { name: "Load more" })).toBeNull();
    const todoReads = listRecordsPage.mock.calls.filter(
      ([input]) => input.filters?.[0]?.value === "todo",
    );
    expect(todoReads.map(([input]) => input.totalLimit)).toEqual([21, 41, 61]);
    expect(groupRecords).not.toHaveBeenCalled();
  });
});

describe("the Uncategorized column", () => {
  it("waits for its own read and stays hidden when that read is empty", async () => {
    let resolveEmpty: (value: Page) => void = () => {};
    const { client, listRecordsPage } = makeClient(async (input) =>
      input.filters?.[0]?.operator === "is_empty"
        ? new Promise((resolve) => {
            resolveEmpty = resolve;
          })
        : emptyPage,
    );
    renderBoard(client);
    await waitFor(() => expect(listRecordsPage).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId("kanban-column-__uncategorized__")).toBeNull();
    resolveEmpty(emptyPage);
    await waitFor(() => expect(screen.queryByText("…")).toBeNull());
    expect(screen.queryByTestId("kanban-column-__uncategorized__")).toBeNull();
  });

  it("shows unset records even when there is no aggregate result", async () => {
    const { client, groupRecords } = makeClient(async (input) =>
      input.filters?.[0]?.operator === "is_empty"
        ? {
            records: [
              {
                ...record(1),
                headCommit: { ...record(1).headCommit, payload: { title: "Unplanned" } },
              },
            ],
            total: 1,
            page: 1,
            totalPages: 1,
          }
        : emptyPage,
    );
    renderBoard(client);
    const column = within(await screen.findByTestId("kanban-column-__uncategorized__"));
    expect(column.getByRole("link", { name: "Unplanned" })).toBeTruthy();
    expect(column.getByText("1")).toBeTruthy();
    expect(groupRecords).not.toHaveBeenCalled();
  });

  it("shows an error and retries an unreadable bucket, without retrying automatically or hiding it", async () => {
    let failed = true;
    const { client, listRecordsPage } = makeClient(async (input) => {
      if (input.filters?.[0]?.operator !== "is_empty") return emptyPage;
      if (failed)
        throw new Error(
          "This view has too many records to work through. Add a filter to narrow it, then try again.",
        );
      return {
        records: [
          {
            ...record(1),
            headCommit: { ...record(1).headCommit, payload: { title: "Recovered" } },
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      };
    });
    renderBoard(client);
    const column = within(await screen.findByTestId("kanban-column-__uncategorized__"));
    expect(column.getByRole("alert").textContent).toContain("too many records");
    expect(
      listRecordsPage.mock.calls.filter(([input]) => input.filters?.[0]?.operator === "is_empty"),
    ).toHaveLength(1);
    failed = false;
    fireEvent.click(column.getByRole("button", { name: "Retry" }));
    expect(await column.findByRole("link", { name: "Recovered" })).toBeTruthy();
    expect(column.queryByRole("alert")).toBeNull();
  });
});
