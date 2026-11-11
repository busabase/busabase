// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseVO, GridRowHeight, RecordVO, ViewVO } from "busabase-contract/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "",
  useLocation: () => ["/base/tasks/grid", vi.fn()],
}));
vi.mock("openlib/ui/dashboard", () => ({
  useAddDemoParam: () => (href: string) => href,
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
const measure = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: {
    scrollMargin: number;
    estimateSize: () => number;
    count: number;
  }) => ({
    getTotalSize: () => options.count * options.estimateSize(),
    getVirtualItems: () => [
      { index: 50, start: options.scrollMargin + 50 * options.estimateSize() },
    ],
    measure,
    options,
  }),
}));
const { BusaBaseTable } = await import("./base-table");

const base: BaseVO = {
  id: "base",
  nodeId: "node",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-11-10T00:00:00Z",
  fields: [
    {
      id: "field",
      baseId: "base",
      slug: "title",
      name: "Title",
      type: "longtext",
      position: 0,
      required: false,
      options: {},
    },
  ],
};
const record: RecordVO = {
  id: "record",
  baseId: base.id,
  headCommitId: "commit",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
  base,
  headCommit: {
    id: "commit",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "First line\nSecond line\nThird line" },
    operation: "record_create",
    message: "",
    author: "owner",
    createdAt: base.createdAt,
  },
};
const view = (height?: GridRowHeight): ViewVO => ({
  id: "view",
  baseId: base.id,
  slug: "grid",
  name: "Grid",
  description: "",
  type: "table",
  config: { filters: [], sorts: [], ...(height ? { rowHeight: height } : {}) },
  status: "active",
  position: 0,
  createdBy: "owner",
  archivedAt: null,
  createdAt: base.createdAt,
  updatedAt: base.createdAt,
});
const table = (
  height?: GridRowHeight,
  {
    level = "write",
    records = [record],
    loading = false,
    type = "table" as ViewVO["type"],
    scrollElement = null as HTMLElement | null,
    onUpdateView = vi.fn(),
  } = {},
) => {
  const activeView = { ...view(height), type };
  return (
    <CoreI18nProvider locale="en">
      <SubmitPermissionProvider permissionLevel={level as ApiKeyPermissionLevel}>
        <BusaBaseTable
          activeView={activeView}
          archivedRecords={[{ ...record, id: "archived", status: "archived" }]}
          base={base}
          client={{} as BusabaseDashboardApiClient}
          onCreateView={vi.fn()}
          onDeleteView={vi.fn()}
          onUpdateView={onUpdateView}
          records={records}
          scrollElementRef={{ current: scrollElement }}
          views={[activeView]}
          pagination={
            loading
              ? {
                  page: 1,
                  pageSize: 25,
                  total: 1,
                  totalPages: 1,
                  isLoading: true,
                  onPageChange: vi.fn(),
                  onPageSizeChange: vi.fn(),
                }
              : undefined
          }
        />
      </SubmitPermissionProvider>
    </CoreI18nProvider>
  );
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  measure.mockClear();
});

describe("table density geometry", () => {
  it.each([
    ["write", "Apply", true],
    ["changeRequest", "Submit for review", false],
  ] as const)(
    "keeps the current table route for %s height submissions",
    async (level, action, mergeImmediately) => {
      const onUpdateView = vi.fn().mockResolvedValue(undefined);
      render(table("medium", { level, onUpdateView }));
      fireEvent.click(screen.getByTestId("row-height-control"));
      fireEvent.click(screen.getByTestId("row-height-option-tall"));
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() =>
        expect(onUpdateView).toHaveBeenCalledWith(
          view("medium"),
          { config: { rowHeight: "tall" } },
          { mergeImmediately, preserveLocation: true },
        ),
      );
      expect(screen.getByTestId("base-records-grid")).toBeTruthy();
      if (!mergeImmediately)
        expect(screen.getByRole("status").textContent).toContain("after approval and merge");
    },
  );

  it("keeps legacy rows at 48px and changes normal and archived rows together", () => {
    const rendered = render(table());
    expect(
      (rendered.container.querySelector('[data-record-id="record"]') as HTMLElement).style.height,
    ).toBe("48px");
    rendered.rerender(table("tall"));
    expect(
      (rendered.container.querySelector('[data-record-id="record"]') as HTMLElement).style.height,
    ).toBe("96px");
    fireEvent.click(screen.getByTestId("active-view-actions"));
    fireEvent.click(screen.getByRole("button", { name: "Show archived records (1)" }));
    expect(
      (rendered.container.querySelector('[data-record-id="archived"]') as HTMLElement).style.height,
    ).toBe("96px");
    expect(rendered.container.querySelector("[data-grid-cell-text]")?.textContent).toBe(
      "First line\nSecond line\nThird line",
    );
    expect(
      rendered.container
        .querySelector("[data-grid-cell-text]")
        ?.getAttribute("data-grid-text-lines"),
    ).toBe("4");
  });

  it("uses the selected density for loading rows", () => {
    const { container } = render(table("short", { loading: true }));
    const skeletonRows = container.querySelectorAll("[aria-hidden] > .grid");
    expect(skeletonRows.length).toBe(6);
    for (const row of skeletonRows) expect((row as HTMLElement).style.height).toBe("32px");
  });

  it("remeasures a full virtual page when row height changes", () => {
    const records = Array.from({ length: 100 }, (_, index) => ({
      ...record,
      id: `record-${index}`,
    }));
    const rendered = render(table("short", { records }));
    expect(
      (rendered.container.querySelector('[data-record-id="record-50"]') as HTMLElement).style
        .transform,
    ).toBe("translateY(1600px)");
    rendered.rerender(table("extra-tall", { records }));
    expect(
      (rendered.container.querySelector('[data-record-id="record-50"]') as HTMLElement).style
        .transform,
    ).toBe("translateY(7200px)");
    expect(measure).toHaveBeenCalled();
  });

  it("shows saved height to read-only viewers without offering the write control", () => {
    const { container } = render(table("tall", { level: "read" }));
    expect(screen.queryByTestId("row-height-control")).toBeNull();
    expect((container.querySelector('[data-record-id="record"]') as HTMLElement).style.height).toBe(
      "96px",
    );
    expect(container.querySelector('[data-cell-field="title"]')).not.toBeNull();
  });

  it("uses the pre-commit scroll position when shrinking the browser's scroll range", () => {
    const scrollElement = document.createElement("div");
    const records = Array.from({ length: 100 }, (_, index) => ({
      ...record,
      id: `record-${index}`,
    }));
    const rendered = render(table("extra-tall", { records, scrollElement }));
    const group = rendered.container.querySelector('[role="rowgroup"]') as HTMLElement;
    group.getBoundingClientRect = () => new DOMRect(0, -scrollElement.scrollTop, 500, 14400);
    scrollElement.scrollTop = 2500;
    fireEvent.scroll(scrollElement);
    // A browser can clamp this while committing a shorter spacer, before layout effects run.
    scrollElement.scrollTop = 800;
    rendered.rerender(table("short", { records, scrollElement }));
    expect(scrollElement.scrollTop).toBeCloseTo((2500 / 144) * 32);
  });
});
