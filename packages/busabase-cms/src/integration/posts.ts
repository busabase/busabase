import "server-only";

import { cache } from "react";
import { readCmsOrFallback } from "../fallback";
import { type CmsCanonicalPath, normalizeCmsPath } from "../routing";
import type { PostVO } from "../types";
import type { CmsClientProvider } from "./client";

// ── Post reads ─────────────────────────────────────────────────────────────────

export interface CmsPostReads {
  /** Raw reads — throw when the integration is unconfigured. Prefer the `*OrFallback` variants. */
  listBusabaseBlogPosts: () => Promise<PostVO[]>;
  getBusabaseBlogPostByPath: (path: string) => Promise<PostVO | null>;
  listBusabaseBlogPostsOrFallback: () => Promise<PostVO[]>;
  getBusabaseBlogPostByPathOrFallback: (path: string) => Promise<PostVO | null>;
}

export const createCmsPostReads = (
  { getCms, requireCms }: CmsClientProvider,
  appLabel: string,
): CmsPostReads => ({
  listBusabaseBlogPosts: async () => requireCms().posts.list(),

  getBusabaseBlogPostByPath: async (path) => requireCms().posts.getByPath(path),

  listBusabaseBlogPostsOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.posts.list() : null,
      [],
      `list ${appLabel} blog posts`,
    );
  },

  getBusabaseBlogPostByPathOrFallback: async (path) => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.posts.getByPath(path) : null,
      null,
      `get ${appLabel} blog post ${path}`,
    );
  },
});

// ── Blog index cards ───────────────────────────────────────────────────────────

export interface BlogCardContent {
  url: string;
  title: string;
  description?: string;
  date?: string | Date;
  author?: string;
  image?: string;
}

/**
 * Merge Post card sources in priority order, using canonical paths as identity — the earliest
 * source to claim a path wins. Lets an app render CMS Posts and bundled MDX posts in one grid
 * without a CMS post and its local original showing up twice.
 */
export const mergeBlogCardsByPath = (
  ...sources: readonly BlogCardContent[][]
): BlogCardContent[] => {
  const byPath = new Map<string, BlogCardContent>();

  for (const source of sources) {
    for (const post of source) {
      const path = normalizeCmsPath(post.url);
      if (path && !byPath.has(path)) byPath.set(path, { ...post, url: path });
    }
  }

  return [...byPath.values()].sort(
    (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
  );
};

// ── Cross-locale Post detail resolution ────────────────────────────────────────

/**
 * Structural shape of the fumadocs `loader()` result the resolver needs. Typed structurally
 * (rather than importing an app's `~/lib/source`) so the SDK stays free of app internals;
 * `TPage` flows the app's own local-MDX page type through untouched.
 */
export interface LocalPostSourceLike<TPage> {
  getPage: (slugs: string[], locale: string) => TPage | undefined;
}

interface ResolvedCmsPostPageBase {
  requestedLocale: string;
  contentLocale: string;
  isLocaleFallback: boolean;
  canonicalPath: string;
}

export type ResolvedCmsPostPage<TPage> =
  | (ResolvedCmsPostPageBase & { source: "busabase"; content: PostVO })
  | (ResolvedCmsPostPageBase & { source: "local"; content: TPage });

export interface CmsPostResolverDependencies<TPage> {
  getCmsPost: (locale: string, slugs: string[]) => Promise<PostVO | null>;
  getLocalPost: (locale: string, slugs: string[]) => TPage | undefined;
}

/** The slice of a `CmsIntegration` the Post resolver depends on. */
export interface CmsPostResolverIntegration {
  buildCmsPath: (locale: string, path: string | readonly string[]) => string | null;
  parseCmsPath: (path: string) => CmsCanonicalPath | null;
  isCmsContentForLocale: (item: { locale: string; path: string }, locale: string) => boolean;
  getBusabaseBlogPostByPathOrFallback: (path: string) => Promise<PostVO | null>;
}

export interface CmsPostResolverOptions<TPage> {
  integration: CmsPostResolverIntegration;
  localSource: LocalPostSourceLike<TPage>;
}

export interface CmsPostResolver<TPage> {
  resolvePostPage: (
    requestedLocale: string,
    slugPath: string,
  ) => Promise<ResolvedCmsPostPage<TPage> | null>;
  resolvePostPageWithDependencies: (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
  ) => Promise<ResolvedCmsPostPage<TPage> | null>;
}

export const createCmsPostResolver = <TPage>({
  integration,
  localSource,
}: CmsPostResolverOptions<TPage>): CmsPostResolver<TPage> => {
  const { buildCmsPath, getBusabaseBlogPostByPathOrFallback, isCmsContentForLocale, parseCmsPath } =
    integration;

  const getCachedCmsPost = cache(async (locale: string, slugPath: string) => {
    const path = buildCmsPath(locale, ["blog", ...slugPath.split("/").filter(Boolean)]);
    const post = path ? await getBusabaseBlogPostByPathOrFallback(path) : null;
    return post && isCmsContentForLocale(post, locale) ? post : null;
  });

  const defaultDependencies: CmsPostResolverDependencies<TPage> = {
    getCmsPost: (locale, slugs) => getCachedCmsPost(locale, slugs.join("/")),
    getLocalPost: (locale, slugs) => localSource.getPage(slugs, locale),
  };

  const resolveForLocale = async (
    locale: string,
    slugs: string[],
    dependencies: CmsPostResolverDependencies<TPage>,
  ): Promise<
    | { source: "busabase"; content: PostVO; canonicalPath: string }
    | { source: "local"; content: TPage; canonicalPath: string }
    | null
  > => {
    const cmsPost = await dependencies.getCmsPost(locale, slugs);
    if (cmsPost) {
      const parsed = parseCmsPath(cmsPost.path);
      return {
        source: "busabase",
        content: cmsPost,
        canonicalPath: parsed?.pathWithoutLocale ?? `/blog/${slugs.join("/")}`,
      };
    }

    const localPost = dependencies.getLocalPost(locale, slugs);
    if (localPost) {
      return {
        source: "local",
        content: localPost,
        canonicalPath: `/blog/${slugs.join("/")}`,
      };
    }

    return null;
  };

  /**
   * Resolve a Post detail page at the requested locale, falling back to English when the
   * requested locale has no CMS or local-MDX content at that slug — a post not yet translated
   * falls back to English rather than 404ing.
   */
  const resolvePostPageWithDependencies = async (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
  ): Promise<ResolvedCmsPostPage<TPage> | null> => {
    const slugs = slugPath.split("/").filter(Boolean);
    const requested = await resolveForLocale(requestedLocale, slugs, dependencies);
    const resolved =
      requested ??
      (requestedLocale === "en" ? null : await resolveForLocale("en", slugs, dependencies));

    return resolved
      ? {
          ...resolved,
          requestedLocale,
          contentLocale: requested ? requestedLocale : "en",
          isLocaleFallback: !requested,
        }
      : null;
  };

  const resolvePostPageUncached = (requestedLocale: string, slugPath: string) =>
    resolvePostPageWithDependencies(requestedLocale, slugPath, defaultDependencies);

  // cache() dedupes the resolve call between the page component and generateMetadata for the
  // same request.
  const resolvePostPage = cache(resolvePostPageUncached);

  return { resolvePostPage, resolvePostPageWithDependencies };
};
