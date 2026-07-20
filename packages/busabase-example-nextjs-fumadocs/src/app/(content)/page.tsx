import { BookOpenText, Files, Tags } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import {
  hasBusabaseConfig,
  listBlogPosts,
  listCategories,
  listLandingPages,
  listTags,
} from "@/lib/content";

// Content is cached by busabase-cms; keep the route runtime-rendered so deploy-time
// environment variables and newly revalidated records are observed.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [posts, pages, categories, tags] = await Promise.all([
    listBlogPosts(),
    listLandingPages(),
    listCategories(),
    listTags(),
  ]);
  const hasContent = posts.length > 0 || pages.length > 0;

  return (
    <main className="shell overview">
      <header className="page-heading">
        <p className="eyebrow">Canonical CMS</p>
        <h1>Busabase CMS browser</h1>
        <p>Review published Posts and Pages with their active Categories and Tags.</p>
      </header>

      <section className="summary-grid" aria-label="Content summary">
        <Link href="/blog" className="summary-item">
          <BookOpenText aria-hidden="true" size={22} />
          <strong>{posts.length}</strong>
          <span>Posts</span>
        </Link>
        <Link href="/pages" className="summary-item">
          <Files aria-hidden="true" size={22} />
          <strong>{pages.length}</strong>
          <span>Pages</span>
        </Link>
        <div className="summary-item">
          <Tags aria-hidden="true" size={22} />
          <strong>{categories.length + tags.length}</strong>
          <span>
            {categories.length} categories · {tags.length} tags
          </span>
        </div>
      </section>

      {!hasContent ? (
        <EmptyState configured={hasBusabaseConfig} kind="content" />
      ) : (
        <section className="activity-list">
          <div>
            <h2>Recent canonical records</h2>
            <p>The list is read from merged, published Busabase records.</p>
          </div>
          {[...posts, ...pages]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 6)
            .map((item) => (
              <div className="activity-row" key={`${item.path}-${item.id}`}>
                <span>{item.title}</span>
                <code>{item.path}</code>
                <time dateTime={item.updatedAt}>
                  {new Date(item.updatedAt).toLocaleDateString()}
                </time>
              </div>
            ))}
        </section>
      )}
    </main>
  );
}
