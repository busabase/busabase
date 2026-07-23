import { describe, expect, it } from "vitest";
import {
  buildCmsCanonicalPath,
  buildCmsTaxonomyArchivePath,
  filterCmsPostsByTaxonomy,
  isCmsBlogPostPath,
  isCmsContentForLocale,
  normalizeCmsPath,
  parseCmsCanonicalPath,
} from "../src/routing";

const options = {
  supportedLocales: ["en", "zh-CN", "ja"],
  defaultLocale: "en",
} as const;

describe("CMS canonical routing", () => {
  it("normalizes equivalent paths and preserves nested content", () => {
    expect(normalizeCmsPath("//zh-CN/pages/hello//")).toBe("/zh-CN/pages/hello");
    expect(normalizeCmsPath("/zh-CN/%E4%BD%A0%E5%A5%BD")).toBe("/zh-CN/你好");
  });

  it("rejects malformed, traversal, query, and fragment paths", () => {
    expect(normalizeCmsPath("relative/path")).toBeNull();
    expect(normalizeCmsPath("/pages/%2E%2E/secret")).toBeNull();
    expect(normalizeCmsPath("/pages/%E0%A4%A")).toBeNull();
    expect(normalizeCmsPath("/pages/a?draft=1")).toBeNull();
    expect(normalizeCmsPath("/pages/a#preview")).toBeNull();
  });

  it("requires the default locale to be unprefixed", () => {
    expect(parseCmsCanonicalPath("/blog/hello", options)).toMatchObject({
      locale: "en",
      pathWithoutLocale: "/blog/hello",
    });
    expect(parseCmsCanonicalPath("/zh-CN/blog/hello", options)).toMatchObject({
      locale: "zh-CN",
      pathWithoutLocale: "/blog/hello",
    });
    expect(parseCmsCanonicalPath("/en/blog/hello", options)).toBeNull();
  });

  it("builds paths and validates field locale against path locale", () => {
    expect(buildCmsCanonicalPath("en", ["blog", "hello"], options)).toBe("/blog/hello");
    expect(buildCmsCanonicalPath("ja", ["guides", "agents"], options)).toBe("/ja/guides/agents");
    expect(buildCmsCanonicalPath("fr", ["blog", "hello"], options)).toBeNull();
    expect(
      isCmsContentForLocale({ locale: "zh-CN", path: "/zh-CN/pages/hello" }, "zh-CN", options),
    ).toBe(true);
    expect(isCmsContentForLocale({ locale: "en", path: "/zh-CN/pages/hello" }, "en", options)).toBe(
      false,
    );
  });

  it("reserves the blog namespace for Posts with a non-empty slug", () => {
    expect(isCmsBlogPostPath("/blog/hello", options)).toBe(true);
    expect(isCmsBlogPostPath("/zh-CN/blog/guides/hello", options)).toBe(true);
    expect(isCmsBlogPostPath("/blog", options)).toBe(false);
    expect(isCmsBlogPostPath("/guides/hello", options)).toBe(false);
  });

  it("builds locale-aware taxonomy archive paths", () => {
    expect(buildCmsTaxonomyArchivePath("categories", { locale: "en", slug: "news" }, options)).toBe(
      "/categories/news",
    );
    expect(buildCmsTaxonomyArchivePath("tags", { locale: "zh-CN", slug: "ai" }, options)).toBe(
      "/zh-CN/tags/ai",
    );
    expect(buildCmsTaxonomyArchivePath("tags", { locale: "fr", slug: "ai" }, options)).toBeNull();
  });

  it("filters related Posts by relation id and locale", () => {
    const posts = [
      { locale: "en", categoryIds: ["cat-1"], tagIds: ["tag-1"] },
      { locale: "zh-CN", categoryIds: ["cat-1"], tagIds: ["tag-1"] },
      { locale: "en", categoryIds: ["cat-2"], tagIds: ["tag-2"] },
    ];

    expect(filterCmsPostsByTaxonomy(posts, "categories", { id: "cat-1", locale: "en" })).toEqual([
      posts[0],
    ]);
    expect(filterCmsPostsByTaxonomy(posts, "tags", { id: "tag-1", locale: "zh-CN" })).toEqual([
      posts[1],
    ]);
  });
});
