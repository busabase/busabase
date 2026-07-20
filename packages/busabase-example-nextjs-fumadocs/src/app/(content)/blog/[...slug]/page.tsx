import { getSafeMarkdownToc, SafeMarkdown } from "busabase-cms/fumadocs";
import { ArrowLeft, CalendarDays, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getBlogPostByRoute } from "@/lib/content";

interface BlogPageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostByRoute(slug.join("/"));
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: post.canonicalUrl ?? `/blog/${slug.join("/")}` },
    openGraph: post.coverImage ? { images: [post.coverImage.url] } : undefined,
  };
}

export default async function BlogDetailPage({ params }: BlogPageProps) {
  const { slug } = await params;
  const post = await getBlogPostByRoute(slug.join("/"));
  if (!post) notFound();

  const toc = await getSafeMarkdownToc(post.body);

  return (
    <main className="shell article-shell">
      <article className="article">
        <Link href="/blog" className="back-link">
          <ArrowLeft aria-hidden="true" size={15} />
          All posts
        </Link>
        <header className="article-header">
          <p className="eyebrow">{post.locale}</p>
          <h1>{post.title}</h1>
          {post.description ? <p>{post.description}</p> : null}
          <div className="byline">
            {post.author ? (
              <span>
                <UserRound aria-hidden="true" size={15} />
                {post.author}
              </span>
            ) : null}
            <span>
              <CalendarDays aria-hidden="true" size={15} />
              {new Date(post.publishedAt ?? post.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </header>
        {post.coverImage ? (
          // Remote media remains owned by Busabase; a native image avoids a host allowlist.
          <img className="cover-image" src={post.coverImage.url} alt={post.title} />
        ) : null}
        <div className="prose">
          <SafeMarkdown>{post.body}</SafeMarkdown>
        </div>
      </article>
      {toc.length > 0 ? (
        <aside className="toc" aria-label="On this page">
          <strong>On this page</strong>
          <ol>
            {toc.map((item) => (
              <li key={item.url} data-depth={item.depth}>
                <a href={item.url}>{item.title}</a>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </main>
  );
}
