import { afterEach, describe, expect, it, vi } from "vitest";
import { detectBusabaseBrowserLocale } from "../src/i18n/browser-locale";

const supported = ["en", "zh-CN", "ja"] as const;
afterEach(() => vi.unstubAllGlobals());

describe("Busabase browser locale detection", () => {
  it("preserves valid browser language matching", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN", "en"], language: "zh-CN" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("zh-CN");
    vi.stubGlobal("navigator", { languages: ["ja", "zh-CN"], language: "ja" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("ja");
  });

  it("falls back to English for the WSL WebKit C locale", () => {
    vi.stubGlobal("navigator", { languages: ["C"], language: "C" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("en");
    vi.stubGlobal("navigator", { languages: ["C", "zh-CN"], language: "C" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("en");
  });

  it("uses the single browser language when its languages list is empty", () => {
    vi.stubGlobal("navigator", { languages: [], language: "zh-CN" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("zh-CN");
    vi.stubGlobal("navigator", { languages: [], language: "C" });
    expect(detectBusabaseBrowserLocale(supported)).toBe("en");
  });

  it("keeps server rendering safe without navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectBusabaseBrowserLocale(supported)).toBe("en");
  });

  it("does not hide non-locale runtime errors", () => {
    vi.stubGlobal("navigator", {
      get languages() {
        throw new Error("unexpected failure");
      },
    });
    expect(() => detectBusabaseBrowserLocale(supported)).toThrow("unexpected failure");
  });
});
