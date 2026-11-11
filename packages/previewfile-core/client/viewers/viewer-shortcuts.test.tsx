import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewerLayoutProvider } from "./viewer-layout";
import { useViewerShortcuts } from "./viewer-shortcuts";

function Viewer({ ready = true, onZoom }: { ready?: boolean; onZoom: (by: string) => void }) {
  const root = useViewerShortcuts({
    keydown: (event) => {
      if (event.ctrlKey && event.key === "=") {
        event.preventDefault();
        onZoom("key");
      }
    },
    wheel: (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
        onZoom("wheel");
      }
    },
  });
  // Like TiffViewer / PsdViewer: a loading state first, the root only once loaded.
  if (!ready) return <p>Loading…</p>;
  return (
    <div ref={root} tabIndex={-1} data-testid="viewer">
      <button type="button">Zoom in</button>
    </div>
  );
}

const zoomKey = () =>
  new KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true, cancelable: true });
const zoomWheel = () =>
  new WheelEvent("wheel", { deltaY: -1, ctrlKey: true, bubbles: true, cancelable: true });
const prevented = (target: EventTarget, event: Event) => {
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

function Host({ children }: { children: React.ReactNode }) {
  return (
    <ViewerLayoutProvider layout="fill">
      <input aria-label="Host search" />
      {children}
    </ViewerLayoutProvider>
  );
}

describe("useViewerShortcuts", () => {
  it("listens on the whole page when the viewer is the page", () => {
    const onZoom = vi.fn();
    const { unmount } = render(<Viewer onZoom={onZoom} />);
    expect(prevented(document.body, zoomKey())).toBe(true);
    expect(prevented(document.body, zoomWheel())).toBe(true);
    expect(onZoom.mock.calls).toEqual([["key"], ["wheel"]]);

    unmount();
    expect(prevented(document.body, zoomKey())).toBe(false);
  });

  it("leaves the host page alone when embedded", () => {
    const onZoom = vi.fn();
    const { getByLabelText } = render(
      <Host>
        <Viewer onZoom={onZoom} />
      </Host>,
    );
    expect(prevented(getByLabelText("Host search"), zoomKey())).toBe(false);
    expect(prevented(document.body, zoomWheel())).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it("still answers inside the viewer when embedded", () => {
    const onZoom = vi.fn();
    const { getByRole, getByTestId } = render(
      <Host>
        <Viewer onZoom={onZoom} />
      </Host>,
    );
    expect(prevented(getByRole("button", { name: "Zoom in" }), zoomKey())).toBe(true);
    expect(prevented(getByTestId("viewer"), zoomWheel())).toBe(true);
    expect(onZoom.mock.calls).toEqual([["key"], ["wheel"]]);
  });

  it("attaches once the viewer's root appears after loading", () => {
    const onZoom = vi.fn();
    const { rerender, getByTestId } = render(
      <Host>
        <Viewer ready={false} onZoom={onZoom} />
      </Host>,
    );
    rerender(
      <Host>
        <Viewer onZoom={onZoom} />
      </Host>,
    );
    expect(prevented(getByTestId("viewer"), zoomKey())).toBe(true);
    expect(onZoom).toHaveBeenCalledWith("key");
  });

  it("calls the latest handlers after a re-render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Viewer onZoom={first} />);
    rerender(<Viewer onZoom={second} />);
    document.body.dispatchEvent(zoomKey());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("key");
  });
});
