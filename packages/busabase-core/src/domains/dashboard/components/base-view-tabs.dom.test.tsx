// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BaseVO, ViewVO } from "busabase-contract/types";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CoreI18nProvider } from "../../../i18n";

// The real SPALink only adds `?demo`/search handling on top of wouter's Link.
vi.mock("openlib/ui/dashboard", () => ({
  SPALink: (props: ComponentProps<typeof Link>) => <Link {...props} />,
}));

const { BaseViewTabs } = await import("./base-view-tabs");

const base = {
  id: "bse_tasks",
  nodeId: "nod_tasks",
  slug: "tasks",
  name: "Tasks",
  description: "",
  reviewPolicy: { kind: "single", requiredApprovals: 1 },
  createdAt: "2026-10-01T00:00:00.000Z",
  fields: [],
} satisfies BaseVO;

const view = (id: string, slug: string, name: string, position: number): ViewVO => ({
  id,
  baseId: base.id,
  slug,
  name,
  description: "",
  type: slug === "board" ? "kanban" : "table",
  config: { filters: [], sorts: [] },
  status: "active",
  position,
  createdBy: "usr_test",
  archivedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

const views = [
  view("viw_board", "board", "Board", 0),
  view("viw_grid", "grid-view", "Grid view", 1),
];

const renderTabs = (props: Partial<ComponentProps<typeof BaseViewTabs>> = {}) => {
  const location = memoryLocation({ path: "/base/tasks/board", record: true });
  const result = render(
    <CoreI18nProvider locale="en">
      <Router hook={location.hook}>
        <nav data-testid="tabs">
          <BaseViewTabs
            activeViewId="viw_board"
            base={base}
            canReorder={false}
            currentSearch=""
            onReorder={vi.fn()}
            views={views}
            {...props}
          />
        </nav>
      </Router>
    </CoreI18nProvider>,
  );
  return { ...result, location };
};

afterEach(() => cleanup());

describe("BaseViewTabs", () => {
  it("lists the saved views in order, with no pseudo All tab", () => {
    renderTabs();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Board", "Grid view"]);
    expect(screen.queryByRole("link", { name: "All" })).toBeNull();
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Grid view" }).getAttribute("href")).toBe(
      "/base/tasks/grid-view",
    );
  });

  it("offers no drag affordance to someone who cannot reorder", () => {
    renderTabs({ canReorder: false });
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("aria-roledescription")).toBeNull();
    }
  });

  it("keeps each sortable tab a plain link that still navigates on click", () => {
    const { location } = renderTabs({ canReorder: true });
    const tabs = screen.getByTestId("tabs");
    // The sortable node is the <a> itself — no wrapper changes the strip's shape.
    expect([...tabs.children].map((child) => child.tagName)).toEqual(["A", "A"]);
    const grid = screen.getByRole("link", { name: "Grid view" });
    expect(grid.getAttribute("aria-roledescription")).toBe("sortable");
    fireEvent.click(grid);
    expect(location.history?.at(-1)).toBe("/base/tasks/grid-view");
  });

  it("cancels the click a drop produces, so the browser does not follow the tab's href", async () => {
    const { location } = renderTabs({ canReorder: true });
    const grid = screen.getByRole("link", { name: "Grid view" });
    fireEvent.mouseDown(grid, { button: 0, clientX: 200, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 180, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 20, clientY: 10 });
    fireEvent.mouseUp(document, { clientX: 20, clientY: 10 });
    // A real browser dispatches the drop's click as its own task after mouseup
    // (~10ms in Chromium). dnd-kit stops its propagation, so React never sees
    // it; unless its default is cancelled the browser follows the href as a
    // full page load (jsdom has no default navigation, hence the explicit check).
    await new Promise((resolve) => setTimeout(resolve, 15));
    const followedHref = fireEvent.click(grid);
    expect(followedHref).toBe(false);
    expect(location.history?.at(-1)).toBe("/base/tasks/board");
    // Past dnd-kit's own post-drop window, a plain click opens the view again.
    await new Promise((resolve) => setTimeout(resolve, 80));
    fireEvent.click(grid);
    expect(location.history?.at(-1)).toBe("/base/tasks/grid-view");
  });

  it("does not offer reordering for a single view", () => {
    renderTabs({ canReorder: true, views: [views[0]] });
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("aria-roledescription")).toBe(
      null,
    );
  });
});
