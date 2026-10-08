// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, Router, useLocation } from "wouter";
import { useDemoPreservingLocation } from "./demo-client";
import { SPABreadcrumb } from "./SPABreadcrumb";

vi.mock("kui/breadcrumb", () => ({
  Breadcrumb: ({ children }: { children: ReactNode }) => <nav>{children}</nav>,
  BreadcrumbList: ({ children }: { children: ReactNode }) => <ol>{children}</ol>,
  BreadcrumbItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
  BreadcrumbLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  BreadcrumbPage: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  BreadcrumbSeparator: () => <li>/</li>,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function NavigateButton({ to }: { to: string }) {
  const [, navigate] = useLocation();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

function renderDashboard() {
  return render(
    <Router base="/dashboard" hook={useDemoPreservingLocation}>
      <Link href="/sandboxes/sbx_1">link</Link>
      <NavigateButton to="/tasks/tsk_1" />
    </Router>,
  );
}

describe("useDemoPreservingLocation", () => {
  it("keeps the demo params on a <Link> click inside a demo", () => {
    window.history.replaceState(null, "", "/dashboard?demo=1&lang=zh-CN");
    renderDashboard();
    fireEvent.click(screen.getByText("link"));
    expect(window.location.pathname).toBe("/dashboard/sandboxes/sbx_1");
    expect(window.location.search).toBe("?demo=1&lang=zh-CN");
  });

  it("keeps a named demo use case on a programmatic navigate()", () => {
    window.history.replaceState(null, "", "/dashboard?demo=blog");
    renderDashboard();
    fireEvent.click(screen.getByText("go"));
    expect(window.location.pathname).toBe("/dashboard/tasks/tsk_1");
    expect(window.location.search).toBe("?demo=blog");
  });

  it("does not touch navigation outside demo mode", () => {
    window.history.replaceState(null, "", "/dashboard?space=abc");
    renderDashboard();
    fireEvent.click(screen.getByText("go"));
    expect(window.location.pathname).toBe("/dashboard/tasks/tsk_1");
    expect(window.location.search).toBe("");
  });

  it("does not add a second demo param when the target already has one", () => {
    window.history.replaceState(null, "", "/dashboard?demo=1");
    render(
      <Router base="/dashboard" hook={useDemoPreservingLocation}>
        <NavigateButton to="/tasks/tsk_1?demo=blog" />
      </Router>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(window.location.search).toBe("?demo=blog");
  });
});

describe("SPABreadcrumb", () => {
  const breadcrumb = { parent: null, title: "Analytics" } as never;

  it("carries the demo param on its full-page crumb links", async () => {
    window.history.replaceState(null, "", "/dashboard/analytics?demo=1");
    await act(async () => {
      render(<SPABreadcrumb rootHref="/dashboard" rootLabel="Dashboard" breadcrumb={breadcrumb} />);
    });
    expect(screen.getByText("Dashboard").getAttribute("href")).toBe("/dashboard?demo=1");
  });

  it("leaves crumb links alone outside demo mode", async () => {
    window.history.replaceState(null, "", "/dashboard/analytics");
    await act(async () => {
      render(<SPABreadcrumb rootHref="/dashboard" rootLabel="Dashboard" breadcrumb={breadcrumb} />);
    });
    expect(screen.getByText("Dashboard").getAttribute("href")).toBe("/dashboard");
  });
});
