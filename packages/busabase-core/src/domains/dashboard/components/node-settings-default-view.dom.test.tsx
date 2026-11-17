// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { CoreI18nProvider } from "../../../i18n";
import { NodeSettingsDialog } from "./node-settings-dialog";

const detail: NodeDetailVO = {
  type: "base",
  node: {
    id: "nod_tasks",
    parentId: null,
    type: "base",
    slug: "tasks",
    name: "Tasks",
    description: "Work",
    metadata: {},
    settings: { defaultViewSlug: "board" },
    explicitVisibility: null,
    icon: null,
    position: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    baseId: "bas_tasks",
    children: [],
  },
};

const views = [
  {
    id: "viw_grid",
    baseId: "bas_tasks",
    slug: "grid-view",
    name: "Grid view",
    description: "",
    type: "table",
    config: { filters: [], sorts: [] },
    status: "active",
    position: 0,
    createdBy: "usr_test",
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  {
    id: "viw_board",
    baseId: "bas_tasks",
    slug: "board",
    name: "Board",
    description: "",
    type: "kanban",
    config: { filters: [], sorts: [] },
    status: "active",
    position: 1,
    createdBy: "usr_test",
    archivedAt: null,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  },
];

afterEach(cleanup);

beforeEach(() => {
  // Radix Select calls these on pointerdown. jsdom does not implement them.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe("node settings default view", () => {
  it("shows the saved view and saves a new choice without dropping other settings", async () => {
    const updateSettings = vi
      .fn()
      .mockResolvedValue({ settings: { defaultViewSlug: "grid-view" } });
    const createChangeRequest = vi.fn().mockResolvedValue({ status: "merged" });
    const orpc = {
      nodes: {
        get: {
          queryOptions: () => ({
            queryKey: ["nodes", "get", "tasks"],
            queryFn: async () => detail,
          }),
        },
        updateSettings: { mutationOptions: () => ({ mutationFn: updateSettings }) },
        createChangeRequest: { mutationOptions: () => ({ mutationFn: createChangeRequest }) },
        icon: {
          createUploadUrl: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
          confirm: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
        },
      },
      bases: {
        listViews: {
          queryOptions: () => ({
            queryKey: ["bases", "views", "tasks"],
            queryFn: async () => views,
          }),
        },
      },
    } as unknown as BusabaseQueryUtils;

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <CoreI18nProvider locale="en">
          <Router>
            <NodeSettingsDialog
              nodeId="nod_tasks"
              nodeName="Tasks"
              nodeSlug="tasks"
              nodeType="base"
              onOpenChange={() => undefined}
              open
              orpc={orpc}
            />
          </Router>
        </CoreI18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByRole("combobox").textContent).toContain("Board"));
    fireEvent.pointerDown(screen.getByRole("combobox"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("option", { name: "Grid view" }));
    expect(screen.getByRole("combobox").textContent).toContain("Grid view");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledOnce());
    expect(updateSettings.mock.calls[0]?.[0]).toEqual({
      nodeId: "nod_tasks",
      settings: { airappEngine: null, defaultViewSlug: "grid-view" },
    });
  });
});
