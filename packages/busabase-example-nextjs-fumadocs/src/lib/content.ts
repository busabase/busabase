import "server-only";

import { createCachedBusabaseCms } from "busabase-cms/next";

// A self-hosted Busabase server can be read without an API key or space header.
const isConfigured = Boolean(process.env.BUSABASE_BASE_URL && process.env.BUSABASE_CMS_FOLDER_ID);

const cms = isConfigured
  ? createCachedBusabaseCms(
      {
        config: {
          baseUrl: process.env.BUSABASE_BASE_URL,
          apiKey: process.env.BUSABASE_API_KEY,
          spaceId: process.env.BUSABASE_SPACE_ID,
        },
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

export const listBlogPosts = async () => {
  if (!cms) return [];

  try {
    return await cms.posts.list();
  } catch (error) {
    console.error("[busabase-cms] Unable to load Posts", error);
    return [];
  }
};

export const listLandingPages = async () => {
  if (!cms) return [];

  try {
    return await cms.pages.list();
  } catch (error) {
    console.error("[busabase-cms] Unable to load Pages", error);
    return [];
  }
};

export const listCategories = async () => {
  if (!cms) return [];
  try {
    return await cms.categories.list();
  } catch (error) {
    console.error("[busabase-cms] Unable to load Categories", error);
    return [];
  }
};

export const listTags = async () => {
  if (!cms) return [];
  try {
    return await cms.tags.list();
  } catch (error) {
    console.error("[busabase-cms] Unable to load Tags", error);
    return [];
  }
};

const contentRoute = (path: string, marker: "blog" | "use-cases") => {
  const segments = path.split("/").filter(Boolean);
  const markerIndex = segments.indexOf(marker);
  if (markerIndex < 0) return segments.join("/");

  const locale = markerIndex > 0 ? segments.slice(0, markerIndex) : [];
  return [...locale, ...segments.slice(markerIndex + 1)].join("/");
};

export const blogRoute = (path: string) => contentRoute(path, "blog");
export const landingRoute = (path: string) => contentRoute(path, "use-cases");

export const getBlogPostByRoute = async (route: string) => {
  const posts = await listBlogPosts();
  return posts.find((post) => blogRoute(post.path) === route) ?? null;
};

export const getLandingPageByRoute = async (route: string) => {
  const pages = await listLandingPages();
  return pages.find((page) => landingRoute(page.path) === route) ?? null;
};
