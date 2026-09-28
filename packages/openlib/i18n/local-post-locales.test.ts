import { describe, expect, it } from "vitest";
import { getLocalPostLocales } from "./local-post-locales";

const LOCALES = ["en", "zh-CN", "ja"] as const;

// Mimics fumadocs with `fallbackLanguage: "en"`: an untranslated locale returns the English data.
const source = (files: Record<string, Record<string, object>>) => ({
  getPage: (slugs: string[], locale: string) => {
    const byLocale = files[slugs.join("/")];
    const data = byLocale?.[locale] ?? byLocale?.en;
    return data ? { data } : undefined;
  },
});

describe("getLocalPostLocales", () => {
  it("excludes locales served only by the English fallback", () => {
    const s = source({ post: { en: { t: "en" }, "zh-CN": { t: "zh" } } });
    expect(getLocalPostLocales(s, LOCALES, "en", ["post"])).toEqual(["en", "zh-CN"]);
  });

  it("keeps every locale that has its own file", () => {
    const s = source({ post: { en: { t: 1 }, "zh-CN": { t: 2 }, ja: { t: 3 } } });
    expect(getLocalPostLocales(s, LOCALES, "en", ["post"])).toEqual(["en", "zh-CN", "ja"]);
  });

  it("returns nothing for an unknown slug", () => {
    expect(getLocalPostLocales(source({}), LOCALES, "en", ["nope"])).toEqual([]);
  });
});
