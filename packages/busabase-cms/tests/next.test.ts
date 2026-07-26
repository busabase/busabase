import { describe, expect, it } from "vitest";
import {
  buildCmsBlogSitemapEntries,
  buildCmsPageSitemapEntries,
  dedupeCmsSitemapEntries,
  resolveBusabaseCmsCacheKeyPrefix,
} from "../src/next";
import { createCmsPathHelpers } from "../src/routing";
import type { BusabaseCmsSource } from "../src/source";

describe("Next.js cache isolation", () => {
  it("includes the non-secret Busabase host and space in default cache keys", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          config: {
            baseUrl: "https://example.busabase.com/api/v1/",
            apiKey: "must-not-enter-cache-key",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual(["busabase-cms", "https://example.busabase.com", "space-a"]);
  });

  it("isolates Folder-managed CMS instances by Folder ID", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          folderId: "node-cms-folder",
          config: {
            baseUrl: "https://example.busabase.com",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual([
      "busabase-cms",
      "https://example.busabase.com",
      "space-a",
      "node-cms-folder",
      "standard",
    ]);
  });

  it("isolates different schema profiles for the same Folder", () => {
    expect(
      resolveBusabaseCmsCacheKeyPrefix(
        {
          folderId: "node-cms-folder",
          schemaProfile: "buda",
          config: {
            baseUrl: "https://example.busabase.com",
            spaceId: "space-a",
          },
        },
        {},
      ),
    ).toEqual([
      "busabase-cms",
      "https://example.busabase.com",
      "space-a",
      "node-cms-folder",
      "buda",
    ]);
  });

  it("requires an explicit namespace for custom sources", () => {
    const source = {} as BusabaseCmsSource;
    expect(() => resolveBusabaseCmsCacheKeyPrefix({ source }, {})).toThrow(
      "requires cache.keyPrefix",
    );
    expect(
      resolveBusabaseCmsCacheKeyPrefix({ source }, { keyPrefix: ["tenant-a", "cms"] }),
    ).toEqual(["tenant-a", "cms"]);
  });

  it("does not derive cache keys from secret API keys or custom headers", () => {
    expect(() => resolveBusabaseCmsCacheKeyPrefix({ config: { apiKey: "secret" } }, {})).toThrow(
      "target space cannot be represented without secrets",
    );
    expect(() =>
      resolveBusabaseCmsCacheKeyPrefix(
        { config: { headers: { "x-busabase-space": "hidden-space" } } },
        {},
      ),
    ).toThrow("target space cannot be represented without secrets");
  });
});

describe("CMS sitemap entries", () => {
  const helpers = createCmsPathHelpers({ supportedLocales: ["en", "zh-CN"], defaultLocale: "en" });
  const baseUrl = "https://example.com";

  it("only includes blog-namespaced, locale-matching posts", () => {
    const posts = [
      { locale: "en", path: "/blog/hello", updatedAt: "2026-01-01T00:00:00.000Z" },
      { locale: "en", path: "/use-cases/not-a-post" }, // not under /blog
      { locale: "zh-CN", path: "/blog/hello" }, // path defaults to "en" locale, mismatched
    ];
    const entries = buildCmsBlogSitemapEntries(posts, helpers, baseUrl);
    expect(entries).toEqual([
      expect.objectContaining({
        url: "https://example.com/blog/hello",
        changeFrequency: "weekly",
        priority: 0.7,
      }),
    ]);
  });

  it("supports a custom priority function derived from the item and its canonical path", () => {
    const posts = [
      { locale: "en", path: "/blog/buda-vs-manus" },
      { locale: "en", path: "/blog/hello" },
    ];
    const entries = buildCmsBlogSitemapEntries(posts, helpers, baseUrl, {
      priority: (_post, canonicalPath) => (canonicalPath.includes("-vs-") ? 0.8 : 0.7),
    });
    expect(entries.find((e) => e.url.endsWith("buda-vs-manus"))?.priority).toBe(0.8);
    expect(entries.find((e) => e.url.endsWith("/hello"))?.priority).toBe(0.7);
  });

  it("includes every valid-for-locale Page with no path-segment filter", () => {
    const pages = [
      { locale: "en", path: "/use-cases/a" },
      { locale: "zh-CN", path: "/zh-CN/use-cases/b" },
    ];
    const entries = buildCmsPageSitemapEntries(pages, helpers, baseUrl);
    expect(entries.map((e) => e.url)).toEqual([
      "https://example.com/use-cases/a",
      "https://example.com/zh-CN/use-cases/b",
    ]);
    expect(entries[0]).toMatchObject({ changeFrequency: "monthly", priority: 0.8 });
  });

  it("dedupes by URL (ignoring a trailing slash), keeping the first source's entry", () => {
    const first = [{ url: "https://example.com/blog/hello", priority: 0.9 } as never];
    const second = [{ url: "https://example.com/blog/hello/", priority: 0.1 } as never];
    const merged = dedupeCmsSitemapEntries(first, second);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ priority: 0.9 });
  });
});
