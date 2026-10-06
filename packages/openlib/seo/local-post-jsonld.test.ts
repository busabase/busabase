import { describe, expect, it, vi } from "vitest";
import { buildBlogPostJsonLd } from "./blog-post-jsonld";
import { resolveLocalPostJsonLd } from "./local-post-jsonld";

const SITE = {
  baseUrl: "https://insure.example",
  defaultLocale: "en",
  siteName: "Insure",
  organizationId: "https://insure.example/#organization",
};
const LOCALES = ["en", "zh-CN", "ja"] as const;

type Page = { data: Record<string, unknown> };

const english: Page = {
  data: {
    title: "Hello",
    description: "Hi",
    image: "/hello.png",
    cover: "/cover.png",
    date: new Date("2026-02-03T00:00:00.000Z"),
    author: "Team",
  },
};
const chinese: Page = { data: { ...english.data, title: "你好" } };

/** fumadocs with `fallbackLanguage`: an untranslated locale gets the English page object. */
const source = {
  getPage: (slugs: string[], locale: string): Page | undefined => {
    if (slugs.join("/") !== "hello") return undefined;
    return locale === "zh-CN" ? chinese : english;
  },
};

const labels = {
  homeLabel: () => "Insure",
  blogLabel: (locale: string) => (locale === "zh-CN" ? "博客" : "Blog"),
};

describe("resolveLocalPostJsonLd", () => {
  it("equals buildBlogPostJsonLd fed the frontmatter, at the requested locale when translated", async () => {
    const nodes = await resolveLocalPostJsonLd({
      source,
      site: SITE,
      supportedLocales: LOCALES,
      slugs: ["hello"],
      lang: "zh-CN",
      ...labels,
    });

    expect(nodes).toEqual(
      buildBlogPostJsonLd(SITE, {
        path: "/blog/hello",
        lang: "zh-CN",
        title: "你好",
        description: "Hi",
        image: "/hello.png",
        datePublished: english.data.date as Date,
        author: "Team",
        homeLabel: "Insure",
        blogLabel: "博客",
      }),
    );
  });

  it("describes the English original, asking labels in English, on a fumadocs fallback", async () => {
    const blogLabel = vi.fn(labels.blogLabel);
    const nodes = await resolveLocalPostJsonLd({
      source,
      site: SITE,
      supportedLocales: LOCALES,
      slugs: ["hello"],
      lang: "ja",
      homeLabel: labels.homeLabel,
      blogLabel,
    });

    expect(blogLabel).toHaveBeenCalledWith("en");
    expect(nodes[0]).toMatchObject({
      inLanguage: "en",
      url: "https://insure.example/blog/hello",
    });
  });

  it("uses a getFields override (e.g. an app whose cover lives in `cover`)", async () => {
    const [posting] = await resolveLocalPostJsonLd({
      source,
      site: SITE,
      supportedLocales: LOCALES,
      slugs: ["hello"],
      lang: "en",
      getFields: (page) => ({
        title: page.data.title as string,
        image: page.data.cover as string,
      }),
    });

    expect(posting.image).toEqual(["https://insure.example/cover.png"]);
    expect(posting.datePublished).toBeUndefined();
  });

  it("returns [] when there is no post at that slug", async () => {
    await expect(
      resolveLocalPostJsonLd({
        source,
        site: SITE,
        supportedLocales: LOCALES,
        slugs: ["missing"],
        lang: "en",
      }),
    ).resolves.toEqual([]);
  });
});
