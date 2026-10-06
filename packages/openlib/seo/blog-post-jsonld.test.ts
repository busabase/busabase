import { describe, expect, it } from "vitest";
import { buildBlogPostJsonLd } from "./blog-post-jsonld";

const SITE = {
  baseUrl: "https://insure.example",
  defaultLocale: "en",
  siteName: "Insure",
  organizationId: "https://insure.example/#organization",
};

describe("buildBlogPostJsonLd", () => {
  it("returns a BlogPosting at the canonical URL plus Home → Blog → Post breadcrumbs", () => {
    const nodes = buildBlogPostJsonLd(SITE, {
      path: "/blog/hello",
      lang: "en",
      title: "Hello",
      description: "Hi there",
      image: "/assets/hello.png",
      datePublished: new Date("2026-02-03T00:00:00.000Z"),
      author: "Team",
    });

    expect(nodes).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: "Hello",
        description: "Hi there",
        inLanguage: "en",
        datePublished: "2026-02-03T00:00:00.000Z",
        dateModified: "2026-02-03T00:00:00.000Z",
        image: ["https://insure.example/assets/hello.png"],
        author: { "@type": "Person", name: "Team" },
        publisher: { "@id": "https://insure.example/#organization" },
        mainEntityOfPage: { "@type": "WebPage", "@id": "https://insure.example/blog/hello" },
        url: "https://insure.example/blog/hello",
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://insure.example" },
          { "@type": "ListItem", position: 2, name: "Blog", item: "https://insure.example/blog" },
          {
            "@type": "ListItem",
            position: 3,
            name: "Hello",
            item: "https://insure.example/blog/hello",
          },
        ],
      },
    ]);
  });

  it("prefixes every URL with a non-default content locale", () => {
    const [posting, crumbs] = buildBlogPostJsonLd(SITE, {
      path: "/blog/hello",
      lang: "zh-CN",
      title: "你好",
      homeLabel: "首页",
      blogLabel: "博客",
    });

    expect(posting.url).toBe("https://insure.example/zh-CN/blog/hello");
    expect(posting.inLanguage).toBe("zh-CN");
    expect(crumbs.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "首页", item: "https://insure.example/zh-CN" },
      { "@type": "ListItem", position: 2, name: "博客", item: "https://insure.example/zh-CN/blog" },
      {
        "@type": "ListItem",
        position: 3,
        name: "你好",
        item: "https://insure.example/zh-CN/blog/hello",
      },
    ]);
  });

  it("omits fields it has no real value for, and never serializes undefined or empties", () => {
    const [posting] = buildBlogPostJsonLd(SITE, {
      path: "/blog/bare",
      lang: "en",
      title: "Bare",
      description: "",
      image: null,
      datePublished: "not a date",
      author: undefined,
    });

    expect(Object.keys(posting).sort()).toEqual(
      [
        "@context",
        "@type",
        "headline",
        "inLanguage",
        "mainEntityOfPage",
        "publisher",
        "url",
      ].sort(),
    );
    expect(JSON.stringify(posting)).not.toMatch(/undefined|null|\[\]/);
  });

  it("keeps an ISO date string verbatim", () => {
    const [posting] = buildBlogPostJsonLd(SITE, {
      path: "/blog/x",
      lang: "en",
      title: "X",
      datePublished: "2026-09-01",
      dateModified: "2026-09-05T10:00:00+08:00",
    });
    expect(posting.datePublished).toBe("2026-09-01");
    expect(posting.dateModified).toBe("2026-09-05T10:00:00+08:00");
  });

  it("inlines the publisher when the app renders no Organization node to reference", () => {
    const [posting] = buildBlogPostJsonLd(
      { baseUrl: "https://previewfile.dev", defaultLocale: "en", siteName: "PreviewFile" },
      { path: "/blog/x", lang: "en", title: "X" },
    );
    expect(posting.publisher).toEqual({
      "@type": "Organization",
      name: "PreviewFile",
      url: "https://previewfile.dev",
    });
  });
});
