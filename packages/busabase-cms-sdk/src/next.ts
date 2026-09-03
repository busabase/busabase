import "server-only";

import { resolveConfig } from "busabase-sdk";
import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import {
  type BusabaseCms,
  type BusabaseCmsOptions,
  createBusabaseCms,
  DEFAULT_CATEGORIES_BASE_SLUG,
  DEFAULT_PAGES_BASE_SLUG,
  DEFAULT_POSTS_BASE_SLUG,
  DEFAULT_TAGS_BASE_SLUG,
} from "./content";
import type { CmsPathHelpers } from "./routing";

export interface BusabaseCmsCacheOptions {
  revalidate?: number | false;
  tags?: {
    posts?: string[];
    pages?: string[];
    categories?: string[];
    tags?: string[];
  };
  keyPrefix?: string[];
}

export const resolveBusabaseCmsCacheKeyPrefix = (
  options: BusabaseCmsOptions,
  cache: BusabaseCmsCacheOptions,
): string[] => {
  if (cache.keyPrefix && cache.keyPrefix.length > 0) return cache.keyPrefix;
  if (options.source || options.client) {
    throw new Error(
      "createCachedBusabaseCms requires cache.keyPrefix when using a custom source or client",
    );
  }

  const config = resolveConfig(options.config);
  if (config.headers || (config.apiKey && !config.spaceId)) {
    throw new Error(
      "createCachedBusabaseCms requires cache.keyPrefix when the target space cannot be represented without secrets",
    );
  }
  const schemaProfile = options.schemaProfile ?? "standard";
  return [
    "busabase-cms-sdk",
    config.baseUrl,
    config.spaceId ?? "default-space",
    // With a Folder id the Folder itself is the content identity — the four Bases live inside
    // it, so the slugs add nothing. WITHOUT one, the Base slugs ARE the only thing that
    // distinguishes two apps reading different Bases out of the same host + space; leaving them
    // out of the key made those apps silently share cache entries (cross-app contamination).
    ...(options.folderId
      ? [options.folderId, schemaProfile]
      : [
          "no-folder",
          schemaProfile,
          options.baseSlugs?.posts ?? DEFAULT_POSTS_BASE_SLUG,
          options.baseSlugs?.pages ?? DEFAULT_PAGES_BASE_SLUG,
          options.baseSlugs?.categories ?? DEFAULT_CATEGORIES_BASE_SLUG,
          options.baseSlugs?.tags ?? DEFAULT_TAGS_BASE_SLUG,
        ]),
  ];
};

export const createCachedBusabaseCms = (
  options: BusabaseCmsOptions = {},
  cache: BusabaseCmsCacheOptions = {},
): BusabaseCms => {
  const keyPrefix = resolveBusabaseCmsCacheKeyPrefix(options, cache);
  const cms = createBusabaseCms(options);
  const revalidate = cache.revalidate ?? 300;

  const cachedList = <T>(
    list: () => Promise<T[]>,
    kind: "posts" | "pages" | "categories" | "tags",
    slug: string,
  ) =>
    unstable_cache(list, [...keyPrefix, kind, slug], {
      revalidate,
      tags: cache.tags?.[kind] ?? [`busabase-cms:${kind}`],
    });

  const listPosts = cachedList(
    cms.posts.list,
    "posts",
    options.baseSlugs?.posts ?? DEFAULT_POSTS_BASE_SLUG,
  );
  const listPages = cachedList(
    cms.pages.list,
    "pages",
    options.baseSlugs?.pages ?? DEFAULT_PAGES_BASE_SLUG,
  );
  const listCategories = cachedList(
    cms.categories.list,
    "categories",
    options.baseSlugs?.categories ?? DEFAULT_CATEGORIES_BASE_SLUG,
  );
  const listTags = cachedList(
    cms.tags.list,
    "tags",
    options.baseSlugs?.tags ?? DEFAULT_TAGS_BASE_SLUG,
  );

  // Wrap the already-optimized single-record lookups (content.ts's getByPath/getBySlug —
  // a source.getRecordByField point lookup when available, list+find otherwise) in their
  // own cache entries, keyed per argument by unstable_cache. This keeps single-record reads
  // fast even on a cache miss (one indexed query beats paging through the whole Base) while
  // still avoiding a repeat Busabase round-trip for the same path within the revalidate window.
  const cachedGetByArg = <A extends string, T>(
    get: (arg: A) => Promise<T | null>,
    kind: "posts" | "pages" | "categories" | "tags",
    slug: string,
  ) =>
    unstable_cache(get, [...keyPrefix, kind, slug, "by-arg"], {
      revalidate,
      tags: cache.tags?.[kind] ?? [`busabase-cms:${kind}`],
    });

  return {
    posts: {
      list: listPosts,
      getByPath: cachedGetByArg(
        cms.posts.getByPath,
        "posts",
        options.baseSlugs?.posts ?? DEFAULT_POSTS_BASE_SLUG,
      ),
    },
    pages: {
      list: listPages,
      getByPath: cachedGetByArg(
        cms.pages.getByPath,
        "pages",
        options.baseSlugs?.pages ?? DEFAULT_PAGES_BASE_SLUG,
      ),
    },
    categories: {
      list: listCategories,
      getBySlug: cachedGetByArg(
        cms.categories.getBySlug,
        "categories",
        options.baseSlugs?.categories ?? DEFAULT_CATEGORIES_BASE_SLUG,
      ),
    },
    tags: {
      list: listTags,
      getBySlug: cachedGetByArg(
        cms.tags.getBySlug,
        "tags",
        options.baseSlugs?.tags ?? DEFAULT_TAGS_BASE_SLUG,
      ),
    },
  };
};

// ── Sitemap entries ────────────────────────────────────────────────────────────
// Every app rendering a sitemap from Post/Page VOs re-implemented the same
// parse-path/check-locale/map-to-entry/dedupe-by-url loop. One generic version here,
// parameterized by a CmsPathHelpers instance (see routing.ts) for the app's own locale
// config, plus optional per-item overrides for the couple of fields apps actually vary
// (e.g. a higher priority for "vs-" compare posts).

type MinimalCmsItem = { locale: string; path: string; updatedAt?: string };

export interface CmsSitemapEntryOptions<T extends MinimalCmsItem> {
  changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
  /** Static priority, or derive one per item from its own fields and canonical path. */
  priority?: number | ((item: T, canonicalPath: string) => number);
}

const validDateOr = (value: string | undefined, fallback: Date): Date => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const toCmsSitemapEntries = <T extends MinimalCmsItem>(
  items: readonly T[],
  helpers: CmsPathHelpers,
  baseUrl: string,
  isMatch: (canonicalPath: string) => boolean,
  { changeFrequency = "monthly", priority = 0.7 }: CmsSitemapEntryOptions<T>,
  fallbackDate: Date,
): MetadataRoute.Sitemap =>
  items.flatMap((item) => {
    const parsed = helpers.parsePath(item.path);
    if (!parsed || !isMatch(parsed.canonicalPath) || !helpers.isForLocale(item, parsed.locale)) {
      return [];
    }
    return [
      {
        url: `${baseUrl}${parsed.canonicalPath}`,
        lastModified: validDateOr(item.updatedAt, fallbackDate),
        changeFrequency,
        priority: typeof priority === "function" ? priority(item, parsed.canonicalPath) : priority,
      },
    ];
  });

/** Sitemap entries for Blog Posts — only paths under the `blog` segment are included. */
export const buildCmsBlogSitemapEntries = <T extends MinimalCmsItem>(
  posts: readonly T[],
  helpers: CmsPathHelpers,
  baseUrl: string,
  options: CmsSitemapEntryOptions<T> = {},
  fallbackDate = new Date(),
): MetadataRoute.Sitemap =>
  toCmsSitemapEntries(
    posts,
    helpers,
    baseUrl,
    (canonicalPath) => helpers.isBlogPostPath(canonicalPath),
    { changeFrequency: "weekly", priority: 0.7, ...options },
    fallbackDate,
  );

/** Sitemap entries for Pages — every valid-for-locale record is included, no path filter. */
export const buildCmsPageSitemapEntries = <T extends MinimalCmsItem>(
  pages: readonly T[],
  helpers: CmsPathHelpers,
  baseUrl: string,
  options: CmsSitemapEntryOptions<T> = {},
  fallbackDate = new Date(),
): MetadataRoute.Sitemap =>
  toCmsSitemapEntries(
    pages,
    helpers,
    baseUrl,
    () => true,
    { changeFrequency: "monthly", priority: 0.8, ...options },
    fallbackDate,
  );

/** Merge sitemap sources, keeping the first entry seen for any duplicate URL. */
export const dedupeCmsSitemapEntries = (
  ...sources: readonly MetadataRoute.Sitemap[]
): MetadataRoute.Sitemap => {
  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const source of sources) {
    for (const entry of source) {
      const key = entry.url.replace(/\/+$/, "") || entry.url;
      if (!byUrl.has(key)) byUrl.set(key, entry);
    }
  }
  return [...byUrl.values()];
};
