import "server-only";

import {
  buildCmsCanonicalPath,
  buildCmsTaxonomyArchivePath,
  type CategoryVO,
  type CmsTaxonomyKind,
  createBusabaseCmsSourceFromConfig,
  filterCmsPostsByTaxonomy,
  isCmsBlogPostPath,
  isCmsContentForLocale,
  normalizeCmsPath,
  type PageVO,
  type PostVO,
  parseCmsCanonicalPath,
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

// A self-hosted Busabase server can be read without an API key or space header.
const isConfigured = Boolean(process.env.BUSABASE_BASE_URL && process.env.BUSABASE_CMS_FOLDER_ID);
const busabaseConfig = {
  baseUrl: process.env.BUSABASE_BASE_URL,
  apiKey: process.env.BUSABASE_API_KEY,
  spaceId: process.env.BUSABASE_SPACE_ID,
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
  const baseUrl = process.env.BUSABASE_BASE_URL?.replace(/\/+$/, "");
  const folderId = process.env.BUSABASE_CMS_FOLDER_ID;
  if (!baseUrl || !folderId) return null;

  try {
    const source = createBusabaseCmsSourceFromConfig(busabaseConfig);
    const folder = await source.getNode?.(folderId);
    if (!folder || folder.type !== "folder") return null;

    const dashboardSpace = process.env.BUSABASE_SPACE_ID ?? "local";
    return `${baseUrl}/dashboard/${encodeURIComponent(dashboardSpace)}/folder/${encodeURIComponent(folder.slug)}`;
  } catch (error) {
    console.error("[busabase-cms] Unable to resolve the CMS Folder dashboard URL", error);
    return null;
  }
};

const loadCmsCollection = async <T>(
  label: string,
  operation: (() => Promise<T[]>) | undefined,
): Promise<T[]> => {
  if (!operation) return [];

  try {
    return await operation();
  } catch (error) {
    console.error(`[busabase-cms] Unable to load ${label}`, error);
    return [];
  }
};

const hasValidCanonicalPath = (item: { locale: string; path: string }) =>
  Boolean(parseCmsCanonicalPath(item.path, cmsPathOptions)) &&
  isCmsContentForLocale(item, item.locale, cmsPathOptions);

export const listBlogPosts = async (): Promise<PostVO[]> => {
  const posts = await loadCmsCollection("Posts", cms ? () => cms.posts.list() : undefined);
  return posts.filter(
    (post) => hasValidCanonicalPath(post) && isCmsBlogPostPath(post.path, cmsPathOptions),
  );
};

export const listLandingPages = async (): Promise<PageVO[]> => {
  const pages = await loadCmsCollection("Pages", cms ? () => cms.pages.list() : undefined);
  return pages.filter(hasValidCanonicalPath);
};

export const taxonomyArchivePath = (
  kind: CmsTaxonomyKind,
  taxonomy: { locale: string; slug: string },
) => buildCmsTaxonomyArchivePath(kind, taxonomy, cmsPathOptions);

export const listCategories = async (): Promise<CategoryVO[]> => {
  const categories = await loadCmsCollection(
    "Categories",
    cms ? () => cms.categories.list() : undefined,
  );
  return categories.filter((category) => taxonomyArchivePath("categories", category));
};

export const listTags = async (): Promise<TagVO[]> => {
  const tags = await loadCmsCollection("Tags", cms ? () => cms.tags.list() : undefined);
  return tags.filter((tag) => taxonomyArchivePath("tags", tag));
};

export const canonicalContentPath = (path: string) => normalizeCmsPath(path);

export const buildContentPath = (locale: string, segments: readonly string[]) =>
  buildCmsCanonicalPath(locale, segments, cmsPathOptions);

export const parseContentPath = (path: string) => parseCmsCanonicalPath(path, cmsPathOptions);

export const getBlogPostByCanonicalPath = async (path: string): Promise<PostVO | null> => {
  const canonicalPath = normalizeCmsPath(path);
  if (!canonicalPath || !isCmsBlogPostPath(canonicalPath, cmsPathOptions)) return null;

  return (
    (await listBlogPosts()).find((post) => normalizeCmsPath(post.path) === canonicalPath) ?? null
  );
};

export const getLandingPageByCanonicalPath = async (path: string): Promise<PageVO | null> => {
  const canonicalPath = normalizeCmsPath(path);
  if (!canonicalPath) return null;

  return (
    (await listLandingPages()).find((page) => normalizeCmsPath(page.path) === canonicalPath) ?? null
  );
};

export const getLandingPageByPreviewRoute = async (route: string): Promise<PageVO | null> => {
  const parsed = parseCmsCanonicalPath(`/${route}`, cmsPathOptions);
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
