import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCmsCacheKeyPrefix,
  createCmsIntegration,
  mergeBlogCardsByPath,
  readCmsEnvConfig,
  resolveCmsCacheTags,
} from "../src/integration";

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
    expect(key.slice(0, 2)).toEqual(["busabase-cms", "productready"]);
    expect(key).not.toContain("secret");
    expect(key).toEqual([
      "busabase-cms",
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
});
