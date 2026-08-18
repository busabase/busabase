import "server-only";

import {
  type CategoryVO,
  type CmsTaxonomyKind,
  createBusabaseCmsSourceFromConfig,
  createCmsPathHelpers,
  filterCmsPostsByTaxonomy,
  type PageVO,
  type PostVO,
  readCmsOrFallback,
  type TagVO,
} from "busabase-cms";
import { createCachedBusabaseCms } from "busabase-cms/next";

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

export const listBlogPosts = async (): Promise<PostVO[]> => {
  const posts = await readCmsOrFallback(cms ? () => cms.posts.list() : undefined, [], "list Posts");
  return posts.filter(
    (post) => cmsPathHelpers.isValidContent(post) && cmsPathHelpers.isBlogPostPath(post.path),
  );
};

export const listLandingPages = async (): Promise<PageVO[]> => {
  const pages = await readCmsOrFallback(cms ? () => cms.pages.list() : undefined, [], "list Pages");
  return pages.filter(cmsPathHelpers.isValidContent);
};

export const taxonomyArchivePath = (
  kind: CmsTaxonomyKind,
  taxonomy: { locale: string; slug: string },
) => cmsPathHelpers.buildTaxonomyArchivePath(kind, taxonomy);

export const listCategories = async (): Promise<CategoryVO[]> => {
  const categories = await readCmsOrFallback(
    cms ? () => cms.categories.list() : undefined,
    [],
    "list Categories",
  );
  return categories.filter((category) => taxonomyArchivePath("categories", category));
};

export const listTags = async (): Promise<TagVO[]> => {
  const tags = await readCmsOrFallback(cms ? () => cms.tags.list() : undefined, [], "list Tags");
  return tags.filter((tag) => taxonomyArchivePath("tags", tag));
};

export const canonicalContentPath = (path: string) => cmsPathHelpers.normalizePath(path);

export const buildContentPath = (locale: string, segments: readonly string[]) =>
  cmsPathHelpers.buildPath(locale, segments);

export const parseContentPath = (path: string) => cmsPathHelpers.parsePath(path);

export const getBlogPostByCanonicalPath = async (path: string): Promise<PostVO | null> => {
  const canonicalPath = cmsPathHelpers.normalizePath(path);
  if (!canonicalPath || !cmsPathHelpers.isBlogPostPath(canonicalPath)) return null;

  const post = await readCmsOrFallback(
    cms ? () => cms.posts.getByPath(canonicalPath) : undefined,
    null,
    "get Post",
  );
  return post && cmsPathHelpers.isValidContent(post) ? post : null;
};

export const getLandingPageByCanonicalPath = async (path: string): Promise<PageVO | null> => {
  const canonicalPath = cmsPathHelpers.normalizePath(path);
  if (!canonicalPath) return null;

  const page = await readCmsOrFallback(
    cms ? () => cms.pages.getByPath(canonicalPath) : undefined,
    null,
    "get Page",
  );
  return page && cmsPathHelpers.isValidContent(page) ? page : null;
};

export const getLandingPageByPreviewRoute = async (route: string): Promise<PageVO | null> => {
  const parsed = cmsPathHelpers.parsePath(`/${route}`);
  const slug = parsed?.segments.at(-1);
  if (!parsed || !slug) return null;

  const matches = (await listLandingPages()).filter(
    (page) => page.locale === parsed.locale && page.slug === slug,
  );
  return matches.length === 1 ? matches[0] : null;
};

export const getCategoryArchive = async (locale: string, slug: string) =>
  (await listCategories()).find(
    (category) => category.locale === locale && category.slug === slug,
  ) ?? null;

export const getTagArchive = async (locale: string, slug: string) =>
  (await listTags()).find((tag) => tag.locale === locale && tag.slug === slug) ?? null;

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
