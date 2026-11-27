// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AirAppPreviewViewport } from "./AirAppPreviewViewport";

afterEach(cleanup);

describe("the shared running-app viewport", () => {
  it("renders the host fallback without an iframe or sizing frame until a URL is ready", () => {
    const ref = createRef<HTMLIFrameElement>();
    const { rerender } = render(
      <AirAppPreviewViewport
        fallback={<p role="status">Preparing the app</p>}
        ref={ref}
        title="Delivery app"
        wrapFrame={(frame) => <section aria-label="App size">{frame}</section>}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Preparing the app");
    expect(screen.queryByTitle("Delivery app")).toBeNull();
    expect(screen.queryByRole("region", { name: "App size" })).toBeNull();
    expect(ref.current).toBeNull();

    rerender(
      <AirAppPreviewViewport
        fallback={<p role="status">Preparing the app</p>}
        ref={ref}
        src="/preview/live"
        title="Delivery app"
        wrapFrame={(frame) => <section aria-label="App size">{frame}</section>}
      />,
    );
    const frame = screen.getByTitle("Delivery app");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("region", { name: "App size" }).contains(frame)).toBe(true);
    expect(ref.current).toBe(frame);
    const sandbox = new Set(frame.getAttribute("sandbox")?.split(" "));
    expect(sandbox).toEqual(
      new Set([
        "allow-same-origin",
        "allow-scripts",
        "allow-forms",
        "allow-popups",
        "allow-popups-to-escape-sandbox",
      ]),
    );
    expect(sandbox.has("allow-top-navigation")).toBe(false);
    expect(frame.hasAttribute("credentialless")).toBe(false);
  });

  it("preserves the iframe and ref while host controls change presentation", () => {
    const ref = createRef<HTMLIFrameElement>();
    const loaded = vi.fn();
    const frameAtSize = (size: string) => (frame: ReactNode) => (
      <div data-testid="app-size" data-size={size}>
        {frame}
      </div>
    );
    const { rerender } = render(
      <AirAppPreviewViewport
        onLoad={(event) => loaded(event.currentTarget)}
        ref={ref}
        src="/preview/live"
        title="Delivery app"
        wrapFrame={frameAtSize("desktop")}
      />,
    );
    const frame = screen.getByTitle("Delivery app");
    frame.setAttribute("data-unsaved-draft", "Keep this running app's state");
    const sizeFrame = screen.getByTestId("app-size");

    rerender(
      <AirAppPreviewViewport
        className="fullscreen-app"
        onLoad={(event) => loaded(event.currentTarget)}
        ref={ref}
        src="/preview/live"
        title="Delivery app fullscreen"
        wrapFrame={frameAtSize("mobile")}
      />,
    );
    expect(screen.getByTitle("Delivery app fullscreen")).toBe(frame);
    expect(screen.getByTestId("app-size")).toBe(sizeFrame);
    expect(ref.current).toBe(frame);
    expect(frame.getAttribute("data-unsaved-draft")).toBe("Keep this running app's state");
    fireEvent.load(frame);
    expect(loaded).toHaveBeenCalledExactlyOnceWith(frame);
  });

  it("opts a public website into credentialless embedding without changing the private viewport default", () => {
    const { rerender } = render(
      <AirAppPreviewViewport
        credentialless
        src="https://published.sites.test"
        title="Deployed Site"
      />,
    );
    const publicFrame = screen.getByTitle("Deployed Site");
    expect(publicFrame.hasAttribute("credentialless")).toBe(true);
    expect(publicFrame.getAttribute("sandbox")).toContain("allow-scripts");
    rerender(<AirAppPreviewViewport src="/api/airapp-preview/private/" title="Private preview" />);
    expect(screen.getByTitle("Private preview").hasAttribute("credentialless")).toBe(false);
  });

  it("remounts only a deliberately keyed reviewed version and clears its ref at the terminal state", () => {
    const ref = createRef<HTMLIFrameElement>();
    const wrapFrame = (frame: ReactNode) => <div data-testid="review-frame">{frame}</div>;
    const { rerender } = render(
      <AirAppPreviewViewport
        frameKey="version-1"
        ref={ref}
        src="/preview/review"
        title="Reviewed app"
        wrapFrame={wrapFrame}
      />,
    );
    const firstFrame = screen.getByTitle("Reviewed app");
    const reviewFrame = screen.getByTestId("review-frame");
    rerender(
      <AirAppPreviewViewport
        frameKey="version-2"
        ref={ref}
        src="/preview/review"
        title="Reviewed app"
        wrapFrame={wrapFrame}
      />,
    );
    expect(screen.getByTitle("Reviewed app")).not.toBe(firstFrame);
    expect(screen.getByTestId("review-frame")).toBe(reviewFrame);
    expect(ref.current).toBe(screen.getByTitle("Reviewed app"));

    rerender(
      <AirAppPreviewViewport
        fallback={<p role="status">Content unavailable</p>}
        ref={ref}
        src={null}
        title="Reviewed app"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Content unavailable");
    expect(screen.queryByTitle("Reviewed app")).toBeNull();
    expect(ref.current).toBeNull();
  });
});
