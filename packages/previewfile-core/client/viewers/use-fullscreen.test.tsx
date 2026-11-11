import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFullscreen } from "./use-fullscreen";

// jsdom has no Fullscreen API: a stand-in for the browser's, which the tests can drive.
let current: Element | null = null;
const setFullscreenElement = (element: Element | null) => {
  current = element;
  document.dispatchEvent(new Event("fullscreenchange"));
};
Object.defineProperty(document, "fullscreenElement", { get: () => current, configurable: true });
const exitFullscreen = vi.fn(async () => setFullscreenElement(null));
Object.defineProperty(document, "exitFullscreen", { value: exitFullscreen, configurable: true });

const frame = (requestFullscreen?: () => Promise<void>) => {
  const element = document.createElement("div");
  if (requestFullscreen) element.requestFullscreen = requestFullscreen;
  return { current: element };
};

afterEach(() => {
  current = null;
  exitFullscreen.mockClear();
});

describe("useFullscreen", () => {
  it("goes fullscreen the browser's way, and follows the browser out of it", async () => {
    const ref = frame();
    ref.current.requestFullscreen = vi.fn(async () => setFullscreenElement(ref.current));
    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.isFullscreen).toBe(false);

    await act(() => result.current.toggle());
    expect(result.current.isFullscreen).toBe(true);
    // The browser's fullscreen fills the screen itself: no overlay to style.
    expect(result.current.overlay).toBe(false);

    // Esc: the browser ends it without being asked.
    act(() => setFullscreenElement(null));
    expect(result.current.isFullscreen).toBe(false);
  });

  it("leaves fullscreen when toggled again", async () => {
    const ref = frame();
    ref.current.requestFullscreen = vi.fn(async () => setFullscreenElement(ref.current));
    const { result } = renderHook(() => useFullscreen(ref));
    await act(() => result.current.toggle());
    await act(() => result.current.toggle());
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(false);
  });

  it("covers the page instead where the browser will not go fullscreen", async () => {
    // An iframe without allow="fullscreen" rejects; iPhone Safari has no such method at all.
    for (const ref of [
      frame(async () => {
        throw new TypeError("Fullscreen is not allowed");
      }),
      frame(),
    ]) {
      const { result, unmount } = renderHook(() => useFullscreen(ref));
      await act(() => result.current.toggle());
      expect(result.current.overlay).toBe(true);
      expect(result.current.isFullscreen).toBe(true);

      await act(() => result.current.toggle());
      expect(result.current.overlay).toBe(false);
      expect(result.current.isFullscreen).toBe(false);
      unmount();
    }
  });

  it("does not leave the browser fullscreen on a viewer that is gone", async () => {
    const ref = frame();
    ref.current.requestFullscreen = vi.fn(async () => setFullscreenElement(ref.current));
    const { result, unmount } = renderHook(() => useFullscreen(ref));
    await act(() => result.current.toggle());

    unmount();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
