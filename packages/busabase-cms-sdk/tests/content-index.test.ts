import { afterEach, describe, expect, it, vi } from "vitest";
import type { BusabaseCmsOptions, BusabaseCmsRecord, BusabaseCmsSource } from "../src";
import { type CmsIndexRecord, createBusabaseCms, selectCmsIndexEntries } from "../src";
import { createCmsPathHelpers } from "../src/routing";

// The integration's cached client wraps `unstable_cache`, which needs a Next request context.
// Swap it for the uncached client over an in-memory source; `source` is set per test.
const state = vi.hoisted(() => ({ source: null as BusabaseCmsSource | null }));
vi.mock("../src/next", () => ({
  createCachedBusabaseCms: ({ config: _config, ...options }: BusabaseCmsOptions) => {
    if (!state.source) throw new Error("test source not set");
    return createBusabaseCms({ ...options, source: state.source });
  },
}));

import { createCmsIntegration } from "../src/integration";

const { parsePath } = createCmsPathHelpers({
  supportedLocales: ["en", "zh-CN", "ja"],
  defaultLocale: "en",
});

const record = (path: string, title: string, extra: Partial<CmsIndexRecord> = {}) =>
  ({
    path,
    title,
    locale: "en",
    canonicalUrl: null,
    seoDescription: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  }) satisfies CmsIndexRecord;

describe("selectCmsIndexEntries", () => {
  it("keeps one locale's own canonical records, in input order", () => {
    const entries = selectCmsIndexEntries(
      [
        record("/compare/busabase-vs-notion", "Busabase vs Notion", {
          seoDescription: "Notion records, Busabase holds.",
        }),
        record("/ja/compare/busabase-vs-notion", "Busabase と Notion", { locale: "ja" }),
        // Field locale and path locale disagree: not a valid English record.
        record("/zh-CN/compare/mislabelled", "Mislabelled"),
        // canonical-url names another page, so this record is a declared duplicate.
        record("/compare/notion-alt", "Duplicate", {
          canonicalUrl: "https://busabase.com/compare/busabase-vs-notion",
        }),
        // canonical-url naming itself (the normal CMS shape), with a trailing slash, is kept.
        record("/compare/busabase-vs-supabase", "Busabase vs Supabase", {
          canonicalUrl: "https://busabase.com/compare/busabase-vs-supabase/",
        }),
        // A canonical-url that is not a URL cannot name this page either.
        record("/compare/broken-canonical", "Broken", { canonicalUrl: "not a url" }),
        // Whitespace-only title: nothing to link with.
        record("/compare/untitled", "  \n "),
        // Same path twice: the first record wins.
        record("/compare/busabase-vs-notion", "Second copy"),
      ],
      { parsePath },
    );

    expect(entries).toEqual([
      {
        canonicalPath: "/compare/busabase-vs-notion",
        segments: ["compare", "busabase-vs-notion"],
        title: "Busabase vs Notion",
        description: "Notion records, Busabase holds.",
        publishedAt: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        canonicalPath: "/compare/busabase-vs-supabase",
        segments: ["compare", "busabase-vs-supabase"],
        title: "Busabase vs Supabase",
        description: null,
        publishedAt: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("lists another locale when asked, under its prefixed canonical path", () => {
    const entries = selectCmsIndexEntries(
      [record("/blog/a", "A"), record("/ja/blog/a", "A (ja)", { locale: "ja" })],
      { parsePath, locale: "ja" },
    );
    expect(entries.map((entry) => [entry.canonicalPath, entry.segments])).toEqual([
      ["/ja/blog/a", ["blog", "a"]],
    ]);
  });

  it("prefers the SEO description, then the description, verbatim", () => {
    const [seo, plain, blank] = selectCmsIndexEntries(
      [
        record("/blog/seo", "Seo", { seoDescription: " SEO\ntext ", description: "Plain" }),
        record("/blog/plain", "Plain", { seoDescription: "   ", description: "Plain\n text" }),
        record("/blog/blank", "Blank", { seoDescription: null, description: " " }),
      ],
      { parsePath },
    );
    expect(seo.description).toBe(" SEO\ntext ");
    expect(plain.description).toBe("Plain\n text");
    expect(blank.description).toBeNull();
  });

  it("carries the dates through", () => {
    const [entry] = selectCmsIndexEntries(
      [record("/blog/a", "A", { publishedAt: "2026-09-30", updatedAt: "2026-09-29T00:00:00Z" })],
      { parsePath },
    );
    expect(entry).toMatchObject({ publishedAt: "2026-09-30", updatedAt: "2026-09-29T00:00:00Z" });
  });
});

// ── createCmsIntegration().listCmsIndexEntriesOrFallback ─────────────────────────

const CMS_ENV = {
  BUSABASE_CMS_BASE_URL: "https://busabase.example",
  BUSABASE_CMS_API_KEY: "key",
  BUSABASE_CMS_SPACE_ID: "space-1",
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  state.source = null;
  vi.restoreAllMocks();
});

const cmsRecord = (id: string, payload: Record<string, unknown>): BusabaseCmsRecord =>
  ({
    id,
    status: "active",
    updatedAt: "2026-09-01T00:00:00.000Z",
    headCommit: { payload: { locale: "en", "schema-version": 1, body: "<p>x</p>", ...payload } },
  }) as unknown as BusabaseCmsRecord;

const sourceWith = (records: Record<string, BusabaseCmsRecord[]>): BusabaseCmsSource => ({
  getBaseBySlug: async (slug) => (records[slug] ? { id: slug, slug } : null),
  listRecordsPage: async ({ baseId }) => ({ records: records[baseId] ?? [], nextCursor: null }),
});

const integration = () =>
  createCmsIntegration({
    appLabel: "Test App",
    cacheNamespace: "test-app",
    supportedLocales: ["en", "ja"],
    defaultLocale: "en",
    schemaProfile: "standard",
    baseSlugs: { posts: "posts", pages: "pages", categories: "categories", tags: "tags" },
  });

describe("listCmsIndexEntriesOrFallback", () => {
  it("lists only published, English canonical Posts and Pages", async () => {
    Object.assign(process.env, CMS_ENV);
    state.source = sourceWith({
      posts: [
        cmsRecord("p1", {
          path: "/blog/hello",
          title: "Hello",
          slug: "hello",
          status: "published",
          description: "Hi there",
          "published-at": "2026-09-30",
        }),
        cmsRecord("p2", { path: "/blog/draft", title: "Draft", slug: "draft", status: "draft" }),
        cmsRecord("p3", {
          path: "/ja/blog/hello",
          title: "こんにちは",
          slug: "hello",
          status: "published",
          locale: "ja",
        }),
      ],
      pages: [
        cmsRecord("g1", {
          path: "/compare/a-vs-b",
          title: "A vs B",
          slug: "a-vs-b",
          status: "published",
          "seo-description": "Compared.",
        }),
        cmsRecord("g2", { path: "/compare/wip", title: "WIP", slug: "wip", status: "draft" }),
      ],
    });

    const { posts, pages } = await integration().listCmsIndexEntriesOrFallback();
    expect(
      posts.map((entry) => [entry.canonicalPath, entry.description, entry.publishedAt]),
    ).toEqual([["/blog/hello", "Hi there", "2026-09-30"]]);
    expect(pages.map((entry) => [entry.canonicalPath, entry.description])).toEqual([
      ["/compare/a-vs-b", "Compared."],
    ]);
  });

  it("is empty — without a request — when the CMS is not configured", async () => {
    for (const key of Object.keys(CMS_ENV)) delete process.env[key];
    await expect(integration().listCmsIndexEntriesOrFallback()).resolves.toEqual({
      posts: [],
      pages: [],
    });
  });

  it("is empty, not a throw, when the CMS is unreachable", async () => {
    Object.assign(process.env, CMS_ENV);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.source = {
      getBaseBySlug: async () => {
        throw new Error("offline");
      },
      listRecordsPage: async () => {
        throw new Error("offline");
      },
    };
    await expect(integration().listCmsIndexEntriesOrFallback()).resolves.toEqual({
      posts: [],
      pages: [],
    });
  });
});
