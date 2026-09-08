import "server-only";

import {
  type CategoryVO,
  type CmsTaxonomyKind,
  createBusabaseCmsSourceFromConfig,
  createCmsPathHelpers,
  filterCmsPostsByTaxonomy,
  type PageVO,
  type PostVO,
  type TagVO,
} from "busabase-cms-sdk";
import { createCachedBusabaseCms } from "busabase-cms-sdk/next";

const defaultLocale = process.env.BUSABASE_CMS_DEFAULT_LOCALE?.trim() || "en";
const configuredLocales = (process.env.BUSABASE_CMS_LOCALES ?? "en,zh-CN")
  .split(",")
  .map((locale) => locale.trim())
  .filter(Boolean);

export const cmsPathOptions = {
  supportedLocales: [...new Set([defaultLocale, ...configuredLocales])],
  defaultLocale,
} as const;

const cmsPathHelpers = createCmsPathHelpers(cmsPathOptions);

// A self-hosted Busabase server can be read without an API key or space header.
//
// These use the same `BUSABASE_CMS_*` names as the rest of this file and as
// `busabase-cms`'s own `readCmsEnvConfig` gate. The SDK additionally falls back
// to unprefixed `BUSABASE_*` vars, but a CMS app reading half its config under
// one prefix and half under another is how you lose an afternoon.
const isConfigured = Boolean(
  process.env.BUSABASE_CMS_BASE_URL && process.env.BUSABASE_CMS_FOLDER_ID,
);
const busabaseConfig = {
  baseUrl: process.env.BUSABASE_CMS_BASE_URL,
  apiKey: process.env.BUSABASE_CMS_API_KEY,
  spaceId: process.env.BUSABASE_CMS_SPACE_ID,
};

const cms = isConfigured
  ? createCachedBusabaseCms(
      {
        config: busabaseConfig,
        folderId: process.env.BUSABASE_CMS_FOLDER_ID,
        lazyCreate: true,
        schemaProfile: "standard",
        invalidRecords: "skip",
        onInvalidRecord: (issue) => {
          console.warn("[busabase-cms] Skipped an invalid record", issue);
        },
      },
      {
        revalidate: 300,
        keyPrefix: ["busabase-example"],
        tags: {
          posts: ["busabase-cms-posts"],
          pages: ["busabase-cms-pages"],
          categories: ["busabase-cms-categories"],
          tags: ["busabase-cms-tags"],
        },
      },
    )
  : null;

export const hasBusabaseConfig = isConfigured;

export const getCmsFolderDashboardUrl = async () => {
  const baseUrl = process.env.BUSABASE_CMS_BASE_URL?.replace(/\/+$/, "");
  const folderId = process.env.BUSABASE_CMS_FOLDER_ID;
  if (!baseUrl || !folderId) return null;

  try {
    const source = createBusabaseCmsSourceFromConfig(busabaseConfig);
    const folder = await source.getNode?.(folderId);
    if (!folder || folder.type !== "folder") return null;

    const dashboardSpace = process.env.BUSABASE_CMS_SPACE_ID ?? "local";
    return `${baseUrl}/dashboard/${encodeURIComponent(dashboardSpace)}/folder/${encodeURIComponent(folder.slug)}`;
  } catch (error) {
    console.error("[busabase-cms] Unable to resolve the CMS Folder dashboard URL", error);
    return null;
  }
};

/**
 * "The CMS is unreachable" and "nothing is published" are different answers, and
 * `readCmsOrFallback` deliberately flattens them into one so a page can render
 * instead of 500-ing on a blip.
 *
 * That is the right default, and it is wrong the moment a page acts on the
 * answer: an unreachable CMS then renders as an empty archive or a 404, and
 * whatever caching sits in front — Next's own static output, a CDN — persists
 * it. In this app, `/categories` and `/tags` were prerendered at build time with
 * `s-maxage=31536000`, so one unreachable build baked "no active tags" in for a
 * year.
 *
 * So reads that a page will act on go through here and get told which answer
 * they actually received.
 */
export type CmsRead<T> = { status: "ok"; data: T } | { status: "unavailable" };

const readCms = async <T>(
  operation: (() => Promise<T>) | undefined,
  whenUnconfigured: T,
  label: string,
): Promise<CmsRead<T>> => {
  // No CMS configured at all is NOT a failure — it is this example's first-run
  // state, and "there is nothing here yet" is the correct answer. The pages
  // render their onboarding EmptyState from it (`hasBusabaseConfig`), which an
  // error would replace with a stack trace on someone's very first `pnpm dev`.
  if (!operation) return { status: "ok", data: whenUnconfigured };
  try {
    return { status: "ok", data: await operation() };
  } catch (error) {
    console.warn(`[busabase-cms] ${label} failed`, error);
    return { status: "unavailable" };
  }
};

/**
 * Unwrap a read, or fail loudly.
 *
 * Throwing beats rendering "not found" or an empty list: an error response is
 * never cached, so the page recovers on the next request, whereas a cached 404
 * tells crawlers the content was deleted.
 */
export const requireCms = <T>(read: CmsRead<T>, what: string): T => {
  if (read.status === "unavailable") {
    throw new Error(`Busabase CMS unreachable while rendering ${what}`);
  }
  return read.data;
};

export const readBlogPosts = async (): Promise<CmsRead<PostVO[]>> => {
  const read = await readCms(cms ? () => cms.posts.list() : undefined, [], "list Posts");
  if (read.status !== "ok") return read;
  return {
    status: "ok",
    data: read.data.filter(
      (post) => cmsPathHelpers.isValidContent(post) && cmsPathHelpers.isBlogPostPath(post.path),
    ),
  };
};

export const readLandingPages = async (): Promise<CmsRead<PageVO[]>> => {
  const read = await readCms(cms ? () => cms.pages.list() : undefined, [], "list Pages");
  if (read.status !== "ok") return read;
  return { status: "ok", data: read.data.filter(cmsPathHelpers.isValidContent) };
};

export const taxonomyArchivePath = (
  kind: CmsTaxonomyKind,
  taxonomy: { locale: string; slug: string },
) => cmsPathHelpers.buildTaxonomyArchivePath(kind, taxonomy);

export const readCategories = async (): Promise<CmsRead<CategoryVO[]>> => {
  const read = await readCms(cms ? () => cms.categories.list() : undefined, [], "list Categories");
  if (read.status !== "ok") return read;
  return {
    status: "ok",
    data: read.data.filter((category) => taxonomyArchivePath("categories", category)),
  };
};

export const readTags = async (): Promise<CmsRead<TagVO[]>> => {
  const read = await readCms(cms ? () => cms.tags.list() : undefined, [], "list Tags");
  if (read.status !== "ok") return read;
  return { status: "ok", data: read.data.filter((tag) => taxonomyArchivePath("tags", tag)) };
};

/**
 * The tolerant reads, unchanged.
 *
 * A sitemap should not fail because one read blinked — it can legitimately emit
 * fewer URLs. Anything that RENDERS a page for a user should prefer the `read*`
 * variants above, so an unreachable CMS never becomes "this content is gone".
 */
export const listBlogPosts = async (): Promise<PostVO[]> => {
  const read = await readBlogPosts();
  return read.status === "ok" ? read.data : [];
};

export const listLandingPages = async (): Promise<PageVO[]> => {
  const read = await readLandingPages();
  return read.status === "ok" ? read.data : [];
};

export const listCategories = async (): Promise<CategoryVO[]> => {
  const read = await readCategories();
  return read.status === "ok" ? read.data : [];
};

export const listTags = async (): Promise<TagVO[]> => {
  const read = await readTags();
  return read.status === "ok" ? read.data : [];
};

export const getBlogPostByCanonicalPath = async (path: string): Promise<PostVO | null> => {
  const read = await readBlogPostByCanonicalPath(path);
  return read.status === "ok" ? read.data : null;
};

export const getLandingPageByCanonicalPath = async (path: string): Promise<PageVO | null> => {
  const read = await readLandingPageByCanonicalPath(path);
  return read.status === "ok" ? read.data : null;
};

export const getLandingPageByPreviewRoute = async (route: string): Promise<PageVO | null> => {
  const read = await readLandingPageByPreviewRoute(route);
  return read.status === "ok" ? read.data : null;
};

export const canonicalContentPath = (path: string) => cmsPathHelpers.normalizePath(path);

export const buildContentPath = (locale: string, segments: readonly string[]) =>
  cmsPathHelpers.buildPath(locale, segments);

export const parseContentPath = (path: string) => cmsPathHelpers.parsePath(path);

export const readBlogPostByCanonicalPath = async (
  path: string,
): Promise<CmsRead<PostVO | null>> => {
  const canonicalPath = cmsPathHelpers.normalizePath(path);
  // A malformed path is genuinely "no such post" — no CMS round trip needed.
  if (!canonicalPath || !cmsPathHelpers.isBlogPostPath(canonicalPath)) {
    return { status: "ok", data: null };
  }

  const read = await readCms(
    cms ? () => cms.posts.getByPath(canonicalPath) : undefined,
    null,
    "get Post",
  );
  if (read.status !== "ok") return read;
  const post = read.data;
  return { status: "ok", data: post && cmsPathHelpers.isValidContent(post) ? post : null };
};

export const readLandingPageByCanonicalPath = async (
  path: string,
): Promise<CmsRead<PageVO | null>> => {
  const canonicalPath = cmsPathHelpers.normalizePath(path);
  if (!canonicalPath) return { status: "ok", data: null };

  const read = await readCms(
    cms ? () => cms.pages.getByPath(canonicalPath) : undefined,
    null,
    "get Page",
  );
  if (read.status !== "ok") return read;
  const page = read.data;
  return { status: "ok", data: page && cmsPathHelpers.isValidContent(page) ? page : null };
};

export const readLandingPageByPreviewRoute = async (
  route: string,
): Promise<CmsRead<PageVO | null>> => {
  const parsed = cmsPathHelpers.parsePath(`/${route}`);
  const slug = parsed?.segments.at(-1);
  if (!parsed || !slug) return { status: "ok", data: null };

  const read = await readLandingPages();
  if (read.status !== "ok") return read;
  const matches = read.data.filter((page) => page.locale === parsed.locale && page.slug === slug);
  return { status: "ok", data: matches.length === 1 ? matches[0] : null };
};

export const readCategoryArchive = async (
  locale: string,
  slug: string,
): Promise<CmsRead<CategoryVO | null>> => {
  const read = await readCategories();
  if (read.status !== "ok") return read;
  const category = read.data.find((entry) => entry.locale === locale && entry.slug === slug);
  return { status: "ok", data: category ?? null };
};

export const readTagArchive = async (
  locale: string,
  slug: string,
): Promise<CmsRead<TagVO | null>> => {
  const read = await readTags();
  if (read.status !== "ok") return read;
  const tag = read.data.find((entry) => entry.locale === locale && entry.slug === slug);
  return { status: "ok", data: tag ?? null };
};

export const getCategoryArchive = async (locale: string, slug: string) => {
  const read = await readCategoryArchive(locale, slug);
  return read.status === "ok" ? read.data : null;
};

export const getTagArchive = async (locale: string, slug: string) => {
  const read = await readTagArchive(locale, slug);
  return read.status === "ok" ? read.data : null;
};

export const listPostsForTaxonomy = async (kind: CmsTaxonomyKind, taxonomy: CategoryVO | TagVO) =>
  filterCmsPostsByTaxonomy(await listBlogPosts(), kind, taxonomy);

export const getLinkedTaxonomies = async (post: PostVO) => {
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  return {
    categories: categories.filter(
      (category) => category.locale === post.locale && post.categoryIds.includes(category.id),
    ),
    tags: tags.filter((tag) => tag.locale === post.locale && post.tagIds.includes(tag.id)),
  };
};
