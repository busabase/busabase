/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceSelector } from "./SpaceSelector";

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
