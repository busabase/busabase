import { describe, expect, it } from "vitest";
import { getLocalPageLocales, getLocalPostLocales } from "./local-post-locales";

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

describe("getLocalPageLocales", () => {
  const i18n = { languages: LOCALES, defaultLanguage: "en" };

  it("an English-only page: only en is real, and ja is a fallback to the English file", () => {
    const s = source({ "build-an-airapp": { en: { t: "en" } } });
    expect(getLocalPageLocales(s, i18n, ["build-an-airapp"], "en")).toEqual({
      availableLocales: ["en"],
      contentLocale: "en",
      isLocaleFallback: false,
    });
    expect(getLocalPageLocales(s, i18n, ["build-an-airapp"], "ja")).toEqual({
      availableLocales: ["en"],
      contentLocale: "en",
      isLocaleFallback: true,
    });
  });

  it("a fully translated page keeps every locale and renders the requested one", () => {
    const s = source({ quickstart: { en: { t: 1 }, "zh-CN": { t: 2 }, ja: { t: 3 } } });
    expect(getLocalPageLocales(s, i18n, ["quickstart"], "ja")).toEqual({
      availableLocales: ["en", "zh-CN", "ja"],
      contentLocale: "ja",
      isLocaleFallback: false,
    });
  });
});
