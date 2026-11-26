// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentNavigationProvider } from "../../dashboard/content-navigation-context";
import { HtmlPreviewFrame } from "./html-preview-frame";

const sessionOf = (frame: HTMLIFrameElement) =>
  /"sessionId":"([^"]+)"/.exec(frame.getAttribute("srcdoc") ?? "")?.[1];
const frameOnScreen = () => screen.getByTitle("Report") as HTMLIFrameElement;
const send = (
  frame: HTMLIFrameElement,
  href = "https://example.com/guide",
  overrides: MessageEventInit = {},
) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "null",
      source: frame.contentWindow,
      data: { type: "busabase:html-preview:navigate", sessionId: sessionOf(frame), href },
      ...overrides,
    }),
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userActivation");
});

describe("shared HTML preview frame", () => {
  it("accepts navigation only from the active opaque frame during a user gesture", () => {
    const activation = { isActive: false };
    Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { unmount } = render(<HtmlPreviewFrame title="Report" source="<h1>Report</h1>" />);
    const frame = frameOnScreen();
    expect(sessionOf(frame)).toBeTruthy();
    send(frame);
    activation.isActive = true;
    send(frame, undefined, { source: window });
    send(frame, undefined, { origin: window.location.origin });
    send(frame, undefined, {
      data: {
        type: "busabase:html-preview:navigate",
        sessionId: "expired",
        href: "https://example.com/guide",
      },
    });
    send(frame, "javascript:alert(1)");
    expect(open).not.toHaveBeenCalled();
    send(frame);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/guide",
      "_blank",
      "noopener,noreferrer",
    );
    const contentWindow = frame.contentWindow;
    const sessionId = sessionOf(frame);
    unmount();
    send(frame, undefined, {
      source: contentWindow,
      data: { type: "busabase:html-preview:navigate", sessionId, href: "https://example.com" },
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("remounts the document on source changes and rejects the old frame and session", () => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { rerender } = render(<HtmlPreviewFrame title="Report" source="<h1>Old</h1>" />);
    const oldFrame = frameOnScreen();
    const oldSessionId = sessionOf(oldFrame);
    const oldWindow = oldFrame.contentWindow;
    rerender(<HtmlPreviewFrame title="Report" source="<h1>New</h1>" />);
    const frame = frameOnScreen();
    expect(frame).not.toBe(oldFrame);
    expect(oldFrame.isConnected).toBe(false);
    expect(sessionOf(frame)).not.toBe(oldSessionId);
    expect(frame.getAttribute("srcdoc")).toContain("<h1>New</h1>");
    const data = {
      type: "busabase:html-preview:navigate",
      sessionId: oldSessionId,
      href: "https://example.com/guide",
    };
    send(frame, undefined, { source: oldWindow, data });
    send(frame, undefined, { data });
    expect(open).not.toHaveBeenCalled();
    send(frame);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("preserves the document on title-only changes and delegates validated links to its host", () => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { isActive: true },
    });
    const navigate = vi.fn(() => true);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const view = (title: string) => (
      <ContentNavigationProvider navigate={navigate}>
        <HtmlPreviewFrame title={title} source="<h1>Report</h1>" />
      </ContentNavigationProvider>
    );
    const { rerender } = render(view("Report"));
    const frame = frameOnScreen();
    const sessionId = sessionOf(frame);
    rerender(view("Renamed report"));
    expect(screen.getByTitle("Renamed report")).toBe(frame);
    expect(sessionOf(frame)).toBe(sessionId);
    send(frame, `${window.location.origin}/doc/report`);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/doc/report`);
    expect(open).not.toHaveBeenCalled();
  });
});
