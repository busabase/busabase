// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// The "Uncategorized" column's read ("has no value") is the board's slowest on
// a large Base and keeps running once sent, so it waits for the column counts
// and is only sent for a bucket that holds records.
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

type ColumnInput = { filters?: Array<{ operator: string }> };
const emptyPage = { records: [], total: 0, page: 1, totalPages: 1 };
const makeClient = (groupRecords: () => Promise<unknown>) => {
  const listRecordsPage = vi.fn(async (_input: ColumnInput) => emptyPage);
  return {
    client: { groupRecords, listRecordsPage } as unknown as BusabaseDashboardApiClient,
    uncategorizedReads: () =>
      listRecordsPage.mock.calls.filter(([input]) => input.filters?.[0]?.operator === "is_empty"),
    listRecordsPage,
  };
};
const renderBoard = (client: BusabaseDashboardApiClient) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CoreI18nProvider locale="en">
        <SubmitPermissionProvider permissionLevel="read">
          <BusaBaseKanban activeView={view} base={base} client={client} fields={fields} />
        </SubmitPermissionProvider>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe("the Uncategorized column", () => {
  it("is not read while the counts load, nor when they show it empty", async () => {
    let resolveCounts: (value: unknown) => void = () => {};
    const { client, listRecordsPage, uncategorizedReads } = makeClient(
      () =>
        new Promise((resolve) => {
          resolveCounts = resolve;
        }),
    );
    renderBoard(client);
    await waitFor(() => expect(listRecordsPage).toHaveBeenCalledTimes(2));
    expect(uncategorizedReads()).toHaveLength(0);
    expect(screen.queryByTestId("kanban-column-__uncategorized__")).toBeNull();

    resolveCounts({ groups: [{ value: "todo", count: 3 }], total: 3 });
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
    expect(screen.queryByTestId("kanban-column-__uncategorized__")).toBeNull();
    expect(uncategorizedReads()).toHaveLength(0);
  });

  it("is read once the counts say it holds records", async () => {
    const { client, uncategorizedReads } = makeClient(async () => ({
      groups: [
        { value: "todo", count: 3 },
        { value: null, count: 2 },
      ],
      total: 5,
    }));
    renderBoard(client);
    expect(await screen.findByTestId("kanban-column-__uncategorized__")).toBeTruthy();
    await waitFor(() => expect(uncategorizedReads()).toHaveLength(1));
  });

  it("still shows when the counts fail", async () => {
    // What counting a Base too large for the 15 s budget looks like. It is not
    // retried (any other failure is, three times, which this test would sit out).
    const { client, uncategorizedReads } = makeClient(async () => {
      throw new Error(
        "This view has too many records to work through. Add a filter to narrow it, then try again.",
      );
    });
    renderBoard(client);
    expect(await screen.findByTestId("kanban-column-__uncategorized__")).toBeTruthy();
    await waitFor(() => expect(uncategorizedReads()).toHaveLength(1));
  });
});
