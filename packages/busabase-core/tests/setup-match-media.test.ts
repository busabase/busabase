// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHasFinePointer } from "../src/domains/dashboard/components/base-table-inline-cell";
import { useSidePanelViewport } from "../src/domains/dashboard/hooks/use-side-panel-viewport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("default media environment", () => {
  it("supports desktop grid editing without opening the mobile side panel", () => {
    const { result } = renderHook(() => ({
      finePointer: useHasFinePointer(),
      mobileSidePanel: useSidePanelViewport(),
    }));

    expect(result.current).toEqual({ finePointer: true, mobileSidePanel: false });
  });

  it("lets individual tests model a touch-only narrow viewport", () => {
    const desktopMatchMedia = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      ...desktopMatchMedia(query),
      matches: query === "(max-width: 1023.98px)",
    }));

    const { result } = renderHook(() => ({
      finePointer: useHasFinePointer(),
      mobileSidePanel: useSidePanelViewport(),
    }));

    expect(result.current).toEqual({ finePointer: false, mobileSidePanel: true });
  });
});
