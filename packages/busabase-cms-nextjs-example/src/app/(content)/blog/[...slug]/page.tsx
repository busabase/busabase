import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { generatePostMetadata, PostPage } from "@/components/post-page";
import {
  buildContentPath,
  cmsPathOptions,
  readBlogPostByCanonicalPath,
  requireCms,
} from "@/lib/content";

interface BlogPageProps {
  params: Promise<{ slug: string[] }>;
}

/**
 * The post, or `null` when there genuinely is no such post.
 *
 * Throws when the CMS could not be reached at all: a 404 says "this was
 * deleted", which is a different and much stickier claim than "try again".
 */
const getPost = async (slug: string[]) => {
  const path = buildContentPath(cmsPathOptions.defaultLocale, ["blog", ...slug]);
  if (!path) return null;
  return requireCms(await readBlogPostByCanonicalPath(path), `the blog post at ${path}`);
};

export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  return post ? generatePostMetadata(post) : {};
}

export default async function BlogDetailPage({ params }: BlogPageProps) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return <PostPage post={post} />;
}
