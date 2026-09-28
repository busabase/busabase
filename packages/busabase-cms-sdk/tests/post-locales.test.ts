import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import { createCmsPostResolver } from "../src/integration/posts";
import type { PostVO } from "../src/types";

const LOCALES = ["en", "zh-CN", "ja"] as const;

const resolver = createCmsPostResolver({
  integration: {
    buildCmsPath: () => null,
    parseCmsPath: () => null,
    isCmsContentForLocale: () => true,
    getBusabaseBlogPostByPathOrFallback: async () => null,
  },
  localSource: { getPage: (): unknown => undefined },
  supportedLocales: LOCALES,
  defaultLocale: "en",
});

const enData = { t: "en" };
// fumadocs with fallbackLanguage "en": untranslated locales return the English data.
const local = (own: Record<string, object>) => (locale: string) => {
  const data = own[locale] ?? own.en;
  return data ? { data } : undefined;
};
const cms =
  (...locales: string[]) =>
  async (locale: string) =>
    locales.includes(locale) ? ({ locale } as PostVO) : null;

describe("getAvailablePostLocalesWithDependencies", () => {
  it("excludes fallback locales, keeps real MDX translations", async () => {
    const result = await resolver.getAvailablePostLocalesWithDependencies("p", "en", {
      getCmsPost: cms(),
      getLocalPost: local({ en: enData, "zh-CN": { t: "zh" } }),
    });
    expect(result).toEqual(["en", "zh-CN"]);
  });

  it("counts CMS posts and always keeps the content locale", async () => {
    const result = await resolver.getAvailablePostLocalesWithDependencies("p", "ja", {
      getCmsPost: cms("zh-CN"),
      getLocalPost: () => undefined,
    });
    expect(result).toEqual(["zh-CN", "ja"]);
  });

  it("probes every locale, the content locale included, when contentLocale is null", async () => {
    const getCmsPost = vi.fn(cms("ja"));
    const result = await resolver.getAvailablePostLocalesWithDependencies("p", null, {
      getCmsPost,
      getLocalPost: () => undefined,
    });
    expect(result).toEqual(["ja"]);
    expect(getCmsPost).toHaveBeenCalledTimes(LOCALES.length);
  });

  it("does not probe the content locale it already knows exists", async () => {
    const getCmsPost = vi.fn(cms());
    await resolver.getAvailablePostLocalesWithDependencies("p", "en", {
      getCmsPost,
      getLocalPost: () => undefined,
    });
    expect(getCmsPost.mock.calls.map(([locale]) => locale)).toEqual(["zh-CN", "ja"]);
  });

  it("survives CMS read failures", async () => {
    const result = await resolver.getAvailablePostLocalesWithDependencies("p", "en", {
      getCmsPost: async () => {
        throw new Error("down");
      },
      getLocalPost: local({ en: enData }),
    });
    expect(result).toEqual(["en"]);
  });
});

describe("resolvePostPageWithDependencies", () => {
  it("treats fumadocs' English fallback as a locale fallback, not a translation", async () => {
    const resolved = await resolver.resolvePostPageWithDependencies("ja", "p", {
      getCmsPost: cms(),
      getLocalPost: local({ en: enData }),
    });
    expect(resolved?.contentLocale).toBe("en");
    expect(resolved?.isLocaleFallback).toBe(true);
  });

  it("serves a real translation as itself", async () => {
    const resolved = await resolver.resolvePostPageWithDependencies("ja", "p", {
      getCmsPost: cms(),
      getLocalPost: local({ en: enData, ja: { t: "ja" } }),
    });
    expect(resolved?.contentLocale).toBe("ja");
    expect(resolved?.isLocaleFallback).toBe(false);
  });
});

describe("default behaviour when supportedLocales/defaultLocale are omitted (Buda)", () => {
  const legacy = createCmsPostResolver({
    integration: {
      buildCmsPath: () => null,
      parseCmsPath: () => null,
      isCmsContentForLocale: () => true,
      getBusabaseBlogPostByPathOrFallback: async () => null,
    },
    localSource: { getPage: (): unknown => undefined },
  });

  it("counts any page the local source returns as the requested locale's own", async () => {
    const resolved = await legacy.resolvePostPageWithDependencies("ja", "p", {
      getCmsPost: cms(),
      getLocalPost: local({ en: enData }),
    });
    expect(resolved?.source).toBe("local");
    expect(resolved?.contentLocale).toBe("ja");
    expect(resolved?.isLocaleFallback).toBe(false);
  });

  it("with supportedLocales but no defaultLocale, any returned local page counts (Buda)", async () => {
    const budaLike = createCmsPostResolver({
      integration: {
        buildCmsPath: () => null,
        parseCmsPath: () => null,
        isCmsContentForLocale: () => true,
        getBusabaseBlogPostByPathOrFallback: async () => null,
      },
      localSource: { getPage: (): unknown => undefined },
      supportedLocales: LOCALES,
    });
    expect(
      await budaLike.getAvailablePostLocalesWithDependencies("p", null, {
        getCmsPost: cms(),
        getLocalPost: local({ en: enData }),
      }),
    ).toEqual(["en", "zh-CN", "ja"]);
  });

  it("getAvailablePostLocales returns nothing without supportedLocales", async () => {
    expect(
      await legacy.getAvailablePostLocalesWithDependencies("p", "en", {
        getCmsPost: cms(),
        getLocalPost: local({ en: enData }),
      }),
    ).toEqual([]);
  });
});
