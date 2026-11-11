import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Skip LibreOffice-dependent tests when soffice is not on PATH (mirrors
// the standalone viewer setup). The document-converter and security
// tests under server/converter/ try to spawn soffice and fail with HTTP 404
// or exit-code errors when it's missing — common in CI without LibreOffice
// installed. Apps that want to run these tests set LIBREOFFICE_PATH.
if (!process.env.LIBREOFFICE_PATH) {
  process.env.VITEST_SKIP_LIBREOFFICE_INTEGRATION = "true";
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class MockIntersectionObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

class MockResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
(globalThis as any).ResizeObserver = MockResizeObserver;
