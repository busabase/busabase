import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import { createCmsPostResolver } from "../src/integration/posts";
import { buildCmsArticleJsonLd, buildCmsPostJsonLd, type CmsJsonLdSite } from "../src/jsonld";
import { createCmsPathHelpers } from "../src/routing";
import type { PostVO } from "../src/types";

const SITE: CmsJsonLdSite = {
  baseUrl: "https://busabase.com",
  siteName: "Busabase",
  organizationId: "https://busabase.com/#organization",
};

const paths = createCmsPathHelpers({
  supportedLocales: ["en", "zh-CN", "ja"],
  defaultLocale: "en",
});

type Node = Record<string, unknown>;

/**
 * The structured-data rules a Blog Post's JSON-LD must satisfy, checked on the SERIALIZED form
 * (what a crawler reads), not on the in-memory object. No schema validator ships in this repo,
 * so this encodes the Google Article + BreadcrumbList requirements the route depends on.
 */
const checkPostGraph = (
  nodes: readonly Node[],
  expected: { url: string; lang: string; organizationId?: string; trail: string[] },
): Node => {
  const serialized = JSON.stringify(nodes);
  expect(serialized).not.toContain("undefined");
  expect(serialized).not.toContain("null");
  const parsed = JSON.parse(serialized) as Node[];

  const postings = parsed.filter((node) => node["@type"] === "BlogPosting");
  expect(postings).toHaveLength(1);
  const posting = postings[0];
  expect(posting["@context"]).toBe("https://schema.org");
  expect(typeof posting.headline).toBe("string");
  expect((posting.headline as string).length).toBeGreaterThan(0);
  expect(posting.url).toBe(expected.url);
  expect(posting.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": expected.url });
  expect(posting.inLanguage).toBe(expected.lang);
  for (const key of ["datePublished", "dateModified"]) {
    if (key in posting)
      expect(posting[key]).toMatch(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/);
  }
  if ("image" in posting) {
    expect(Array.isArray(posting.image)).toBe(true);
    expect((posting.image as unknown[]).length).toBeGreaterThan(0);
    for (const image of posting.image as string[]) expect(image).toMatch(/^https:\/\//);
  }
  if (expected.organizationId) {
    expect(posting.publisher).toEqual({ "@id": expected.organizationId });
  }
  for (const value of Object.values(posting)) {
    if (Array.isArray(value)) expect(value.length).toBeGreaterThan(0);
  }

  const crumbs = parsed.filter((node) => node["@type"] === "BreadcrumbList");
  expect(crumbs).toHaveLength(1);
  const items = crumbs[0].itemListElement as Array<{ position: number; item: string }>;
  expect(items.map((item) => item.position)).toEqual(items.map((_, index) => index + 1));
  expect(items.map((item) => item.item)).toEqual(expected.trail);
  for (const item of items) expect(item.item).toMatch(/^https:\/\//);
  expect(items.at(-1)?.item).toBe(expected.url);

  return posting;
};

const post = (locale: string, slug: string, fields: Partial<PostVO> = {}): PostVO =>
  ({
    id: `${locale}-${slug}`,
    locale,
    slug,
    path: locale === "en" ? `/blog/${slug}` : `/${locale}/blog/${slug}`,
    title: `Title ${locale}`,
    description: `Desc ${locale}`,
    seoTitle: null,
    seoDescription: null,
    coverImage: null,
    author: null,
    publishedAt: null,
    updatedAt: "2026-09-20T08:00:00.000Z",
    ...fields,
  }) as PostVO;

const resolverFor = (posts: PostVO[], options: { withSite?: boolean } = {}) =>
  createCmsPostResolver({
    integration: {
      buildCmsPath: paths.buildPath,
      parseCmsPath: paths.parsePath,
      isCmsContentForLocale: paths.isForLocale,
      getBusabaseBlogPostByPathOrFallback: async (path) =>
        posts.find((candidate) => candidate.path === path) ?? null,
    },
    localSource: { getPage: (): unknown => undefined },
    supportedLocales: ["en", "zh-CN", "ja"],
    defaultLocale: "en",
    jsonLdSite: options.withSite === false ? undefined : SITE,
    homeLabel: () => "Busabase",
    // Async on purpose: a real app loads its dictionary for the content locale first.
    blogLabel: async (locale) =>
      locale === "zh-CN" ? "博客" : locale === "ja" ? "ブログ" : "Blog",
  });

const WITH_COVER = post("en", "with-cover", {
  title: "With cover",
  coverImage: { url: "/uploads/cover.png" } as PostVO["coverImage"],
  author: "Kelly",
  publishedAt: "2026-09-01",
  updatedAt: "2026-09-10T12:00:00.000Z",
});
const BARE = post("en", "bare", { title: "Bare", description: null });
const ZH_ONLY = post("zh-CN", "zh-only", { title: "只有中文" });

describe("buildCmsPostJsonLd", () => {
  it("returns a BlogPosting + Home → Blog → Post breadcrumbs from plain values", () => {
    const nodes = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      description: "About X",
      lang: "en",
      image: "https://cdn.example.com/x.png",
      datePublished: "2026-09-01T00:00:00.000Z",
      author: "Kelly",
      breadcrumbs: [
        { name: "Busabase", url: "https://busabase.com" },
        { name: "Blog", url: "https://busabase.com/blog" },
        { name: "X", url: "https://busabase.com/blog/x" },
      ],
    });

    const posting = checkPostGraph(nodes, {
      url: "https://busabase.com/blog/x",
      lang: "en",
      organizationId: SITE.organizationId,
      trail: ["https://busabase.com", "https://busabase.com/blog", "https://busabase.com/blog/x"],
    });
    expect(posting).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "X",
      description: "About X",
      inLanguage: "en",
      datePublished: "2026-09-01T00:00:00.000Z",
      // Falls back to the publish date rather than claiming the post was never modified.
      dateModified: "2026-09-01T00:00:00.000Z",
      image: ["https://cdn.example.com/x.png"],
      author: { "@type": "Person", name: "Kelly" },
      publisher: { "@id": "https://busabase.com/#organization" },
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://busabase.com/blog/x" },
      url: "https://busabase.com/blog/x",
    });
  });

  it("omits every optional field it has no real value for, instead of emitting empties", () => {
    const [posting] = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      description: "",
      lang: "en",
      image: "",
      datePublished: null,
      dateModified: undefined,
      author: "  ",
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
  });

  it("normalizes dates: keeps ISO strings verbatim, serializes Date, drops non-dates", () => {
    const [fromDate] = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      lang: "en",
      // What fumadocs hands over for an unquoted YAML `date: 2026-02-09`.
      datePublished: new Date("2026-02-09T00:00:00.000Z"),
      dateModified: "last Tuesday",
    });
    expect(fromDate.datePublished).toBe("2026-02-09T00:00:00.000Z");
    expect(fromDate.dateModified).toBe("2026-02-09T00:00:00.000Z");

    const [fromString] = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      lang: "en",
      datePublished: "2026-09-01",
    });
    // Not re-serialized through Date, which would turn a calendar date into a UTC instant.
    expect(fromString.datePublished).toBe("2026-09-01");

    // A parseable but non-ISO string ("2026-09-01 10:00", RFC 2822) is re-serialized as ISO.
    const [loose] = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      lang: "en",
      datePublished: "Tue, 01 Sep 2026 10:00:00 GMT",
      dateModified: "2026-09-02 10:00:00Z",
    });
    expect(loose.datePublished).toBe("2026-09-01T10:00:00.000Z");
    expect(loose.dateModified).toBe("2026-09-02T10:00:00.000Z");
  });

  it("makes a root-relative cover absolute", () => {
    const [posting] = buildCmsPostJsonLd(SITE, {
      url: "https://busabase.com/blog/x",
      title: "X",
      lang: "en",
      image: "/uploads/x.png",
    });
    expect(posting.image).toEqual(["https://busabase.com/uploads/x.png"]);
  });

  it("inlines the publisher when the app has no Organization node to reference", () => {
    const [posting] = buildCmsPostJsonLd(
      { baseUrl: "https://previewfile.dev", siteName: "PreviewFile" },
      { url: "https://previewfile.dev/blog/x", title: "X", lang: "en" },
    );
    expect(posting.publisher).toEqual({
      "@type": "Organization",
      name: "PreviewFile",
      url: "https://previewfile.dev",
    });
  });

  it("leaves buildCmsArticleJsonLd an Article by default", () => {
    expect(
      buildCmsArticleJsonLd(SITE, { url: "https://busabase.com/x", title: "X", lang: "en" })[
        "@type"
      ],
    ).toBe("Article");
  });
});

describe("createCmsPostResolver — resolvePostJsonLd", () => {
  it("builds the post's graph at its canonical URL, cover and dates included", async () => {
    const resolver = resolverFor([WITH_COVER]);
    const nodes = await resolver.resolvePostJsonLd("en", "with-cover");

    const posting = checkPostGraph(nodes, {
      url: "https://busabase.com/blog/with-cover",
      lang: "en",
      organizationId: SITE.organizationId,
      trail: [
        "https://busabase.com",
        "https://busabase.com/blog",
        "https://busabase.com/blog/with-cover",
      ],
    });
    expect(posting).toMatchObject({
      headline: "With cover",
      image: ["https://busabase.com/uploads/cover.png"],
      datePublished: "2026-09-01",
      dateModified: "2026-09-10T12:00:00.000Z",
      author: { "@type": "Person", name: "Kelly" },
    });
    expect(nodes[1]).toMatchObject({
      itemListElement: [{ name: "Busabase" }, { name: "Blog" }, { name: "With cover" }],
    });
  });

  it("emits a valid graph for a post with no cover, publish date, author or description", async () => {
    const nodes = await resolverFor([BARE]).resolvePostJsonLd("en", "bare");

    const posting = checkPostGraph(nodes, {
      url: "https://busabase.com/blog/bare",
      lang: "en",
      organizationId: SITE.organizationId,
      trail: [
        "https://busabase.com",
        "https://busabase.com/blog",
        "https://busabase.com/blog/bare",
      ],
    });
    expect(posting).not.toHaveProperty("image");
    expect(posting).not.toHaveProperty("datePublished");
    expect(posting).not.toHaveProperty("author");
    expect(posting).not.toHaveProperty("description");
    // The record's own updated-at is still a true modification date.
    expect(posting.dateModified).toBe("2026-09-20T08:00:00.000Z");
  });

  it("describes the English original on a locale fallback — canonical URL, body language, English labels", async () => {
    const nodes = await resolverFor([WITH_COVER]).resolvePostJsonLd("ja", "with-cover");

    checkPostGraph(nodes, {
      url: "https://busabase.com/blog/with-cover",
      lang: "en",
      organizationId: SITE.organizationId,
      trail: [
        "https://busabase.com",
        "https://busabase.com/blog",
        "https://busabase.com/blog/with-cover",
      ],
    });
    expect(nodes[1]).toMatchObject({ itemListElement: [{}, { name: "Blog" }, {}] });
  });

  it("uses the locale-prefixed URLs and labels for a post that exists only in zh-CN", async () => {
    const nodes = await resolverFor([ZH_ONLY]).resolvePostJsonLd("zh-CN", "zh-only");

    checkPostGraph(nodes, {
      url: "https://busabase.com/zh-CN/blog/zh-only",
      lang: "zh-CN",
      organizationId: SITE.organizationId,
      trail: [
        "https://busabase.com/zh-CN",
        "https://busabase.com/zh-CN/blog",
        "https://busabase.com/zh-CN/blog/zh-only",
      ],
    });
    expect(nodes[1]).toMatchObject({
      itemListElement: [{}, { name: "博客" }, { name: "只有中文" }],
    });
    // Not served at the English URL — no fallback in that direction.
    expect(await resolverFor([ZH_ONLY]).resolvePostJsonLd("en", "zh-only")).toEqual([]);
  });

  it("emits nothing for an untranslated URL when the route 404s it (localeFallback: false)", async () => {
    const resolver = resolverFor([WITH_COVER]);
    expect(await resolver.resolvePostJsonLd("ja", "with-cover", { localeFallback: false })).toEqual(
      [],
    );
    expect(
      await resolver.resolvePostJsonLd("en", "with-cover", { localeFallback: false }),
    ).toHaveLength(2);
  });

  it("emits nothing when the app configured no jsonLdSite, or there is no post", async () => {
    expect(
      await resolverFor([WITH_COVER], { withSite: false }).resolvePostJsonLd("en", "with-cover"),
    ).toEqual([]);
    expect(await resolverFor([]).resolvePostJsonLd("en", "missing")).toEqual([]);
  });

  it("reads a local MDX post's frontmatter through the fumadocs shape", async () => {
    const data = {
      title: "Local",
      description: "From MDX",
      image: "/img/local.png",
      date: new Date("2026-02-03T00:00:00.000Z"),
      author: "Team",
    };
    const resolver = resolverFor([]);
    const nodes = await resolver.resolvePostJsonLdWithDependencies("en", "local", {
      getCmsPost: async () => null,
      getLocalPost: (locale) => (locale === "en" ? { data } : undefined),
    });

    const posting = checkPostGraph(nodes, {
      url: "https://busabase.com/blog/local",
      lang: "en",
      organizationId: SITE.organizationId,
      trail: [
        "https://busabase.com",
        "https://busabase.com/blog",
        "https://busabase.com/blog/local",
      ],
    });
    expect(posting).toMatchObject({
      headline: "Local",
      description: "From MDX",
      image: ["https://busabase.com/img/local.png"],
      datePublished: "2026-02-03T00:00:00.000Z",
      author: { "@type": "Person", name: "Team" },
    });
  });
});
