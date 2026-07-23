import type { Metadata } from "next";

import { ContentCard } from "@/components/content-card";
import { EmptyState } from "@/components/empty-state";
import { canonicalContentPath, hasBusabaseConfig, listBlogPosts } from "@/lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Posts",
  description: "Published Posts loaded from Busabase CMS.",
};

export default async function BlogIndexPage() {
  const posts = await listBlogPosts();

  return (
    <main className="shell">
      <header className="page-heading">
        <p className="eyebrow">Posts Base</p>
        <h1>Posts</h1>
        <p>Published Markdown records, sorted by their canonical publication date.</p>
      </header>
      {posts.length === 0 ? (
        <EmptyState configured={hasBusabaseConfig} kind="posts" />
      ) : (
        <section className="content-grid">
          {posts
            .sort((a, b) =>
              (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt),
            )
            .map((post) => {
              const href = canonicalContentPath(post.path);
              return href ? (
                <ContentCard
                  key={post.id}
                  href={href}
                  title={post.title}
                  description={post.description}
                  locale={post.locale}
                  updatedAt={post.updatedAt}
                />
              ) : null;
            })}
        </section>
      )}
    </main>
  );
}
