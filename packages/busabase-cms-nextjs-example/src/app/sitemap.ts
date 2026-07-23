import type { MetadataRoute } from "next";

import {
  canonicalContentPath,
  listBlogPosts,
  listCategories,
  listLandingPages,
  listTags,
  taxonomyArchivePath,
} from "@/lib/content";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface SitemapCandidate {
  path: string | null;
  lastModified?: string;
  changeFrequency: "daily" | "weekly";
  priority: number;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, pages, categories, tags] = await Promise.all([
    listBlogPosts(),
    listLandingPages(),
    listCategories(),
    listTags(),
  ]);
  const candidates: SitemapCandidate[] = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/blog", changeFrequency: "daily", priority: 0.8 },
    { path: "/pages", changeFrequency: "daily", priority: 0.8 },
    { path: "/categories", changeFrequency: "daily", priority: 0.6 },
    { path: "/tags", changeFrequency: "daily", priority: 0.6 },
    ...posts.map((post) => ({
      path: canonicalContentPath(post.path),
      lastModified: post.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...pages.map((page) => ({
      path: canonicalContentPath(page.path),
      lastModified: page.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...categories.map((category) => ({
      path: taxonomyArchivePath("categories", category),
      lastModified: category.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...tags.map((tag) => ({
      path: taxonomyArchivePath("tags", tag),
      lastModified: tag.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
  const seen = new Set<string>();

  return candidates.flatMap(({ path, lastModified, ...entry }) => {
    if (!path) return [];
    const url = new URL(path, siteUrl).toString();
    if (seen.has(url)) return [];
    seen.add(url);
    return [
      {
        url,
        ...entry,
        ...(lastModified ? { lastModified: new Date(lastModified) } : {}),
      },
    ];
  });
}
