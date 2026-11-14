// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import type { RecordsPagination } from "../helpers/view-types";

// Only Table and Gallery page through the Base's record list. Kanban columns
// and the Calendar month fetch their own slices, and Gantt draws every record,
// so a pager under them would turn pages nobody can see.
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: (props: ComponentProps<typeof Link>) => <Link {...props} />,
}));
vi.mock("./node-actions-menu", () => ({ NodeActionsMenu: () => null }));
vi.mock("./node-agent-prompts-button", () => ({ NodeAgentPromptsButton: () => null }));
vi.mock("./node-pin-button", () => ({
  NodePinButton: () => null,
  nodeSidePanelTabId: () => "tab",
}));
vi.mock("../hooks/use-register-topbar-node-actions", () => ({
  useRegisterTopbarNodeActions: () => {},
}));
vi.mock("../hooks/use-register-topbar-node-info", () => ({
  useRegisterTopbarNodeInfo: () => {},
}));
// jsdom has no layout; the table scrolls the active tab into view on mount.
Element.prototype.scrollIntoView = () => {};
const { BaseDetailView } = await import("./base-views");

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
  config: { filters: [], sorts: [] },
  status: "active",
  position: 0,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const pagination: RecordsPagination = {
  page: 1,
  pageSize: 25,
  total: 125,
  totalPages: 5,
  isLoading: false,
  isFetching: false,
  error: null,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
};
const client = {
  listRecordsPage: vi.fn(async () => ({ records: [], page: 1, total: 0, totalPages: 1 })),
  groupRecords: vi.fn(async () => ({ groups: [] })),
} as unknown as BusabaseDashboardApiClient;

const renderView = (activeView: ViewVO | null) => {
  const location = memoryLocation({ path: `/base/tasks/${activeView?.slug ?? ""}` });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="en">
        <Router hook={location.hook}>
          <BaseDetailView
            activeView={activeView}
            base={base}
            client={client}
            onCreateView={vi.fn()}
            onDeleteRecords={vi.fn(async () => ({ ok: 0, failed: 0 }))}
            onDeleteView={vi.fn()}
            onImportRecords={vi.fn()}
            onReorderView={vi.fn()}
            onUpdateView={vi.fn()}
            orpc={{} as BusabaseQueryUtils}
            pagination={pagination}
            records={[]}
            views={activeView ? [activeView] : []}
          />
        </Router>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("Base view pagination", () => {
  it.each([
    ["the default grid", null],
    ["a table view", view("table")],
    ["a gallery view", view("gallery")],
  ])("docks the pager below the scroll area in %s", (_label, activeView) => {
    const { container } = renderView(activeView);
    const pager = screen.getAllByRole("navigation", { name: "Record pages" });
    expect(pager).toHaveLength(1);
    const scrollArea = container.querySelector("[data-base-detail-scroll]");
    expect(scrollArea?.contains(pager[0])).toBe(false);
  });

  it.each([
    ["kanban", view("kanban")],
    ["calendar", view("calendar")],
    ["gantt", view("gantt")],
  ])("shows no pager in a %s view", (_label, activeView) => {
    renderView(activeView);
    expect(screen.queryByRole("navigation", { name: "Record pages" })).toBeNull();
  });
});
