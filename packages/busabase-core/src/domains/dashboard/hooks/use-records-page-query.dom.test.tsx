// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordsPageQuery, viewReadsOwnRecords } from "./use-records-page-query";

const fields = [
  { id: "fld_title", slug: "title", type: "text" },
  { id: "fld_stage", slug: "stage", type: "select" },
  { id: "fld_amount", slug: "amount", type: "number" },
] as BaseFieldVO[];
const base = { id: "base", fields } as BaseVO;
const view = (type: ViewVO["type"], config: Partial<ViewVO["config"]> = {}) =>
  ({ id: "view", type, config: { filters: [], sorts: [], ...config } }) as ViewVO;

// The page read the dashboard would send to `records.listPage`.
const listPage = vi.fn();
const orpc = {
  records: {
    listPage: {
      queryOptions: ({ input }: { input: unknown }) => ({
        queryKey: [["records", "listPage"], { input, type: "query" }],
        queryFn: () => listPage(input),
      }),
    },
  },
} as unknown as BusabaseQueryUtils;

const run = (
  activeView: ViewVO | null,
  blocked = false,
  find?: { query: string; fieldId?: string },
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useRecordsPageQuery({
        orpc,
        base,
        view: activeView,
        blocked,
        input: {
          baseId: base.id,
          viewId: activeView?.id,
          listMode: "table",
          find,
          page: 1,
          pageSize: 50,
        },
      }),
    { wrapper },
  );
};

// Give a disabled query every chance to fire before asserting it did not.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => {
  listPage.mockReset();
  listPage.mockResolvedValue({ records: [], total: 0, totalPages: 0, page: 1 });
});
afterEach(cleanup);

describe("the Base page's records.listPage read", () => {
  it("runs for an ungrouped table", async () => {
    const { result } = run(view("table"));
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
    expect(listPage).toHaveBeenCalledWith(
      expect.objectContaining({ baseId: "base", viewId: "view" }),
    );
    expect(result.current.readsOwnRecords).toBe(false);
  });

  it("is never sent for a grouped table, whose groups page themselves", async () => {
    const { result } = run(view("table", { groupBy: [{ fieldSlug: "stage", direction: "asc" }] }));
    await settle();
    expect(listPage).not.toHaveBeenCalled();
    expect(result.current.readsOwnRecords).toBe(true);
    expect(result.current.query.isLoading).toBe(false);
  });

  it("still runs when the saved grouping no longer applies", async () => {
    run(view("table", { groupBy: [{ fieldSlug: "amount", direction: "asc" }] }));
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
  });

  it("stays off for a Kanban board and for a blocked route", async () => {
    run(view("kanban"));
    run(view("table"), true);
    await settle();
    expect(listPage).not.toHaveBeenCalled();
  });

  it.each([
    ["calendar", undefined],
    ["calendar", { query: "Customer", fieldId: "fld_title" }],
    ["gantt", undefined],
    ["gantt", { query: "Customer", fieldId: "fld_title" }],
  ] as const)("leaves %s date reads to the view with find %j", async (type, find) => {
    const { result } = run(view(type), false, find);
    await settle();
    expect(listPage).not.toHaveBeenCalled();
    expect(result.current.readsOwnRecords).toBe(true);
    expect(result.current.query.isLoading).toBe(false);
  });

  it("decides grouping per view type and field", () => {
    const grouped = { groupBy: [{ fieldSlug: "stage", direction: "asc" as const }] };
    expect(viewReadsOwnRecords(view("table", grouped), base)).toBe(true);
    expect(viewReadsOwnRecords(view("gallery", grouped), base)).toBe(false);
    expect(viewReadsOwnRecords(view("table"), base)).toBe(false);
    expect(viewReadsOwnRecords(null, base)).toBe(false);
  });
});
