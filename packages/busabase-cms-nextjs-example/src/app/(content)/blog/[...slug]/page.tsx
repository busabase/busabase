import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { generatePostMetadata, PostPage } from "@/components/post-page";
import { buildContentPath, cmsPathOptions, getBlogPostByCanonicalPath } from "@/lib/content";

interface BlogPageProps {
  params: Promise<{ slug: string[] }>;
}

const getPost = async (slug: string[]) => {
  const path = buildContentPath(cmsPathOptions.defaultLocale, ["blog", ...slug]);
  return path ? getBlogPostByCanonicalPath(path) : null;
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
