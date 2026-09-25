// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarTaskList } from "./SidebarTaskList";

vi.mock("wouter", () => ({ useLocation: () => ["/"] }));
vi.mock("kui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuAction: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

const LinkComponent = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href}>{children}</a>
);

describe("SidebarTaskList ACP source", () => {
  it.each(["dashboard", "agent-manager"] as const)(
    "keeps ACP and normal task titles aligned in the %s variant",
    (variant) => {
      render(
        <SidebarTaskList
          tasks={[
            {
              id: "new",
              title: "New ACP session",
              url: "/new",
              source: "acp",
              spaceName: "Workspace",
            },
            {
              id: "normal",
              title: "Normal session",
              url: "/normal",
              source: null,
              spaceName: "Workspace",
            },
          ]}
          LinkComponent={LinkComponent}
          variant={variant}
          defaultVisibleCount={10}
        />,
      );

      for (const titleText of ["New ACP session", "Normal session"]) {
        const title = screen.getByText(titleText);
        expect(title.parentElement?.firstElementChild).toBe(title);
      }
    },
  );

  it("renders accessible ACP metadata only from structured source data", () => {
    render(
      <SidebarTaskList
        tasks={[
          { id: "new", title: "New ACP session", url: "/new", source: "acp" },
          { id: "legacy", title: "acp: Historical session", url: "/legacy", source: null },
        ]}
        LinkComponent={LinkComponent}
        variant="dashboard"
        defaultVisibleCount={10}
      />,
    );

    expect(screen.getAllByRole("img", { name: "ACP" })).toHaveLength(1);
    expect(screen.getByText("New ACP session")).toBeTruthy();
    expect(screen.getByText("acp: Historical session")).toBeTruthy();
  });

  it.each(["completed", "in_progress"] as const)(
    "preserves the %s status indicator for ACP tasks",
    (status) => {
      const { container } = render(
        <SidebarTaskList
          tasks={[
            { id: status, title: `${status} task`, url: `/${status}`, source: "acp", status },
          ]}
          LinkComponent={LinkComponent}
          variant="dashboard"
          defaultVisibleCount={10}
        />,
      );

      expect(screen.getByRole("img", { name: "ACP" })).toBeTruthy();
      const statusIcon = container.querySelector(".pt-0\\.5 > svg");
      expect(statusIcon).not.toBeNull();
      expect(
        statusIcon?.classList.contains(status === "completed" ? "text-success" : "text-info"),
      ).toBe(true);
    },
  );
});
