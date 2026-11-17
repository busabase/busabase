// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { BusabaseTopbarBreadcrumb } from "./topbar";

afterEach(cleanup);

const longTrail = [
  { href: "/home", label: "Workspace" },
  { href: "/folder/projects", label: "Projects" },
  { href: "/folder/acme", label: "Acme" },
  { href: "/base/personal-tasks", isNode: true, label: "Tasks" },
  { label: "Board" },
];

describe("BusabaseTopbarBreadcrumb folder path", () => {
  it("opens the collapsed folders from the narrow-header menu", async () => {
    render(
      <Router>
        <BusabaseTopbarBreadcrumb items={longTrail} />
      </Router>,
    );

    expect(screen.getByRole("link", { name: "Workspace" }).getAttribute("href")).toBe("/home");
    expect(screen.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe(
      "/base/personal-tasks",
    );
    expect(screen.getByText("Board").getAttribute("title")).toBe("Board");

    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    const projects = await screen.findByRole("menuitem", { name: "Projects" });
    const acme = screen.getByRole("menuitem", { name: "Acme" });
    expect(projects.getAttribute("href")).toBe("/folder/projects");
    expect(acme.getAttribute("href")).toBe("/folder/acme");
  });

  it("shows a short folder path inline, with no overflow menu", () => {
    render(
      <Router>
        <BusabaseTopbarBreadcrumb
          items={[
            { href: "/home", label: "Workspace" },
            { href: "/folder/projects", label: "Projects" },
            { isNode: true, label: "Tasks" },
          ]}
        />
      </Router>,
    );

    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe(
      "/folder/projects",
    );
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
    expect(screen.getByText("Tasks").getAttribute("title")).toBe("Tasks");
  });
});
