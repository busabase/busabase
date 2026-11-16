// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { type ReactNode, useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordCollectionStatus } from "../helpers/record-collection-status";
import type { RecordFindState } from "../helpers/record-find-url";
import { useRecordFind } from "../hooks/use-record-find";
import { BusaBaseKanban } from "./base-kanban";
import { RecordFind } from "./record-find-control";

vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const base = {
  id: "bas_board_find",
  nodeId: "nod_board_find",
  slug: "board-find",
  name: "Board find",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-12T00:00:00Z",
  fields: [
    {
      id: "fld_title",
      baseId: "bas_board_find",
      slug: "title",
      name: "Title",
      type: "text",
      required: true,
      position: 0,
      options: {},
    },
    {
      id: "fld_status",
      baseId: "bas_board_find",
      slug: "status",
      name: "Status",
      type: "select",
      required: false,
      position: 1,
      options: {
        choices: [
          { id: "todo", name: "Todo" },
          { id: "done", name: "Done" },
        ],
      },
    },
  ],
} satisfies BaseVO;
const view = {
  id: "viw_board_find",
  baseId: base.id,
  slug: "board",
  name: "Board",
  description: "",
  type: "kanban",
  config: { filters: [], sorts: [], stackByFieldSlug: "status" },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-11-12T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
} satisfies ViewVO;
type PageInput = Parameters<BusabaseDashboardApiClient["listRecordsPage"]>[0];
type PageResult = Awaited<ReturnType<BusabaseDashboardApiClient["listRecordsPage"]>>;
const record = (title: string, status: string | null = "todo"): RecordVO =>
  ({
    id: `rec_${title}`,
    baseId: base.id,
    base,
    headCommitId: `cmt_${title}`,
    parentRecordId: null,
    parentCommitId: null,
    status: "active",
    createdBy: "usr_test",
    archivedAt: null,
    createdAt: "2026-11-12T00:00:00Z",
    updatedAt: "2026-11-12T00:00:00Z",
    headCommit: {
      id: `cmt_${title}`,
      baseId: base.id,
      targetType: "base",
      nodeId: null,
      operationId: null,
      parentCommitId: null,
      payload: { title, status },
      operation: "record_create",
      message: "",
      author: "usr_test",
      createdAt: "2026-11-12T00:00:00Z",
    },
  }) satisfies RecordVO;
const page = (input: PageInput, rows: RecordVO[]): PageResult => ({
  records: rows.slice(((input.page ?? 1) - 1) * 20, (input.page ?? 1) * 20),
  total: rows.length,
  totalPages: Math.ceil(rows.length / 20),
  page: input.page ?? 1,
});
const isTodo = (input: PageInput) => input.filters?.[0]?.value === "todo";
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

function setup(
  listRecordsPage: (input: PageInput) => Promise<PageResult>,
  initial: RecordFindState = { query: "needle", fieldId: "" },
  groupRecords = vi.fn().mockResolvedValue({ total: 200, groups: [] }),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  const onMoveRecord = vi.fn().mockResolvedValue({ materialized: false, changeRequestId: "cr_1" });
  const status = vi.fn<(value: RecordCollectionStatus) => void>();
  const api = { listRecordsPage, groupRecords } as unknown as BusabaseDashboardApiClient;
  function Harness() {
    const [value, setValue] = useState(initial);
    const commit = useCallback((next: RecordFindState) => setValue(next), []);
    const control = useRecordFind({ value, scope: `${base.id}:${view.id}`, onCommit: commit });
    return (
      <QueryClientProvider client={queryClient}>
        <CoreI18nProvider locale="en">
          <RecordFind control={control} fields={base.fields} visibleSlugs={["title", "status"]} />
          <BusaBaseKanban
            activeView={view}
            base={base}
            client={api}
            fields={base.fields}
            onCollectionStatusChange={status}
            onMoveRecord={onMoveRecord}
            recordFind={control}
          />
        </CoreI18nProvider>
      </QueryClientProvider>
    );
  }
  const result = render(<Harness />);
  return { ...result, groupRecords, onMoveRecord, status, queryClient };
}

describe("Kanban shared record find", () => {
  it("keeps newly unclassified cards after clearing without querying whole-Base groups", async () => {
    let unclassified = false;
    const list = vi.fn(async (input: PageInput) => {
      const inColumn = unclassified ? input.filters?.[0]?.operator === "is_empty" : isTodo(input);
      return page(input, inColumn ? [record("needle", unclassified ? null : "todo")] : []);
    });
    const groups = vi.fn().mockRejectedValue(new Error("A board must not aggregate the Base"));
    const { queryClient, status } = setup(list, { query: "", fieldId: "" }, groups);
    const todo = screen.getByTestId("kanban-column-todo");
    await waitFor(() =>
      expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("1"),
    );
    await waitFor(() => expect(screen.queryByTestId("kanban-column-__uncategorized__")).toBeNull());
    fireEvent.change(screen.getByTestId("base-record-find-input"), {
      target: { value: "needle" },
    });
    await waitFor(() =>
      expect(list.mock.calls.some(([input]) => input.find?.query === "needle")).toBe(true),
    );
    unclassified = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["busabase", "kanban-column"] });
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId("kanban-column-__uncategorized__")).getByTestId(
          "kanban-column-count",
        ).textContent,
      ).toBe("1"),
    );
    fireEvent.click(screen.getByTestId("base-record-find-clear"));
    await waitFor(() =>
      expect(status.mock.lastCall?.[0]).toMatchObject({ total: 1, isFetching: false }),
    );
    expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("0");
    const uncategorized = screen.getByTestId("kanban-column-__uncategorized__");
    expect(within(uncategorized).getByTestId("kanban-column-count").textContent).toBe("1");
    expect(within(uncategorized).getByText("needle")).toBeTruthy();
    expect(groups).not.toHaveBeenCalled();
  });

  it("keeps bounded counts as lower bounds until the last column page, including find", async () => {
    const rows = Array.from({ length: 45 }, (_, index) => record(`needle-${index}`));
    const list = vi.fn(async (input: PageInput): Promise<PageResult> => {
      const result = page(input, isTodo(input) ? rows : []);
      if (isTodo(input) && (input.page ?? 1) < 3) {
        return { ...result, total: (input.page ?? 1) * 20 + 1, totalCapped: true };
      }
      return result;
    });
    const { status, groupRecords } = setup(list);
    const todo = screen.getByTestId("kanban-column-todo");
    await waitFor(() =>
      expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("20+"),
    );
    await waitFor(() =>
      expect(status.mock.lastCall?.[0]).toMatchObject({ total: 20, totalCapped: true }),
    );
    fireEvent.click(within(todo).getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("40+"),
    );
    fireEvent.click(within(todo).getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("45"),
    );
    await waitFor(() =>
      expect(status.mock.lastCall?.[0]).toMatchObject({ total: 45, isFetching: false }),
    );
    expect(status.mock.lastCall?.[0].totalCapped).not.toBe(true);
    expect(
      list.mock.calls.filter(([input]) => isTodo(input)).map(([input]) => input.totalLimit),
    ).toEqual([21, 41, 61]);
    expect(groupRecords).not.toHaveBeenCalled();
  });

  it("does not load an old column's next page while a replacement query is pending", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => record(`draft-${index}`));
    const list = vi.fn(async (input: PageInput) => page(input, isTodo(input) ? rows : []));
    setup(list);
    const todo = screen.getByTestId("kanban-column-todo");
    await within(todo).findByRole("button", { name: "Load more" });
    fireEvent.change(screen.getByTestId("base-record-find-input"), {
      target: { value: "replacement" },
    });
    expect(within(todo).queryByRole("button", { name: "Load more" })).toBeNull();
    expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(0);
    expect(list.mock.calls.some(([input]) => input.page === 2)).toBe(false);
  });

  it("does not show the last zero-match message while editing a new search", async () => {
    const list = vi.fn(async (input: PageInput) => page(input, []));
    setup(list);
    await screen.findByTestId("base-record-find-empty");
    fireEvent.change(screen.getByTestId("base-record-find-input"), {
      target: { value: "replacement" },
    });
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
  });

  it("finds all pages with exact column counts and sends the same committed field input", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => record(`needle-${index}`));
    const list = vi.fn(async (input: PageInput) => page(input, isTodo(input) ? rows : []));
    const { groupRecords, status } = setup(list, { query: "needle", fieldId: "fld_title" });
    const todo = screen.getByTestId("kanban-column-todo");
    await waitFor(() =>
      expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("30"),
    );
    expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(20);
    expect(groupRecords).not.toHaveBeenCalled();
    expect(list.mock.calls.every(([input]) => input.find?.fieldId === "fld_title")).toBe(true);
    fireEvent.click(within(todo).getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(30));
    expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("30");
    await waitFor(() =>
      expect(status.mock.lastCall?.[0]).toMatchObject({ total: 30, isFetching: false }),
    );
    expect(
      list.mock.calls.some(([input]) => input.page === 2 && input.find?.query === "needle"),
    ).toBe(true);
  });

  it("preserves loaded cards and retries a failed later page instead of claiming empty results", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => record(`retry-${index}`));
    let failNextPage = true;
    const list = vi.fn(async (input: PageInput) => {
      if (isTodo(input) && input.page === 2 && failNextPage) {
        failNextPage = false;
        throw new Error("Temporary page failure");
      }
      return page(input, isTodo(input) ? rows : []);
    });
    setup(list);
    const todo = screen.getByTestId("kanban-column-todo");
    await waitFor(() => expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(20));
    fireEvent.click(within(todo).getByRole("button", { name: "Load more" }));
    await within(todo).findByRole("alert");
    expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(20);
    expect(within(todo).getByTestId("kanban-column-count").textContent).toBe("30");
    expect(todo.querySelector("[draggable=true]")).toBeNull();
    fireEvent.click(within(todo).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(todo.querySelectorAll("[data-record-id]")).toHaveLength(30));
    expect(within(todo).queryByRole("alert")).toBeNull();
  });

  it("retries an initial failure and clears immediately back to the original board", async () => {
    let fail = true;
    const list = vi.fn(async (input: PageInput) => {
      if (input.find && isTodo(input) && fail) {
        fail = false;
        throw new Error("Temporary first page failure");
      }
      return page(input, isTodo(input) ? [record(input.find ? "match" : "restored")] : []);
    });
    const { groupRecords } = setup(list);
    const todo = screen.getByTestId("kanban-column-todo");
    await within(todo).findByRole("alert");
    expect(screen.queryByTestId("base-record-find-empty")).toBeNull();
    fireEvent.click(within(todo).getByRole("button", { name: "Retry" }));
    await within(todo).findByText("match");
    fireEvent.click(screen.getByTestId("base-record-find-clear"));
    await within(todo).findByText("restored");
    expect(groupRecords).not.toHaveBeenCalled();
    expect(list.mock.calls.some(([input]) => input.find === undefined)).toBe(true);
  });

  it("ignores late old-query responses and blocks dragging while a new draft is pending", async () => {
    let finishSlow: (value: PageResult) => void = () => {};
    const list = vi.fn(async (input: PageInput) => {
      if (!isTodo(input)) return page(input, []);
      if (input.find?.query === "slow") {
        return new Promise<PageResult>((resolve) => {
          finishSlow = resolve;
        });
      }
      return page(input, [record(input.find?.query ?? "all")]);
    });
    const { onMoveRecord } = setup(list, { query: "ready", fieldId: "" });
    const todo = screen.getByTestId("kanban-column-todo");
    await within(todo).findByText("ready");
    await waitFor(() => expect(todo.querySelector("[draggable=true]")).not.toBeNull());
    fireEvent.dragStart(todo.querySelector("[data-record-id]") as Element);
    fireEvent.change(screen.getByTestId("base-record-find-input"), { target: { value: "slow" } });
    expect(todo.querySelector("[draggable=true]")).toBeNull();
    fireEvent.drop(screen.getByTestId("kanban-column-done"));
    expect(onMoveRecord).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(list.mock.calls.some(([input]) => input.find?.query === "slow")).toBe(true),
    );
    fireEvent.change(screen.getByTestId("base-record-find-input"), { target: { value: "fast" } });
    await within(todo).findByText("fast");
    await act(async () => finishSlow(page({ baseId: base.id }, [record("late-slow")])));
    expect(within(todo).queryByText("late-slow")).toBeNull();
    expect(within(todo).getByText("fast")).toBeTruthy();
  });
});
