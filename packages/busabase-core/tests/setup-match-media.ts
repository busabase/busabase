import { beforeEach, vi } from "vitest";

beforeEach(() => {
  if (typeof window === "undefined" || typeof window.matchMedia === "function") return;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(any-pointer: fine)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
