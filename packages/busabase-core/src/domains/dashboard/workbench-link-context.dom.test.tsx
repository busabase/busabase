// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkbenchLinkResolver } from "./utils/workbench-link";
import {
  useWorkbenchLinkClickHandler,
  useWorkbenchLinkOpenHandler,
  WorkbenchLinkProvider,
} from "./workbench-link-context";

afterEach(cleanup);

// jsdom never follows an <a href>, so "the page did not reload" is always true
// there. What a real browser honours is the click's default being cancelled —
// `fireEvent.click` returns false exactly when it was.
const resolveDashboardLink: WorkbenchLinkResolver = (url) =>
  url.origin === window.location.origin && url.pathname.startsWith("/dashboard/local/")
    ? `${url.pathname.slice("/dashboard/local".length)}${url.search}${url.hash}`
    : null;

function renderInWorkbench(ui: ReactNode, resolver: WorkbenchLinkResolver | undefined) {
  const location = memoryLocation({ path: "/doc/cover?space=tnl_1", record: true });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <WorkbenchLinkProvider resolveWorkbenchLink={resolver}>{ui}</WorkbenchLinkProvider>
    </Router>,
  );
  return location;
}

function DocBody() {
  const onClick = useWorkbenchLinkClickHandler();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegated link clicks, as in the Doc reader
    <div onClick={onClick}>
      <a href="/dashboard/local/doc/chapter-1">Chapter 1</a>
      <a href="https://example.com/">Elsewhere</a>
      <a href="/dashboard/local/doc/chapter-2" target="_blank" rel="noreferrer">
        New tab
      </a>
      <a href="#appendix">Appendix</a>
      <strong>
        <a href="/dashboard/local/doc/chapter-3#setup">
          <em>Nested</em>
        </a>
      </strong>
    </div>
  );
}

describe("workbench links in a Doc", () => {
  it("routes a link into the workbench in place, keeping the page's query", () => {
    const location = renderInWorkbench(<DocBody />, resolveDashboardLink);

    expect(fireEvent.click(screen.getByText("Chapter 1"))).toBe(false);
    expect(location.history.at(-1)).toBe("/doc/chapter-1?space=tnl_1");

    // A click on formatted text inside the link counts, and the hash stays last.
    expect(fireEvent.click(screen.getByText("Nested"))).toBe(false);
    expect(location.history.at(-1)).toBe("/doc/chapter-3?space=tnl_1#setup");
  });

  it("leaves external links, new-tab links, anchors and modified clicks to the browser", () => {
    const location = renderInWorkbench(<DocBody />, resolveDashboardLink);

    expect(fireEvent.click(screen.getByText("Elsewhere"))).toBe(true);
    expect(fireEvent.click(screen.getByText("New tab"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Appendix"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Chapter 1"), { metaKey: true })).toBe(true);
    expect(fireEvent.click(screen.getByText("Chapter 1"), { ctrlKey: true })).toBe(true);
    expect(location.history).toEqual(["/doc/cover?space=tnl_1"]);
  });

  it("changes nothing for a host that wired no resolver", () => {
    const location = renderInWorkbench(<DocBody />, undefined);

    expect(fireEvent.click(screen.getByText("Chapter 1"))).toBe(true);
    expect(location.history).toEqual(["/doc/cover?space=tnl_1"]);
  });
});

describe("workbench links on a whiteboard", () => {
  let onLinkOpen: ReturnType<typeof useWorkbenchLinkOpenHandler> | null = null;
  function Capture() {
    onLinkOpen = useWorkbenchLinkOpenHandler();
    return null;
  }
  const openLink = (link: string, nativeEvent: Partial<MouseEvent> = {}) => {
    const event = new CustomEvent("excalidraw-link", {
      cancelable: true,
      detail: { nativeEvent: { button: 0, ...nativeEvent } as MouseEvent },
    });
    onLinkOpen?.({ link }, event);
    return event.defaultPrevented;
  };

  it("cancels Excalidraw's own navigation only for links it routes in place", () => {
    const location = renderInWorkbench(<Capture />, resolveDashboardLink);

    expect(openLink(`${window.location.origin}/dashboard/local/whiteboard/plan`)).toBe(true);
    expect(location.history.at(-1)).toBe("/whiteboard/plan?space=tnl_1");

    expect(openLink("https://example.com/")).toBe(false);
    expect(openLink("/dashboard/local/doc/x", { ctrlKey: true })).toBe(false);
    expect(location.history).toHaveLength(2);
  });
});
