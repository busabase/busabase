import type { MetadataRoute } from "next";

import { blogRoute, landingRoute, listBlogPosts, listLandingPages } from "@/lib/content";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, pages] = await Promise.all([listBlogPosts(), listLandingPages()]);

  return [
    { url: new URL("/", siteUrl).toString(), changeFrequency: "weekly", priority: 1 },
    { url: new URL("/blog", siteUrl).toString(), changeFrequency: "daily", priority: 0.8 },
    { url: new URL("/pages", siteUrl).toString(), changeFrequency: "daily", priority: 0.8 },
    ...posts.map((post) => ({
      url: new URL(`/blog/${blogRoute(post.path)}`, siteUrl).toString(),
      lastModified: new Date(post.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...pages.map((page) => ({
      url: new URL(`/pages/${landingRoute(page.path)}`, siteUrl).toString(),
      lastModified: new Date(page.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
