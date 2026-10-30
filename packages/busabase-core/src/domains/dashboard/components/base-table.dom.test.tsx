// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { EMPTY_WHITEBOARD_FIELD_VALUE } from "../../base/utils/whiteboard-value";

const routeSearch = vi.hoisted(() => ({ value: "space=connected" }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useSearch: () => routeSearch.value,
  useLocation: () => ["/base/tasks/grid-view", navigate],
}));
vi.mock("openlib/ui/dashboard", () => ({
  useAddDemoParam: () => (href: string) => href,
  SPALink: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
// jsdom has no layout. Keep the real virtual-row branch but provide its first
// visible item; browser acceptance covers the actual scrolling behavior.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ scrollMargin }: { scrollMargin: number }) => ({
    getTotalSize: () => 4848,
    getVirtualItems: () => [{ index: 0, start: scrollMargin }],
    options: { scrollMargin },
  }),
}));

const { BusaBaseTable } = await import("./base-table");
const { BaseDetailView } = await import("./base-views");
const field = (slug: string, type: BaseFieldVO["type"] = "text"): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_table",
  slug,
  name: slug,
  type,
  required: false,
  position: 0,
  options: {},
});
const base: BaseVO = {
  id: "bas_table",
  nodeId: "nod_table",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-26T00:00:00Z",
  fields: [field("title")],
};
const record: RecordVO = {
  id: "rec_task",
  baseId: base.id,
  headCommitId: "cmt_task",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-26T00:00:00Z",
  updatedAt: "2026-10-26T00:00:00Z",
  base,
  headCommit: {
    id: "cmt_task",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "Read the task" },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-26T00:00:00Z",
  },
};

function renderTable(props: Partial<ComponentProps<typeof BusaBaseTable>> = {}) {
  return render(
    <CoreI18nProvider locale="en">
      <BusaBaseTable
        activeView={null}
        base={base}
        client={{} as BusabaseDashboardApiClient}
        onCreateView={vi.fn()}
        onDeleteView={vi.fn()}
        onUpdateView={vi.fn()}
        records={[record]}
        scrollElementRef={{ current: null }}
        views={[]}
        {...props}
      />
    </CoreI18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  routeSearch.value = "space=connected";
  vi.restoreAllMocks();
  vi.useRealTimers();
  navigate.mockReset();
});

describe("table record previews", () => {
  it("offers an opt-in Kanban cover and saves only the chosen cover settings", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    const onUpdateView = vi.fn().mockResolvedValue(undefined);
    const view: ViewVO = {
      id: "viw_board",
      baseId: base.id,
      name: "Board",
      slug: "board",
      type: "kanban",
      config: { filters: [], sorts: [] },
      description: "",
      status: "active",
      position: 0,
      createdBy: "usr_test",
      archivedAt: null,
      createdAt: "2026-10-27T00:00:00Z",
      updatedAt: "2026-10-27T00:00:00Z",
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CoreI18nProvider locale="en">
          <BusaBaseTable
            base={{ ...base, fields: [...base.fields, field("files", "attachment")] }}
            client={{} as BusabaseDashboardApiClient}
            onCreateView={vi.fn()}
            onDeleteView={vi.fn()}
            onUpdateView={onUpdateView}
            records={[record]}
            scrollElementRef={{ current: null }}
            activeView={view}
            views={[view]}
          />
        </CoreI18nProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId("active-view-actions"));
    fireEvent.click(screen.getByRole("button", { name: "Edit view" }));
    expect(
      (screen.getByRole("combobox", { name: "Cover image field" }) as HTMLSelectElement).value,
    ).toBe("__none__");
    expect(screen.queryByRole("combobox", { name: "Card size" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Cover image field" }), {
      target: { value: "files" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Image fit" }), {
      target: { value: "fit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update View Now" }));
    await act(async () => {});
    expect(onUpdateView).toHaveBeenCalledWith(
      view,
      { config: { coverFieldSlug: "files", coverFit: "fit" } },
      { mergeImmediately: true },
    );
  });

  it("submits only the renamed view after live props gain a new field during editing", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    const onUpdateView = vi.fn().mockResolvedValue(undefined);
    const view: ViewVO = {
      id: "viw_edit",
      baseId: base.id,
      name: "Grid",
      slug: "grid-view",
      type: "table",
      config: { filters: [], sorts: [], visibleFieldSlugs: ["title"] },
      description: "",
      status: "active",
      position: 0,
      createdBy: "usr_test",
      archivedAt: null,
      createdAt: "2026-10-27T00:00:00Z",
      updatedAt: "2026-10-27T00:00:00Z",
    };
    const props = { activeView: view, views: [view], onUpdateView };
    const result = renderTable(props);
    fireEvent.click(screen.getByTestId("active-view-actions"));
    fireEvent.click(screen.getByRole("button", { name: "Edit view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Renamed" },
    });
    const nextView = {
      ...view,
      config: { ...view.config, visibleFieldSlugs: ["title", "attachment"] },
    };
    result.rerender(
      <CoreI18nProvider locale="en">
        <BusaBaseTable
          base={{
            ...base,
            fields: [...base.fields, { ...field("attachment", "attachment"), position: 1 }],
          }}
          client={{} as BusabaseDashboardApiClient}
          onCreateView={vi.fn()}
          onDeleteView={vi.fn()}
          onUpdateView={onUpdateView}
          records={[record]}
          scrollElementRef={{ current: null }}
          activeView={nextView}
          views={[nextView]}
        />
      </CoreI18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Update View Now" }));
    await act(async () => {});
    expect(onUpdateView).toHaveBeenCalledWith(
      nextView,
      { name: "Renamed" },
      { mergeImmediately: true },
    );
  });

  it("consumes a new-field locator in a card view without trying to focus a table column", () => {
    routeSearch.value = "space=connected&highlightField=title";
    const { container } = renderTable({
      activeView: {
        id: "viw_gallery",
        baseId: base.id,
        name: "Gallery",
        slug: "gallery",
        type: "gallery",
        config: { filters: [], sorts: [] },
        description: "",
        status: "active",
        position: 0,
        createdBy: "usr_test",
        archivedAt: null,
        createdAt: "2026-10-27T00:00:00Z",
        updatedAt: "2026-10-27T00:00:00Z",
      },
    });
    expect(container.querySelector("[data-new-field]")).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/base/tasks/grid-view?space=connected", {
      replace: true,
    });
  });

  it("locates and focuses the new column when returning from Design", () => {
    vi.useFakeTimers();
    routeSearch.value = "space=connected&highlightField=title";
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
      writable: true,
    });
    const { container } = renderTable();
    act(() => vi.advanceTimersByTime(20));
    const header = container.querySelector('[data-field-slug="title"]');
    expect(header?.getAttribute("data-new-field")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ inline: "center", block: "nearest" }),
    );
    expect(document.activeElement).toBe(header);
    act(() => vi.advanceTimersByTime(3500));
    expect(header?.hasAttribute("data-new-field")).toBe(false);
    expect(navigate).toHaveBeenCalledWith("/base/tasks/grid-view?space=connected", {
      replace: true,
    });
  });

  it("reveals a new field after loading and after the saved horizontal position is restored", () => {
    vi.useFakeTimers();
    routeSearch.value = "space=connected&highlightField=title";
    const viewState = {
      scope: "bas_table:all",
      selectedRecordIds: [],
      scrollTop: 0,
      scrollLeft: 90,
    };
    const pagination = {
      page: 1,
      pageSize: 25 as const,
      total: 1,
      totalPages: 1,
      isLoading: true,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
    };
    const observedPositions: number[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        if (!this.hasAttribute("data-field-slug")) return;
        const scroll = this.closest<HTMLElement>("[data-base-table-scroll]");
        observedPositions.push(scroll?.scrollLeft ?? -1);
      },
      writable: true,
    });
    const element = (isLoading: boolean) => (
      <CoreI18nProvider locale="en">
        <BusaBaseTable
          activeView={null}
          base={base}
          client={{} as BusabaseDashboardApiClient}
          onCreateView={vi.fn()}
          onDeleteView={vi.fn()}
          onUpdateView={vi.fn()}
          pagination={{ ...pagination, isLoading }}
          records={[record]}
          scrollElementRef={{ current: null }}
          views={[]}
          viewState={viewState}
        />
      </CoreI18nProvider>
    );
    const result = render(element(true));
    act(() => vi.advanceTimersByTime(20));
    expect(observedPositions).toEqual([]);
    result.rerender(element(false));
    act(() => vi.advanceTimersByTime(20));
    expect(observedPositions).toEqual([90]);
    expect(result.container.querySelector('[data-new-field="true"]')).not.toBeNull();
  });

  it("opens the existing record link without navigating, including keyboard-generated clicks", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord });
    const link = screen.getByRole("link", { name: "Read the task" });
    expect(link.getAttribute("href")).toBe("/base/tasks/rec_task?space=connected");
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.click(link, { detail: 0 })).toBe(false);
    expect(onOpenRecord.mock.calls).toEqual([[record], [record]]);
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("preserves native link activation for %j", (modifiers) => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord });
    expect(fireEvent.click(screen.getByRole("link", { name: "Read the task" }), modifiers)).toBe(
      true,
    );
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it("keeps ordinary navigation when no preview callback is supplied", () => {
    renderTable();
    expect(fireEvent.click(screen.getByRole("link", { name: "Read the task" }))).toBe(true);
  });

  it("does not override an already handled event or an explicit new-tab target", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord });
    const link = screen.getByRole("link", { name: "Read the task" });
    const handled = new MouseEvent("click", { bubbles: true, cancelable: true });
    handled.preventDefault();
    fireEvent(link, handled);
    link.setAttribute("target", "_blank");
    expect(fireEvent.click(link)).toBe(true);
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it("opens every own-record field preview through the same callback", () => {
    const values: Array<[BaseFieldVO["type"], unknown]> = [
      ["text", "Task"],
      ["formula", 42],
      ["checkbox", true],
      ["member", []],
      ["select", "Ready"],
      ["whiteboard", { ...EMPTY_WHITEBOARD_FIELD_VALUE, previewSvg: "<svg></svg>" }],
      ["url", ""],
      ["markdown", "## Notes"],
      ["code", "console.log(1)"],
      ["json", "{}"],
      ["yaml", "ready: true"],
      ["embed", "https://example.com/video"],
      ["date", "2026-10-26"],
    ];
    const fields = values.map(([type], index) => field(`value_${index}`, type));
    const richBase = { ...base, fields };
    const richRecord = {
      ...record,
      base: richBase,
      headCommit: {
        ...record.headCommit,
        payload: Object.fromEntries(values.map(([, value], index) => [`value_${index}`, value])),
      },
    };
    const onOpenRecord = vi.fn();
    const { container } = renderTable({ base: richBase, records: [richRecord], onOpenRecord });
    const row = container.querySelector('[data-record-id="rec_task"]');
    expect(row).not.toBeNull();
    const links = within(row as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(values.length);
    for (const link of links) expect(fireEvent.click(link)).toBe(false);
    expect(onOpenRecord).toHaveBeenCalledTimes(values.length);
    expect(onOpenRecord).toHaveBeenLastCalledWith(richRecord);
  });

  it("keeps row selection and external, relation and attachment targets independent", () => {
    const fields = [
      field("title"),
      field("website", "url"),
      field("related", "relation"),
      field("files", "attachment"),
    ];
    const related = { ...record, id: "rec_related", base: { ...base, slug: "customers" } };
    const richRecord = {
      ...record,
      headCommit: {
        ...record.headCommit,
        payload: {
          ...record.headCommit.payload,
          website: "https://example.com",
          related: [related.id],
          files: [
            {
              id: "att_file",
              fileName: "brief.pdf",
              url: "https://example.com/brief.pdf",
              mimeType: "application/pdf",
              size: 10,
            },
          ],
        },
      },
    };
    const onOpenRecord = vi.fn();
    const { container } = renderTable({
      base: { ...base, fields },
      records: [richRecord],
      relationRecords: [richRecord, related],
      onDeleteRecords: vi.fn(),
      onOpenRecord,
    });
    fireEvent.click(screen.getByTestId("base-record-select"));
    expect((screen.getByTestId("base-record-select") as HTMLInputElement).checked).toBe(true);
    const row = container.querySelector('[data-record-id="rec_task"]') as HTMLElement;
    const website = within(row).getByRole("link", { name: "https://example.com" });
    expect(website.getAttribute("href")).toBe("https://example.com");
    expect(fireEvent.click(website)).toBe(true);
    const relation = row.querySelector('a[href^="/base/customers/rec_related"]');
    expect(relation).not.toBeNull();
    expect(fireEvent.click(relation as HTMLAnchorElement)).toBe(true);
    fireEvent.click(within(row).getByText("brief.pdf"));
    expect(onOpenRecord).not.toHaveBeenCalled();
  });

  it("retains both saved scroll axes when source layout collapses during page teardown", () => {
    const viewState = {
      scope: "space:owner:tasks:grid:page2",
      selectedRecordIds: [] as string[],
      scrollTop: 0,
      scrollLeft: 0,
    };
    const detail = () =>
      render(
        <CoreI18nProvider locale="en">
          <BaseDetailView
            activeView={null}
            base={base}
            client={{} as BusabaseDashboardApiClient}
            orpc={{} as BusabaseQueryUtils}
            onCreateView={vi.fn()}
            onDeleteView={vi.fn()}
            onUpdateView={vi.fn()}
            records={[record]}
            views={[]}
            viewState={viewState}
          />
        </CoreI18nProvider>,
      );
    const first = detail();
    const original = first.container.querySelector("[data-base-detail-scroll]") as HTMLElement;
    const horizontal = first.container.querySelector("[data-base-table-scroll]") as HTMLElement;
    original.scrollTop = 350;
    horizontal.scrollLeft = 90;
    fireEvent.scroll(original);
    fireEvent.scroll(horizontal);
    expect(viewState).toMatchObject({ scrollTop: 350, scrollLeft: 90 });
    // Browsers clamp scroll offsets when React removes the table's children.
    // Cleanup must retain the last real scroll event, not persist this zero.
    Object.defineProperty(original, "scrollTop", { configurable: true, get: () => 0 });
    Object.defineProperty(horizontal, "scrollLeft", { configurable: true, get: () => 0 });
    first.unmount();
    expect(viewState).toMatchObject({ scrollTop: 350, scrollLeft: 90 });
    const returned = detail();
    const restored = returned.container.querySelector("[data-base-detail-scroll]") as HTMLElement;
    expect(restored.scrollTop).toBe(350);
    expect(
      (returned.container.querySelector("[data-base-table-scroll]") as HTMLElement).scrollLeft,
    ).toBe(90);
  });

  it("replays saved offsets after native Back scroll restoration without fighting later user scrolling", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const viewState = {
      scope: "space:owner:tasks:grid:page2",
      selectedRecordIds: [] as string[],
      scrollTop: 350,
      scrollLeft: 90,
    };
    try {
      const detail = render(
        <CoreI18nProvider locale="en">
          <BaseDetailView
            activeView={null}
            base={base}
            client={{} as BusabaseDashboardApiClient}
            orpc={{} as BusabaseQueryUtils}
            onCreateView={vi.fn()}
            onDeleteView={vi.fn()}
            onUpdateView={vi.fn()}
            records={[record]}
            views={[]}
            viewState={viewState}
          />
        </CoreI18nProvider>,
      );
      const vertical = detail.container.querySelector("[data-base-detail-scroll]") as HTMLElement;
      const horizontal = detail.container.querySelector("[data-base-table-scroll]") as HTMLElement;
      expect(vertical.scrollTop).toBe(350);
      expect(horizontal.scrollLeft).toBe(90);
      // Browser history restores persisted DOM scroll after React's layout
      // effects; this is the real browser failure static jsdom layout missed.
      vertical.scrollTop = 0;
      horizontal.scrollLeft = 0;
      fireEvent.scroll(vertical);
      fireEvent.scroll(horizontal);
      expect(viewState).toMatchObject({ scrollTop: 350, scrollLeft: 90 });
      act(() => {
        for (const callback of frames.splice(0)) callback(performance.now());
      });
      expect(vertical.scrollTop).toBe(350);
      expect(horizontal.scrollLeft).toBe(90);
      // Once navigation settles, scrolling to the top/left is intentional.
      vertical.scrollTop = 0;
      horizontal.scrollLeft = 0;
      fireEvent.scroll(vertical);
      fireEvent.scroll(horizontal);
      expect(viewState).toMatchObject({ scrollTop: 0, scrollLeft: 0 });
      detail.unmount();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it("restores selection after a record-page remount and drops deleted records", () => {
    const viewState = {
      scope: "space:owner:tasks:grid:page2",
      selectedRecordIds: [] as string[],
      scrollTop: 350,
      scrollLeft: 90,
    };
    const props = { viewState, onDeleteRecords: vi.fn() };
    const first = renderTable(props);
    fireEvent.click(screen.getByTestId("base-record-select"));
    expect(viewState.selectedRecordIds).toEqual([record.id]);
    first.unmount();
    // A deleted/moved record from the old page must not become selected again.
    viewState.selectedRecordIds.push("rec_deleted");
    const returned = renderTable(props);
    expect((screen.getByTestId("base-record-select") as HTMLInputElement).checked).toBe(true);
    expect(viewState.selectedRecordIds).toEqual([record.id]);
    returned.unmount();
    const empty = renderTable({ ...props, records: [] });
    expect(viewState.selectedRecordIds).toEqual([]);
    empty.unmount();
    renderTable(props);
    expect((screen.getByTestId("base-record-select") as HTMLInputElement).checked).toBe(false);
  });

  it("does not prune saved selection against a temporary loading skeleton", () => {
    const viewState = {
      scope: "space:owner:tasks:grid:page2",
      selectedRecordIds: [record.id],
      scrollTop: 350,
      scrollLeft: 90,
    };
    const pending = renderTable({
      viewState,
      records: [],
      pagination: {
        page: 2,
        pageSize: 25,
        total: 50,
        totalPages: 2,
        isLoading: true,
        onPageChange: vi.fn(),
        onPageSizeChange: vi.fn(),
      },
    });
    expect(viewState.selectedRecordIds).toEqual([record.id]);
    pending.unmount();
    renderTable({ viewState, onDeleteRecords: vi.fn() });
    expect((screen.getByTestId("base-record-select") as HTMLInputElement).checked).toBe(true);
  });

  it("passes the preview callback into virtualized and archived rows", () => {
    const onOpenRecord = vi.fn();
    const archived = {
      ...record,
      id: "rec_archived",
      status: "archived" as const,
      archivedAt: "2026-10-26T00:00:00Z",
      headCommit: { ...record.headCommit, payload: { title: "Archived task" } },
    };
    renderTable({
      records: Array.from({ length: 101 }, (_, index) => ({ ...record, id: `rec_${index}` })),
      archivedRecords: [archived],
      onOpenRecord,
    });
    fireEvent.click(screen.getByRole("link", { name: "Read the task" }));
    expect(onOpenRecord).toHaveBeenLastCalledWith(expect.objectContaining({ id: "rec_0" }));
    fireEvent.click(screen.getByTestId("archived-records-menu-item"));
    fireEvent.click(screen.getByRole("link", { name: "Archived task" }));
    expect(onOpenRecord).toHaveBeenLastCalledWith(archived);
  });
});
