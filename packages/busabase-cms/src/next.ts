import "server-only";

import { resolveConfig } from "busabase-sdk";
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
  return [
    "busabase-cms",
    config.baseUrl,
    config.spaceId ?? "default-space",
    ...(options.folderId ? [options.folderId, options.schemaProfile ?? "standard"] : []),
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

  return {
    posts: {
      list: listPosts,
      getByPath: async (path) => (await listPosts()).find((post) => post.path === path) ?? null,
    },
    pages: {
      list: listPages,
      getByPath: async (path) => (await listPages()).find((page) => page.path === path) ?? null,
    },
    categories: {
      list: listCategories,
      getBySlug: async (slug) =>
        (await listCategories()).find((category) => category.slug === slug) ?? null,
    },
    tags: {
      list: listTags,
      getBySlug: async (slug) => (await listTags()).find((tag) => tag.slug === slug) ?? null,
    },
  };
};
