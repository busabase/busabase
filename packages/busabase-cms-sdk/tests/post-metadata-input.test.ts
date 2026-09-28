import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import { createCmsPostResolver } from "../src/integration/posts";
import { buildCmsContentMetadataInput } from "../src/metadata";
import type { PostVO } from "../src/types";

const LOCALES = ["en", "zh-CN", "ja"] as const;

const resolver = createCmsPostResolver({
  integration: {
    buildCmsPath: () => null,
    parseCmsPath: (path) => ({
      locale: "en",
      pathWithoutLocale: path.replace(/^\/(zh-CN|ja)(?=\/)/, ""),
      canonicalPath: path,
      segments: [],
    }),
    isCmsContentForLocale: () => true,
    getBusabaseBlogPostByPathOrFallback: async () => null,
  },
  localSource: { getPage: (): unknown => undefined },
  supportedLocales: LOCALES,
  defaultLocale: "en",
});

const post = (locale: string, fields: Partial<PostVO> = {}) =>
  ({
    locale,
    path: locale === "en" ? "/blog/p" : `/${locale}/blog/p`,
    title: `Title ${locale}`,
    description: `Desc ${locale}`,
    seoTitle: null,
    seoDescription: null,
    coverImage: null,
    ...fields,
  }) as PostVO;

const cms =
  (posts: Record<string, PostVO>) =>
  async (locale: string): Promise<PostVO | null> =>
    posts[locale] ?? null;

describe("resolvePostMetadataInputWithDependencies", () => {
  it("returns every head fact for a CMS post in one call", async () => {
    const input = await resolver.resolvePostMetadataInputWithDependencies("ja", "p", {
      getCmsPost: cms({ en: post("en"), ja: post("ja") }),
      getLocalPost: () => undefined,
    });
    expect(input).toEqual({
      title: "Title ja",
      description: "Desc ja",
      absoluteTitle: false,
      path: "/blog/p",
      lang: "ja",
      canonicalLang: "ja",
      contentLang: "ja",
      availableLocales: ["en", "ja"],
    });
  });

  it("marks an editor seo-title absolute and prefers seo-description", async () => {
    const input = await resolver.resolvePostMetadataInputWithDependencies("en", "p", {
      getCmsPost: cms({
        en: post("en", {
          seoTitle: "Full SEO Title | Brand",
          seoDescription: "SEO desc",
          coverImage: { url: "https://cdn.example.com/c.png" } as PostVO["coverImage"],
        }),
      }),
      getLocalPost: () => undefined,
    });
    expect(input).toMatchObject({
      title: "Full SEO Title | Brand",
      description: "SEO desc",
      absoluteTitle: true,
      coverImageUrl: "https://cdn.example.com/c.png",
      availableLocales: ["en"],
    });
  });

  it("an English-only post requested at /ja: canonical and content are English, hreflang is en only", async () => {
    const input = await resolver.resolvePostMetadataInputWithDependencies("ja", "p", {
      getCmsPost: cms({ en: post("en") }),
      getLocalPost: () => undefined,
    });
    expect(input).toMatchObject({
      lang: "ja",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
    });
  });

  it("localeFallback: false returns null instead of the English original", async () => {
    const input = await resolver.resolvePostMetadataInputWithDependencies(
      "ja",
      "p",
      { getCmsPost: cms({ en: post("en") }), getLocalPost: () => undefined },
      { localeFallback: false },
    );
    expect(input).toBeNull();
  });

  it("reads a local (fumadocs) post's title/description/image", async () => {
    const data = { title: "Local", description: "Local desc", image: "/img.png" };
    const input = await resolver.resolvePostMetadataInputWithDependencies("en", "p", {
      getCmsPost: cms({}),
      getLocalPost: (locale) => (locale === "en" ? { data } : undefined),
    });
    expect(input).toEqual({
      title: "Local",
      description: "Local desc",
      absoluteTitle: false,
      path: "/blog/p",
      lang: "en",
      canonicalLang: "en",
      contentLang: "en",
      availableLocales: ["en"],
      coverImageUrl: "/img.png",
    });
  });

  it("returns null when nothing exists", async () => {
    expect(
      await resolver.resolvePostMetadataInputWithDependencies("en", "p", {
        getCmsPost: cms({}),
        getLocalPost: () => undefined,
      }),
    ).toBeNull();
  });
});

describe("buildCmsContentMetadataInput", () => {
  it("always keeps the content locale in availableLocales", () => {
    const input = buildCmsContentMetadataInput({
      requestedLocale: "ja",
      contentLocale: "ja",
      canonicalPath: "/blog/p",
      availableLocales: [],
      local: { title: "T" },
    });
    expect(input.availableLocales).toEqual(["ja"]);
    expect(input.description).toBe("");
    expect(input).not.toHaveProperty("coverImageUrl");
  });
});
