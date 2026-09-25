import { describe, expect, it } from "vitest";
import { iStringParse } from "./i-string";
import { i18n } from "./i18n";

describe("iStringParse fallback order", () => {
  it("returns the requested locale when present", () => {
    expect(iStringParse({ en: "Hello", "zh-CN": "你好", es: "Hola" }, "es")).toBe("Hola");
  });

  it("falls back to English before any other locale", () => {
    // `zh-CN` is listed before `en`; a missing `es` must still show English.
    expect(iStringParse({ "zh-CN": "你好", en: "Hello" }, "es")).toBe("Hello");
  });

  it("falls back to the first available locale when English is missing", () => {
    expect(iStringParse({ "zh-CN": "你好", ja: "こんにちは" }, "es")).toBe("你好");
  });

  it("returns plain strings and empty values unchanged", () => {
    expect(iStringParse("plain", "es")).toBe("plain");
    expect(iStringParse(undefined, "es")).toBe("");
    expect(iStringParse({}, "es")).toBe("");
  });

  it("knows Vietnamese", () => {
    expect(i18n.locales).toContain("vi");
    expect(iStringParse({ en: "Hello", vi: "Xin chào" }, "vi")).toBe("Xin chào");
  });
});
