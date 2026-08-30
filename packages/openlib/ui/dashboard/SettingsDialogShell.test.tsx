/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Circle } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialogShell } from "./SettingsDialogShell";

afterEach(cleanup);

vi.mock("kui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogClose: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DialogContent: ({
    children,
    showCloseButton: _showCloseButton,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("kui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const renderShell = () =>
  render(
    <SettingsDialogShell
      open
      onOpenChange={vi.fn()}
      title="Settings"
      closeLabel="Close"
      sections={[
        {
          key: "account",
          title: "Account Settings",
          icon: Circle,
          tabs: [{ id: "environment", label: "Environment Variables", icon: Circle }],
        },
      ]}
      activeTab="environment"
      onTabChange={vi.fn()}
      accordion
      activeSectionKey="account"
      onSectionChange={vi.fn()}
    >
      <div>Settings content</div>
    </SettingsDialogShell>,
  );

const setElementWidth = (element: HTMLElement, clientWidth: number, scrollWidth: number) => {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
};

const notifyResize = () => {
  act(() => {
    for (const observer of ResizeObserverMock.instances) observer.trigger();
  });
};

describe("SettingsDialogShell sidebar overflow", () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("shows a tooltip on focus and hover only when the rendered label is truncated", async () => {
    const { container } = renderShell();
    const label = container.querySelector<HTMLElement>(
      '[data-settings-sidebar-label="Account Settings"]',
    );
    const button = label?.closest("button");

    expect(label).not.toBeNull();
    expect(button).not.toBeNull();

    setElementWidth(label as HTMLElement, 160, 160);
    notifyResize();
    fireEvent.focus(button as HTMLButtonElement);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(button as HTMLButtonElement);

    setElementWidth(label as HTMLElement, 100, 160);
    notifyResize();
    fireEvent.focus(button as HTMLButtonElement);

    expect((await screen.findByRole("tooltip")).textContent).toContain("Account Settings");

    fireEvent.blur(button as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    fireEvent.pointerMove(button as HTMLButtonElement, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toContain("Account Settings");

    fireEvent.pointerLeave(button as HTMLButtonElement);
  });

  it("uses responsive width, tighter nested padding, and no horizontal scrolling", () => {
    const { container } = renderShell();
    // Mobile and desktop each render their own copy of the section list
    // (CSS-only responsive switch), so scope to the desktop sidebar instance.
    const desktopSidebar = container.querySelector('[data-settings-viewport="desktop"]');
    const label = desktopSidebar?.querySelector<HTMLElement>(
      '[data-settings-sidebar-label="Environment Variables"]',
    );
    const button = label?.closest("button");
    const scrollRegion = label?.closest(".overflow-y-auto");
    const sidebar = scrollRegion?.parentElement;

    expect(label?.className).toContain("truncate");
    expect(label?.className).toContain("min-w-0");
    expect(button?.className).toContain("px-2");
    expect(scrollRegion?.className).toContain("overflow-x-hidden");
    expect(sidebar?.className).toContain("w-52");
    expect(sidebar?.className).toContain("lg:w-56");
  });
});

describe("SettingsDialogShell content overflow", () => {
  it("constrains the main content pane without clipping wide tab content", () => {
    renderShell();
    const content = screen.getByText("Settings content");
    const contentPadding = content.parentElement;
    const scrollRegion = contentPadding?.parentElement;
    const contentColumn = scrollRegion?.parentElement;

    expect(contentPadding?.className).toContain("min-w-0");
    expect(scrollRegion?.className).toContain("min-w-0");
    expect(scrollRegion?.className).toContain("overflow-x-hidden");
    expect(scrollRegion?.className).toContain("overflow-y-auto");
    expect(contentColumn?.className).toContain("min-w-0");
  });
});

describe("SettingsDialogShell rendering contracts", () => {
  it("uses section-scoped keys when different sections share a tab id", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <SettingsDialogShell
        open
        onOpenChange={vi.fn()}
        title="Settings"
        closeLabel="Close"
        sections={[
          {
            key: "space",
            title: "Space",
            tabs: [{ id: "channels", label: "Space channels", icon: Circle }],
          },
          {
            key: "agent",
            title: "Agent",
            tabs: [{ id: "channels", label: "Agent channels", icon: Circle }],
          },
        ]}
        activeTab="channels"
        onTabChange={vi.fn()}
      >
        <div>Settings content</div>
      </SettingsDialogShell>,
    );

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it("provides a hidden description for the dialog content", () => {
    renderShell();

    const description = screen.getAllByText("Settings").find((element) => element.tagName === "P");
    expect(description?.className).toContain("sr-only");
  });
});

describe("SettingsDialogShell mobile drill-down", () => {
  const sections = [
    {
      key: "account",
      title: "Account Settings",
      icon: Circle,
      tabs: [{ id: "environment", label: "Environment Variables", icon: Circle }],
    },
  ];

  const findMobileList = (container: HTMLElement) =>
    container.querySelector('[data-settings-viewport="mobile"]');

  const findMobileTabButton = (container: HTMLElement) =>
    findMobileList(container)
      ?.querySelector<HTMLElement>('[data-settings-sidebar-label="Environment Variables"]')
      ?.closest("button");

  // "hidden" the Tailwind utility class, not the substring in "sm:hidden".
  const hasHiddenClass = (element: Element | null | undefined) =>
    (element?.className.split(/\s+/) ?? []).includes("hidden");

  it("shows the tab content and a back button after picking a tab, and returns to the list on back", () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <SettingsDialogShell
        open
        onOpenChange={vi.fn()}
        title="Settings"
        closeLabel="Close"
        sections={sections}
        activeTab="environment"
        onTabChange={onTabChange}
        accordion
        activeSectionKey="account"
        onSectionChange={vi.fn()}
      >
        <div>Settings content</div>
      </SettingsDialogShell>,
    );

    // Starts on the list — the mobile section list is visible, no back bar yet.
    expect(hasHiddenClass(findMobileList(container))).toBe(false);
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();

    fireEvent.click(findMobileTabButton(container) as HTMLElement);

    expect(onTabChange).toHaveBeenCalledWith("environment", "account");
    // Drilled into detail: list hides, a back bar with the tab label appears.
    expect(hasHiddenClass(findMobileList(container))).toBe(true);
    const backButton = screen.getByRole("button", { name: /Back/ });
    expect(screen.getAllByText("Environment Variables").length).toBeGreaterThan(0);

    fireEvent.click(backButton);

    // Back out: list reappears, back bar is gone.
    expect(hasHiddenClass(findMobileList(container))).toBe(false);
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
  });

  it("resets to the list view whenever the dialog re-opens", () => {
    const baseProps = {
      onOpenChange: vi.fn(),
      title: "Settings",
      closeLabel: "Close",
      sections,
      activeTab: "environment" as const,
      onTabChange: vi.fn(),
      accordion: true as const,
      activeSectionKey: "account",
      onSectionChange: vi.fn(),
    };

    const { container, rerender } = render(
      <SettingsDialogShell open {...baseProps}>
        <div>Settings content</div>
      </SettingsDialogShell>,
    );

    fireEvent.click(findMobileTabButton(container) as HTMLElement);
    expect(hasHiddenClass(findMobileList(container))).toBe(true);

    // Close, then re-open — should land back on the list, not the last detail.
    rerender(
      <SettingsDialogShell open={false} {...baseProps}>
        <div>Settings content</div>
      </SettingsDialogShell>,
    );
    rerender(
      <SettingsDialogShell open {...baseProps}>
        <div>Settings content</div>
      </SettingsDialogShell>,
    );

    expect(hasHiddenClass(findMobileList(container))).toBe(false);
  });

  it("drills down the same way in flat (non-accordion) mode, e.g. the account/space-only SettingsModal", () => {
    const onTabChange = vi.fn();
    const { container } = render(
      <SettingsDialogShell
        open
        onOpenChange={vi.fn()}
        title="Settings"
        closeLabel="Close"
        sections={[
          {
            key: "account",
            title: "Account Settings",
            tabs: [{ id: "profile", label: "Profile", icon: Circle }],
          },
          {
            key: "space",
            title: "Space Settings",
            tabs: [{ id: "billing", label: "Billing", icon: Circle }],
          },
        ]}
        activeTab="profile"
        onTabChange={onTabChange}
      >
        <div>Settings content</div>
      </SettingsDialogShell>,
    );

    expect(hasHiddenClass(findMobileList(container))).toBe(false);

    const mobileBillingButton = findMobileList(container)
      ?.querySelector<HTMLElement>('[data-settings-sidebar-label="Billing"]')
      ?.closest("button");
    fireEvent.click(mobileBillingButton as HTMLElement);

    expect(onTabChange).toHaveBeenCalledWith("billing", "space");
    expect(hasHiddenClass(findMobileList(container))).toBe(true);
    expect(screen.getByRole("button", { name: /Back/ })).toBeTruthy();
  });
});
