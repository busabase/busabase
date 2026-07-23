import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CmsPage, generateCmsPageMetadata } from "@/components/cms-page";
import { generatePostMetadata, PostPage } from "@/components/post-page";
import {
  getBlogPostByCanonicalPath,
  getLandingPageByCanonicalPath,
  parseContentPath,
} from "@/lib/content";

interface CanonicalContentPageProps {
  params: Promise<{ cmsPath: string[] }>;
}

const getCanonicalContent = async (segments: string[]) => {
  const path = `/${segments.join("/")}`;
  const parsed = parseContentPath(path);
  if (!parsed) return null;

  if (parsed.segments[0] === "blog") {
    const post = await getBlogPostByCanonicalPath(parsed.canonicalPath);
    return post ? { kind: "post" as const, value: post } : null;
  }

  const page = await getLandingPageByCanonicalPath(parsed.canonicalPath);
  return page ? { kind: "page" as const, value: page } : null;
};

export async function generateMetadata({ params }: CanonicalContentPageProps): Promise<Metadata> {
  const { cmsPath } = await params;
  const content = await getCanonicalContent(cmsPath);
  if (!content) return {};

  return content.kind === "post"
    ? generatePostMetadata(content.value)
    : generateCmsPageMetadata(content.value);
}

export default async function CanonicalContentPage({ params }: CanonicalContentPageProps) {
  const { cmsPath } = await params;
  const content = await getCanonicalContent(cmsPath);
  if (!content) notFound();

  return content.kind === "post" ? (
    <PostPage post={content.value} />
  ) : (
    <CmsPage page={content.value} />
  );
}
