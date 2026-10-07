import "server-only";

import { cache } from "react";
import { readCmsOrFallback } from "../fallback";
import { buildCmsPostJsonLd, type CmsBreadcrumbItem, type CmsJsonLdSite } from "../jsonld";
import {
  buildCmsContentMetadataInput,
  type CmsContentMetadataInput,
  type LocalContentMetadataFields,
} from "../metadata";
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

/** A CMS Post as a Blog index card. */
export const cmsPostToBlogCard = (post: PostVO): BlogCardContent => ({
  url: post.path,
  title: post.title,
  description: post.description ?? undefined,
  date: post.publishedAt ?? post.updatedAt,
  author: post.author ?? undefined,
  image: post.coverImage?.url ?? undefined,
});

/** The frontmatter a local (fumadocs) Blog page may carry, read as a Blog index card. */
export interface LocalBlogCardPage {
  url: string;
  data: {
    title: string;
    description?: string;
    date?: string | Date;
    author?: string;
    image?: string;
  };
}

/** A local (fumadocs) Blog page as a Blog index card. */
export const localPageToBlogCard = (page: LocalBlogCardPage): BlogCardContent => ({
  url: page.url,
  title: page.data.title,
  description: page.data.description,
  date: page.data.date,
  author: page.data.author,
  image: page.data.image,
});

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

/**
 * What `resolvePostJsonLd` reads off a LOCAL (MDX) post beyond title/description/image. A
 * fumadocs YAML `date:` arrives as a `Date`, hence the union.
 */
export interface LocalPostJsonLdFields extends LocalContentMetadataFields {
  datePublished?: string | Date | null;
  dateModified?: string | Date | null;
  author?: string | null;
}

/** A breadcrumb label: a fixed string per locale, or an async lookup (e.g. loading a dictionary). */
export type CmsPostJsonLdLabel = (locale: string) => string | Promise<string>;

export interface CmsPostResolverOptions<TPage> {
  integration: CmsPostResolverIntegration;
  localSource: LocalPostSourceLike<TPage>;
  /**
   * The locales `getAvailablePostLocales` probes, in the order it returns them. Omitted, it
   * returns `[]` (the resolver alone needs no locale list).
   */
  supportedLocales?: readonly string[];
  /**
   * Opt in to fumadocs `fallbackLanguage` detection: a local page served at an untranslated
   * locale carries the same `data` as the default locale's page, so it is NOT counted as that
   * locale's own — neither when resolving (it becomes an explicit default-locale retry) nor when
   * listing available locales. Omitted, any page the local source returns counts as the
   * requested locale's own.
   */
  defaultLocale?: string;
  /**
   * Title/description/image of a LOCAL post, for `resolvePostMetadataInput`. Omitted, they are
   * read from the fumadocs page shape (`page.data.title` / `.description` / `.image`).
   */
  getLocalPostMetadata?: (page: TPage) => LocalContentMetadataFields;
  /**
   * Site identity for structured data. Supply it and `resolvePostJsonLd` returns the post's
   * `BlogPosting` + `BreadcrumbList`; omit it and that call returns `[]`, so an app that has not
   * opted in emits nothing rather than half-formed schema. Same option as the Page helpers'.
   */
  jsonLdSite?: CmsJsonLdSite;
  /** Breadcrumb root label, asked for in the CONTENT locale. Defaults to "Home". */
  homeLabel?: CmsPostJsonLdLabel;
  /** Breadcrumb label of the blog index, asked for in the CONTENT locale. Defaults to "Blog". */
  blogLabel?: CmsPostJsonLdLabel;
  /**
   * Dates/author/image of a LOCAL post, for `resolvePostJsonLd`. Omitted, they are read from the
   * fumadocs page shape (`page.data.date` / `.lastModified` / `.author`, plus the metadata fields).
   */
  getLocalPostJsonLdFields?: (page: TPage) => LocalPostJsonLdFields;
}

export interface ResolvePostMetadataInputOptions {
  /**
   * Retry at English when the requested locale has no post (the same cascade as
   * `resolvePostPage`). Default `true`. Pass `false` for a route that 404s untranslated URLs
   * instead of serving the English original, so its metadata matches what it renders.
   */
  localeFallback?: boolean;
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
  /**
   * The locales a Post really exists in — its own CMS Post or its own local file, never the
   * fumadocs fallback — for the hreflang set (`generatePageMetadata({ availableLocales })`).
   *
   * One strict point lookup per locale, not `posts.list()`: the list carries every post body
   * and is too large for Next's data cache, while the per-path reads are small and cached.
   *
   * `contentLocale` — the locale that produced the page being rendered — is always kept and
   * never probed: a CMS outage makes the reads return null (or throw, which counts as "not
   * proven"), and an empty set would strip the page's own self-reference. Pass `null` to
   * probe every locale.
   */
  getAvailablePostLocales: (slugPath: string, contentLocale: string | null) => Promise<string[]>;
  getAvailablePostLocalesWithDependencies: (
    slugPath: string,
    contentLocale: string | null,
    dependencies: CmsPostResolverDependencies<TPage>,
  ) => Promise<string[]>;
  /**
   * Everything a Post route's `generateMetadata` needs, in ONE call: resolves the post (same
   * cascade and cache as `resolvePostPage`), probes which locales really have it
   * (`getAvailablePostLocales`), and returns the SEO fields — including `absoluteTitle`, the
   * rule that an editor's `seo-title` bypasses the app's title template. `null` when there is
   * no post to render.
   *
   * The field names match the app metadata helper's options, so a route is just
   * `generateContentPageMetadata({ ...input, type: "article" })`. Requires `supportedLocales`
   * on the resolver; without it `availableLocales` is only the content locale.
   */
  resolvePostMetadataInput: (
    requestedLocale: string,
    slugPath: string,
    options?: ResolvePostMetadataInputOptions,
  ) => Promise<CmsContentMetadataInput | null>;
  resolvePostMetadataInputWithDependencies: (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
    options?: ResolvePostMetadataInputOptions,
  ) => Promise<CmsContentMetadataInput | null>;
  /**
   * The JSON-LD nodes for a Post route, in ONE call — the Post counterpart of the Page helpers'
   * `buildCmsPageJsonLd`: a `BlogPosting` plus a Home → Blog → Post `BreadcrumbList`, ready for
   * `<CmsJsonLd nodes={...} />`. Same resolution (and request cache) as `resolvePostPage` /
   * `resolvePostMetadataInput`, so the three always describe the same post.
   *
   * Every URL is the CANONICAL one: on a locale fallback (`/ja/blog/x` serving the English
   * original) the post's `url`/`mainEntityOfPage` point at the English URL and `inLanguage` is
   * the language of the body, never the requested locale — matching the canonical link the
   * metadata emits. `[]` when there is no post or no `jsonLdSite` was configured.
   */
  resolvePostJsonLd: (
    requestedLocale: string,
    slugPath: string,
    options?: ResolvePostMetadataInputOptions,
  ) => Promise<Array<Record<string, unknown>>>;
  resolvePostJsonLdWithDependencies: (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
    options?: ResolvePostMetadataInputOptions,
  ) => Promise<Array<Record<string, unknown>>>;
}

/** fumadocs' page shape: `{ data: { title, description, image } }`. */
const readFumadocsPostMetadata = (page: unknown): LocalContentMetadataFields => {
  const data = (page as { data?: Record<string, unknown> } | undefined)?.data ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return { title: text(data.title), description: text(data.description), image: text(data.image) };
};

/** fumadocs' page shape, plus the frontmatter a post's structured data needs. */
const readFumadocsPostJsonLdFields = (page: unknown): LocalPostJsonLdFields => {
  const data = (page as { data?: Record<string, unknown> } | undefined)?.data ?? {};
  const date = (value: unknown) =>
    typeof value === "string" || value instanceof Date ? value : undefined;
  return {
    ...readFumadocsPostMetadata(page),
    datePublished: date(data.date),
    dateModified: date(data.lastModified),
    author: typeof data.author === "string" ? data.author : undefined,
  };
};

export const createCmsPostResolver = <TPage>({
  integration,
  localSource,
  supportedLocales = [],
  defaultLocale,
  getLocalPostMetadata = readFumadocsPostMetadata,
  jsonLdSite,
  homeLabel = () => "Home",
  blogLabel = () => "Blog",
  getLocalPostJsonLdFields = readFumadocsPostJsonLdFields,
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

  // A page served at an untranslated locale is the default-locale file (fumadocs'
  // `fallbackLanguage`), so only a distinct `data` object is a real translation.
  const hasOwnLocalPost = (
    locale: string,
    slugs: string[],
    dependencies: CmsPostResolverDependencies<TPage>,
  ) => {
    const page = dependencies.getLocalPost(locale, slugs);
    if (!page) return false;
    if (!defaultLocale || locale === defaultLocale) return true;
    const fallback = dependencies.getLocalPost(defaultLocale, slugs);
    return (page as { data?: unknown }).data !== (fallback as { data?: unknown } | undefined)?.data;
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

    // fumadocs' `fallbackLanguage` hands back the English file for an untranslated locale; that
    // is not "this locale has the post", so it must reach the explicit English retry below.
    const localPost = hasOwnLocalPost(locale, slugs, dependencies)
      ? dependencies.getLocalPost(locale, slugs)
      : undefined;
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

  const getAvailablePostLocalesWithDependencies = async (
    slugPath: string,
    contentLocale: string | null,
    dependencies: CmsPostResolverDependencies<TPage>,
  ): Promise<string[]> => {
    const slugs = slugPath.split("/").filter(Boolean);
    const probes = await Promise.all(
      supportedLocales.map(async (locale) => {
        if (locale === contentLocale) return true;
        try {
          if (await dependencies.getCmsPost(locale, slugs)) return true;
        } catch {
          // A failed read counts as "not proven to exist".
        }
        return hasOwnLocalPost(locale, slugs, dependencies);
      }),
    );
    return supportedLocales.filter((_, index) => probes[index]);
  };

  const getAvailablePostLocales = cache((slugPath: string, contentLocale: string | null) =>
    getAvailablePostLocalesWithDependencies(slugPath, contentLocale, defaultDependencies),
  );

  const toMetadataInput = (
    resolved: ResolvedCmsPostPage<TPage>,
    availableLocales: readonly string[],
  ): CmsContentMetadataInput =>
    buildCmsContentMetadataInput({
      requestedLocale: resolved.requestedLocale,
      contentLocale: resolved.contentLocale,
      canonicalPath: resolved.canonicalPath,
      availableLocales,
      cms: resolved.source === "busabase" ? resolved.content : null,
      local: resolved.source === "local" ? getLocalPostMetadata(resolved.content) : null,
    });

  // Without the English retry: only the requested locale's own post counts.
  const resolveExactLocale = async (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
  ): Promise<ResolvedCmsPostPage<TPage> | null> => {
    const found = await resolveForLocale(
      requestedLocale,
      slugPath.split("/").filter(Boolean),
      dependencies,
    );
    return found
      ? { ...found, requestedLocale, contentLocale: requestedLocale, isLocaleFallback: false }
      : null;
  };

  const resolvePostMetadataInputWithDependencies = async (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
    { localeFallback = true }: ResolvePostMetadataInputOptions = {},
  ): Promise<CmsContentMetadataInput | null> => {
    const resolved = localeFallback
      ? await resolvePostPageWithDependencies(requestedLocale, slugPath, dependencies)
      : await resolveExactLocale(requestedLocale, slugPath, dependencies);
    if (!resolved) return null;
    const availableLocales = await getAvailablePostLocalesWithDependencies(
      slugPath,
      resolved.contentLocale,
      dependencies,
    );
    return toMetadataInput(resolved, availableLocales);
  };

  const resolvePostMetadataInput = async (
    requestedLocale: string,
    slugPath: string,
    { localeFallback = true }: ResolvePostMetadataInputOptions = {},
  ): Promise<CmsContentMetadataInput | null> => {
    // Reuse the request-cached reads so the page body and generateMetadata share them.
    const resolved = localeFallback
      ? await resolvePostPage(requestedLocale, slugPath)
      : await resolveExactLocale(requestedLocale, slugPath, defaultDependencies);
    if (!resolved) return null;
    return toMetadataInput(
      resolved,
      await getAvailablePostLocales(slugPath, resolved.contentLocale),
    );
  };

  // The locale-prefixed URL of a path in `locale` — the same rule the canonical link uses
  // (default locale unprefixed). `null` when the app cannot form that path at all.
  const absoluteUrlFor = (baseUrl: string, locale: string, path: string): string | null => {
    const localized = buildCmsPath(locale, path.replace(/^\/+/, ""));
    return localized ? `${baseUrl}${localized}` : null;
  };

  const toJsonLd = async (
    resolved: ResolvedCmsPostPage<TPage>,
  ): Promise<Array<Record<string, unknown>>> => {
    if (!jsonLdSite) return [];
    const { baseUrl } = jsonLdSite;
    // The language of the BODY: on a fallback this is English even though the visitor asked
    // for another locale, and the canonical URL is the English one.
    const locale = resolved.contentLocale;
    const url = absoluteUrlFor(baseUrl, locale, resolved.canonicalPath);
    if (!url) return [];

    const fields: LocalPostJsonLdFields =
      resolved.source === "busabase"
        ? {
            title: resolved.content.title,
            description: resolved.content.description ?? resolved.content.seoDescription,
            image: resolved.content.coverImage?.url,
            datePublished: resolved.content.publishedAt,
            dateModified: resolved.content.updatedAt,
            author: resolved.content.author,
          }
        : getLocalPostJsonLdFields(resolved.content);
    const title = fields.title ?? "";

    const [home, blog] = await Promise.all([homeLabel(locale), blogLabel(locale)]);
    // A locale root is not a content path, so `buildCmsPath` cannot form it; its prefix is
    // whatever the blog index URL carries in front of `/blog` ("" for the default locale).
    const blogIndexUrl = absoluteUrlFor(baseUrl, locale, "/blog");
    const homeUrl = blogIndexUrl ? blogIndexUrl.slice(0, -"/blog".length) || baseUrl : baseUrl;
    const breadcrumbs: CmsBreadcrumbItem[] = [{ name: home, url: homeUrl }];
    if (blogIndexUrl) breadcrumbs.push({ name: blog, url: blogIndexUrl });
    breadcrumbs.push({ name: title, url });

    return buildCmsPostJsonLd(jsonLdSite, {
      url,
      title,
      description: fields.description,
      lang: locale,
      image: fields.image,
      datePublished: fields.datePublished,
      dateModified: fields.dateModified,
      author: fields.author,
      breadcrumbs,
    });
  };

  const resolvePostJsonLdWithDependencies = async (
    requestedLocale: string,
    slugPath: string,
    dependencies: CmsPostResolverDependencies<TPage>,
    { localeFallback = true }: ResolvePostMetadataInputOptions = {},
  ): Promise<Array<Record<string, unknown>>> => {
    if (!jsonLdSite) return [];
    const resolved = localeFallback
      ? await resolvePostPageWithDependencies(requestedLocale, slugPath, dependencies)
      : await resolveExactLocale(requestedLocale, slugPath, dependencies);
    return resolved ? toJsonLd(resolved) : [];
  };

  const resolvePostJsonLd = async (
    requestedLocale: string,
    slugPath: string,
    { localeFallback = true }: ResolvePostMetadataInputOptions = {},
  ): Promise<Array<Record<string, unknown>>> => {
    if (!jsonLdSite) return [];
    // Reuse the request-cached resolve so the page body, metadata and JSON-LD share one read.
    const resolved = localeFallback
      ? await resolvePostPage(requestedLocale, slugPath)
      : await resolveExactLocale(requestedLocale, slugPath, defaultDependencies);
    return resolved ? toJsonLd(resolved) : [];
  };

  return {
    resolvePostPage,
    resolvePostPageWithDependencies,
    getAvailablePostLocales,
    getAvailablePostLocalesWithDependencies,
    resolvePostMetadataInput,
    resolvePostMetadataInputWithDependencies,
    resolvePostJsonLd,
    resolvePostJsonLdWithDependencies,
  };
};
