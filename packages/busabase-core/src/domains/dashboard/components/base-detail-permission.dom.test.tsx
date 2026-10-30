// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";
import { SubmitPermissionProvider } from "./split-submit-button";

// The Base page's write affordances follow the viewer's NODE level on the Base
// (`bases.get` → `viewerPermissionLevel`), not just "anonymous or not". The
// header's topbar cluster is unrelated to this suite.
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

const titleField: BaseFieldVO = {
  id: "fld_title",
  baseId: "bas_tasks",
  slug: "title",
  name: "Title",
  type: "text",
  required: true,
  position: 0,
  options: {},
};
const makeBase = (viewerPermissionLevel?: ApiKeyPermissionLevel): BaseVO => ({
  id: "bas_tasks",
  nodeId: "nod_tasks",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-01T00:00:00Z",
  fields: [titleField],
  ...(viewerPermissionLevel ? { viewerPermissionLevel } : {}),
});
const view = (id: string, position: number): ViewVO => ({
  id,
  baseId: "bas_tasks",
  slug: id,
  name: id,
  description: "",
  type: "table",
  config: { filters: [], sorts: [] },
  status: "active",
  position,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
const views = [view("grid", 0), view("other", 1)];
const record = (base: BaseVO): RecordVO => ({
  id: "rec_one",
  baseId: base.id,
  headCommitId: "cmt_one",
  parentRecordId: null,
  parentCommitId: null,
  status: "active",
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  base,
  headCommit: {
    id: "cmt_one",
    baseId: base.id,
    targetType: "base",
    nodeId: null,
    operationId: null,
    parentCommitId: null,
    payload: { title: "Launch" },
    operation: "record_create",
    message: "",
    author: "usr_test",
    createdAt: "2026-10-01T00:00:00Z",
  },
});

const renderDetail = (options: {
  viewerPermissionLevel?: ApiKeyPermissionLevel;
  workspaceLevel?: ApiKeyPermissionLevel;
}) => {
  const base = makeBase(options.viewerPermissionLevel);
  const location = memoryLocation({ path: "/base/tasks/grid" });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) =>
    options.workspaceLevel ? (
      <SubmitPermissionProvider permissionLevel={options.workspaceLevel}>
        {children}
      </SubmitPermissionProvider>
    ) : (
      children
    );
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreI18nProvider locale="en">
        <Router hook={location.hook}>
          {wrap(
            <BaseDetailView
              activeView={views[0]}
              base={base}
              client={{} as BusabaseDashboardApiClient}
              onCreateView={vi.fn()}
              onDeleteRecords={vi.fn(async () => ({ ok: 0, failed: 0 }))}
              onDeleteView={vi.fn()}
              onImportRecords={vi.fn()}
              onReorderView={vi.fn()}
              onUpdateView={vi.fn()}
              orpc={{} as BusabaseQueryUtils}
              records={[record(base)]}
              views={views}
            />,
          )}
        </Router>
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
};

const newRecordLink = () => screen.queryByRole("link", { name: "New record" });
const sortableTabs = () =>
  screen.getAllByRole("link").filter((link) => link.getAttribute("aria-roledescription") !== null);

afterEach(() => cleanup());

describe("Base page affordances follow the viewer's node level", () => {
  it("hides every write affordance from a read grant, even inside a manage workspace", () => {
    renderDetail({ viewerPermissionLevel: "read", workspaceLevel: "manage" });
    expect(screen.getByText("Launch")).toBeTruthy();
    expect(newRecordLink()).toBeNull();
    expect(screen.queryByTestId("import-records")).toBeNull();
    expect(screen.queryByTestId("base-new-view-button")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // Edit/Delete view are the menu's only items here, so the menu goes too.
    expect(screen.queryByTestId("active-view-actions")).toBeNull();
    expect(sortableTabs()).toHaveLength(0);
  });

  it("lets a changeRequest grant propose, but not reorder the shared view tabs", () => {
    renderDetail({ viewerPermissionLevel: "changeRequest" });
    expect(newRecordLink()).toBeTruthy();
    expect(screen.getByTestId("import-records")).toBeTruthy();
    expect(screen.getByTestId("base-new-view-button")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.getByTestId("delete-view-menu-item")).toBeTruthy();
    expect(sortableTabs()).toHaveLength(0);
  });

  it("lets a write grant reorder view tabs", () => {
    renderDetail({ viewerPermissionLevel: "write", workspaceLevel: "read" });
    expect(newRecordLink()).toBeTruthy();
    expect(sortableTabs().length).toBeGreaterThan(0);
  });

  it("falls back to the workspace level when the Base carries no viewer level", () => {
    renderDetail({ workspaceLevel: "read" });
    expect(newRecordLink()).toBeNull();
    cleanup();
    renderDetail({});
    expect(newRecordLink()).toBeTruthy();
    expect(sortableTabs().length).toBeGreaterThan(0);
  });
});
