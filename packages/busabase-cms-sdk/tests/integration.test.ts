import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCmsCacheKeyPrefix,
  cmsPostToBlogCard,
  cmsPostToBlogCardWithTags,
  createCmsIntegration,
  hasOwnLocalPage,
  localFrontmatterTags,
  localPageToBlogCard,
  mergeBlogCardsByPath,
  readCmsEnvConfig,
  resolveCmsCacheTags,
  resolveCmsPostTags,
} from "../src/integration";
import type { PostVO, TagVO } from "../src/types";

const APP_SLUGS = {
  posts: "productready-blog-posts",
  pages: "productready-landing-pages",
  categories: "productready-categories",
  tags: "productready-tags",
};

const CMS_ENV_KEYS = [
  "BUSABASE_CMS_BASE_URL",
  "BUSABASE_CMS_API_KEY",
  "BUSABASE_CMS_SPACE_ID",
  "BUSABASE_CMS_FOLDER_ID",
  "BUSABASE_CMS_POSTS_BASE_SLUG",
  "BUSABASE_CMS_PAGES_BASE_SLUG",
  "BUSABASE_CMS_CATEGORIES_BASE_SLUG",
  "BUSABASE_CMS_TAGS_BASE_SLUG",
] as const;

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("BUSABASE_CMS_* env gate", () => {
  it("treats a partial configuration as off rather than as a failing read", () => {
    expect(
      readCmsEnvConfig(APP_SLUGS, { BUSABASE_CMS_BASE_URL: "https://busabase.example" }),
    ).toBeNull();
    expect(
      readCmsEnvConfig(APP_SLUGS, {
        BUSABASE_CMS_BASE_URL: "https://busabase.example",
        BUSABASE_CMS_API_KEY: "key",
      }),
    ).toBeNull();
    // Whitespace-only values are not a configuration either.
    expect(
      readCmsEnvConfig(APP_SLUGS, {
        BUSABASE_CMS_BASE_URL: "https://busabase.example",
        BUSABASE_CMS_API_KEY: "key",
        BUSABASE_CMS_SPACE_ID: "   ",
      }),
    ).toBeNull();
  });

  it("falls back to the app's own Base slugs and lets each be overridden per deploy", () => {
    expect(
      readCmsEnvConfig(APP_SLUGS, {
        BUSABASE_CMS_BASE_URL: " https://busabase.example ",
        BUSABASE_CMS_API_KEY: "key",
        BUSABASE_CMS_SPACE_ID: "space-1",
        BUSABASE_CMS_POSTS_BASE_SLUG: "override-posts",
      }),
    ).toEqual({
      baseUrl: "https://busabase.example",
      apiKey: "key",
      spaceId: "space-1",
      folderId: null,
      baseSlugs: {
        posts: "override-posts",
        pages: "productready-landing-pages",
        categories: "productready-categories",
        tags: "productready-tags",
      },
    });
  });
});

describe("cache identity", () => {
  const resolved = {
    baseUrl: "https://busabase.example",
    apiKey: "secret",
    spaceId: "space-1",
    folderId: null,
    baseSlugs: APP_SLUGS,
  };

  it("puts the app namespace first and never leaks the API key", () => {
    const key = buildCmsCacheKeyPrefix(
      { cacheNamespace: "productready", schemaProfile: "productready" },
      resolved,
    );
    expect(key.slice(0, 2)).toEqual(["busabase-cms-sdk", "productready"]);
    expect(key).not.toContain("secret");
    expect(key).toEqual([
      "busabase-cms-sdk",
      "productready",
      "https://busabase.example",
      "space-1",
      "no-folder",
      "productready",
      "productready-blog-posts",
      "productready-landing-pages",
      "productready-categories",
      "productready-tags",
    ]);
  });

  it("separates two apps reading the very same Bases in the same space", () => {
    expect(
      buildCmsCacheKeyPrefix({ cacheNamespace: "a", schemaProfile: "standard" }, resolved),
    ).not.toEqual(
      buildCmsCacheKeyPrefix({ cacheNamespace: "b", schemaProfile: "standard" }, resolved),
    );
  });

  it("defaults revalidateTag targets to the app namespace", () => {
    expect(resolveCmsCacheTags({ cacheNamespace: "sandock-cloud" })).toEqual({
      posts: ["sandock-cloud:cms-posts"],
      pages: ["sandock-cloud:cms-pages"],
      categories: ["sandock-cloud:cms-categories"],
      tags: ["sandock-cloud:cms-tags"],
    });
    expect(
      resolveCmsCacheTags({ cacheNamespace: "sandock-cloud", cache: { tags: { posts: ["x"] } } })
        .posts,
    ).toEqual(["x"]);
  });
});

describe("createCmsIntegration", () => {
  const integration = () =>
    createCmsIntegration({
      appLabel: "ProductReady",
      cacheNamespace: "productready",
      supportedLocales: ["en", "zh-CN", "ja"],
      defaultLocale: "en",
      schemaProfile: "productready",
      baseSlugs: APP_SLUGS,
    });

  it("is off, and reads nothing, when the env vars are unset", async () => {
    for (const key of CMS_ENV_KEYS) delete process.env[key];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cms = integration();

    expect(cms.isBusabaseCmsEnabled()).toBe(false);
    expect(cms.getCmsConfig()).toBeNull();
    // "off means off": the fallback reads must not attempt a request, and must not warn.
    await expect(cms.listBusabaseBlogPostsOrFallback()).resolves.toEqual([]);
    await expect(cms.listBusabaseLandingPagesOrFallback()).resolves.toEqual([]);
    await expect(cms.listBusabaseCategoriesOrFallback()).resolves.toEqual([]);
    await expect(cms.listBusabaseTagsOrFallback()).resolves.toEqual([]);
    await expect(cms.getBusabaseBlogPostByPathOrFallback("/blog/hi")).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("names the app in the error raised by the non-fallback reads", async () => {
    for (const key of CMS_ENV_KEYS) delete process.env[key];
    await expect(integration().listBusabaseBlogPosts()).rejects.toThrow(
      "[busabase-cms] ProductReady",
    );
  });

  it("binds the canonical-path helpers to the app's own locale config", () => {
    const cms = integration();
    expect(cms.buildCmsPath("en", ["blog", "hello"])).toBe("/blog/hello");
    expect(cms.buildCmsPath("zh-CN", ["blog", "hello"])).toBe("/zh-CN/blog/hello");
    expect(cms.buildCmsPath("de", ["blog", "hello"])).toBeNull();
    expect(cms.isCmsContentForLocale({ locale: "en", path: "/zh-CN/blog/hello" }, "en")).toBe(
      false,
    );
  });
});

describe("mergeBlogCardsByPath", () => {
  it("keeps the first source to claim a canonical path and sorts newest first", () => {
    const merged = mergeBlogCardsByPath(
      [{ url: "/blog/hello/", title: "CMS", date: "2026-01-01" }],
      [
        { url: "/blog/hello", title: "Local duplicate", date: "2026-05-01" },
        { url: "/blog/newer", title: "Local only", date: "2026-06-01" },
      ],
    );

    expect(merged.map((post) => [post.url, post.title])).toEqual([
      ["/blog/newer", "Local only"],
      ["/blog/hello", "CMS"],
    ]);
  });

  it("prefers sources in argument order across three sources and dedupes normalized paths", () => {
    const posts = mergeBlogCardsByPath(
      [{ url: "/blog/shared/", title: "CMS", date: "2026-07-21" }],
      [
        { url: "/blog/shared", title: "Local duplicate" },
        { url: "/zh-CN/blog/local", title: "Local" },
      ],
      [
        { url: "/blog/shared", title: "WordPress duplicate" },
        { url: "/blog/wordpress", title: "WordPress" },
      ],
    );

    expect(posts.map((post) => [post.url, post.title])).toEqual([
      ["/blog/shared", "CMS"],
      ["/zh-CN/blog/local", "Local"],
      ["/blog/wordpress", "WordPress"],
    ]);
  });

  it("drops invalid paths instead of allowing them to shadow valid content", () => {
    expect(mergeBlogCardsByPath([{ url: "not-a-path", title: "Invalid" }])).toEqual([]);
  });
});

describe("Blog card mappers", () => {
  it("reads a CMS Post and a local page into the same card shape", () => {
    expect(
      cmsPostToBlogCard({
        path: "/blog/a",
        title: "A",
        description: null,
        publishedAt: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
        author: "Ann",
        coverImage: { url: "https://cdn.test/a.png" },
      } as unknown as Parameters<typeof cmsPostToBlogCard>[0]),
    ).toEqual({
      url: "/blog/a",
      title: "A",
      description: undefined,
      date: "2026-09-01T00:00:00.000Z",
      author: "Ann",
      image: "https://cdn.test/a.png",
    });
    expect(
      localPageToBlogCard({ url: "/blog/b", data: { title: "B", date: "2026-08-01" } }),
    ).toEqual({
      url: "/blog/b",
      title: "B",
      description: undefined,
      date: "2026-08-01",
      author: undefined,
      image: undefined,
    });
  });
});

describe("Blog tags", () => {
  const tag = (id: string, name: string, slug: string, locale = "en"): TagVO => ({
    id,
    name,
    slug,
    locale,
    description: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    rawFields: {},
  });
  const tags = [
    tag("t-mcp", "MCP", "mcp"),
    tag("t-dev", "Developer Tools", "developer-tools"),
    tag("t-ja", "開発ツール", "developer-tools", "ja"),
  ];
  const post = (tagIds: string[], locale = "en") =>
    ({
      path: locale === "en" ? "/blog/a" : `/${locale}/blog/a`,
      title: "A",
      description: null,
      publishedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      author: null,
      coverImage: null,
      locale,
      tagIds,
    }) as unknown as PostVO;
  const href = (record: TagVO) =>
    `${record.locale === "en" ? "" : `/${record.locale}`}/blog/tag/${record.slug}`;

  it("maps a local page's frontmatter tags to plain chips (no taxonomy, so no link)", () => {
    expect(
      localPageToBlogCard({
        url: "/blog/b",
        data: { title: "B", tags: ["Product Thinking", " MCP ", "MCP", "", "Developer Tools"] },
      }).tags,
    ).toEqual([{ name: "Product Thinking" }, { name: "MCP" }, { name: "Developer Tools" }]);
    expect(localFrontmatterTags("MCP")).toEqual([]);
    expect(localFrontmatterTags([1, "MCP", null])).toEqual([{ name: "MCP" }]);
  });

  it("leaves `tags` off an untagged card, so it is the same card as before", () => {
    expect(localPageToBlogCard({ url: "/blog/b", data: { title: "B" } })).not.toHaveProperty(
      "tags",
    );
    expect(
      localPageToBlogCard({ url: "/blog/b", data: { title: "B", tags: [] } }),
    ).not.toHaveProperty("tags");
    expect(cmsPostToBlogCardWithTags(tags)(post([]))).not.toHaveProperty("tags");
    expect(cmsPostToBlogCardWithTags(tags)(post(["t-gone"]))).not.toHaveProperty("tags");
  });

  it("resolves a CMS Post's tag relation against the Tags records, in the Post's order", () => {
    expect(cmsPostToBlogCardWithTags(tags)(post(["t-dev", "t-gone", "t-mcp"]))).toEqual({
      ...cmsPostToBlogCard(post([])),
      tags: [{ name: "Developer Tools" }, { name: "MCP" }],
    });
  });

  it("links a tag to its archive only when given an href builder and the locales match", () => {
    expect(resolveCmsPostTags(post(["t-mcp", "t-dev"]), tags, href)).toEqual([
      { name: "MCP", href: "/blog/tag/mcp" },
      { name: "Developer Tools", href: "/blog/tag/developer-tools" },
    ]);
    // The ja archive lists only ja Posts, so an en Post's link to it would not list this Post.
    expect(resolveCmsPostTags(post(["t-ja"]), tags, href)).toEqual([{ name: "開発ツール" }]);
    expect(resolveCmsPostTags(post(["t-ja"], "ja"), tags, href)).toEqual([
      { name: "開発ツール", href: "/ja/blog/tag/developer-tools" },
    ]);
    // No archive route (or it cannot form a path) → plain chips.
    expect(resolveCmsPostTags(post(["t-mcp"]), tags)).toEqual([{ name: "MCP" }]);
    expect(resolveCmsPostTags(post(["t-mcp"]), tags, () => null)).toEqual([{ name: "MCP" }]);
    // The Tags read failed (fallback `[]`) → no tags at all, never raw ids.
    expect(resolveCmsPostTags(post(["t-mcp"]), [], href)).toEqual([]);
  });
});

describe("hasOwnLocalPage", () => {
  const en = { data: { title: "EN" } };
  const ja = { data: { title: "JA" } };
  const pages: Record<string, typeof en | undefined> = { en, ja, "zh-CN": en };
  const getPage = (locale: string) => pages[locale];

  it("counts only a distinct data object as a real translation", () => {
    expect(hasOwnLocalPage(getPage, "en", ["privacy"], "en")).toBe(true);
    expect(hasOwnLocalPage(getPage, "ja", ["privacy"], "en")).toBe(true);
    expect(hasOwnLocalPage(getPage, "zh-CN", ["privacy"], "en")).toBe(false);
    expect(hasOwnLocalPage(getPage, "ko", ["privacy"], "en")).toBe(false);
  });

  it("counts any returned page without a default locale", () => {
    expect(hasOwnLocalPage(getPage, "zh-CN", ["privacy"])).toBe(true);
  });
});
