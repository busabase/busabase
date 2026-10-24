// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "kui/sidebar";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CloseMobileSidebarOnNavigate } from "./close-mobile-sidebar-on-navigate";

// kui's sidebar asks for the mobile breakpoint through `matchMedia`, which jsdom lacks.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof globalThis.matchMedia;

function Probe() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <>
      <button type="button" onClick={() => setOpenMobile(true)}>
        open drawer
      </button>
      <span data-testid="drawer">{String(openMobile)}</span>
    </>
  );
}

function mount(path: string) {
  const location = memoryLocation({ path });
  render(
    <SidebarProvider>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <CloseMobileSidebarOnNavigate />
        <Probe />
      </Router>
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByText("open drawer"));
  return location;
}

const drawer = () => screen.getByTestId("drawer").textContent;

afterEach(cleanup);

describe("CloseMobileSidebarOnNavigate", () => {
  it("closes an open drawer when the route's path changes", () => {
    const location = mount("/folder/a");
    expect(drawer()).toBe("true");
    act(() => location.navigate("/base/b"));
    expect(drawer()).toBe("false");
  });

  it("leaves an open drawer alone when only the query string changes", () => {
    const location = mount("/base/b/grid-view");
    expect(drawer()).toBe("true");
    act(() => location.navigate("/base/b/grid-view?filter=open"));
    expect(drawer()).toBe("true");
  });

  it("lets the toggle open the drawer again after it closed", () => {
    const location = mount("/folder/a");
    act(() => location.navigate("/doc/c"));
    expect(drawer()).toBe("false");
    fireEvent.click(screen.getByText("open drawer"));
    expect(drawer()).toBe("true");
  });
});
