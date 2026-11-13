/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickVisibleSpaces, SpaceSelector } from "./SpaceSelector";

afterEach(cleanup);

vi.mock("kui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("kui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("kui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({
    children,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false, state: "expanded" }),
}));

vi.mock("kui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../avatar-logo", () => ({
  AvatarLogo: ({ fallback, ...props }: HTMLAttributes<HTMLSpanElement> & { fallback: string }) => (
    <span {...props}>{fallback}</span>
  ),
}));

const props = {
  spaces: [{ id: "space-1", name: "Workspace", logo: "/logo.svg", plan: "free" }],
  activeSpace: { id: "space-1", name: "Workspace", logo: "/logo.svg", plan: "free" },
};

describe("SpaceSelector hydration", () => {
  it("keeps the trigger disabled until the client effect has run", async () => {
    const serverContainer = document.createElement("div");
    serverContainer.innerHTML = renderToString(<SpaceSelector {...props} />);

    expect(serverContainer.querySelector("button")?.hasAttribute("disabled")).toBe(true);

    render(<SpaceSelector {...props} />);

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Workspace/ }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });
});

const manySpaces = Array.from({ length: 9 }, (_, index) => ({
  id: `space-${index + 1}`,
  name: `Client ${index + 1}`,
  logo: "/logo.svg",
  plan: "pro",
}));

describe("pickVisibleSpaces", () => {
  it("keeps the host's order and lists everything when under the cap or uncapped", () => {
    expect(pickVisibleSpaces(manySpaces, "space-1")).toBe(manySpaces);
    expect(pickVisibleSpaces(manySpaces, "space-1", 9)).toBe(manySpaces);
    expect(pickVisibleSpaces(manySpaces, "space-2", 4).map((space) => space.id)).toEqual([
      "space-1",
      "space-2",
      "space-3",
      "space-4",
    ]);
  });

  it("swaps the active space in for the last row when it falls past the cap", () => {
    expect(pickVisibleSpaces(manySpaces, "space-8", 4).map((space) => space.id)).toEqual([
      "space-1",
      "space-2",
      "space-3",
      "space-8",
    ]);
  });
});

describe("SpaceSelector space cap", () => {
  const capped = {
    spaces: manySpaces,
    activeSpace: manySpaces[7],
    labels: { viewAllSpaces: "View all spaces" },
  };

  it("lists the capped spaces and a view-all row that states the full count", () => {
    render(<SpaceSelector {...capped} maxVisibleSpaces={4} onViewAllSpaces={() => undefined} />);

    expect(screen.getByText("View all spaces · 9")).toBeTruthy();
    expect(screen.queryByText("Client 4")).toBeNull();
    // The active space is cut by the cap but still listed, so its check mark has a row.
    expect(screen.getAllByText("Client 8").length).toBeGreaterThan(0);
  });

  it("lists every space without a way to reach the rest, as before", () => {
    render(<SpaceSelector {...capped} maxVisibleSpaces={4} />);

    expect(screen.queryByText(/View all spaces/)).toBeNull();
    expect(screen.getByText("Client 4")).toBeTruthy();
  });
});
