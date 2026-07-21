import {
  ArrowRight,
  BookOpenText,
  Braces,
  Database,
  ExternalLink,
  Files,
  FolderTree,
  Tags,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import {
  blogRoute,
  hasBusabaseConfig,
  landingRoute,
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
  const busabaseBaseUrl = process.env.BUSABASE_BASE_URL?.replace(/\/+$/, "");
  const cmsFolderId = process.env.BUSABASE_CMS_FOLDER_ID;
  const recentRecords = [
    ...posts.map((post) => ({
      ...post,
      href: `/blog/${blogRoute(post.path)}`,
    })),
    ...pages.map((page) => ({
      ...page,
      href: `/pages/${landingRoute(page.path)}`,
    })),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  const dataSourceLinks = busabaseBaseUrl
    ? [
        {
          label: "Busabase workspace",
          href: busabaseBaseUrl,
          icon: Database,
        },
        ...(cmsFolderId
          ? [
              {
                label: "CMS folder records",
                href: `${busabaseBaseUrl}/api/v1/nodes?parentId=${encodeURIComponent(cmsFolderId)}&depth=1`,
                icon: FolderTree,
              },
            ]
          : []),
        {
          label: "Node tree JSON",
          href: `${busabaseBaseUrl}/api/v1/nodes`,
          icon: Braces,
        },
        {
          label: "API documentation",
          href: `${busabaseBaseUrl}/api/v1/doc`,
          icon: BookOpenText,
        },
      ]
    : [];

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
        <Link href="#data-source" className="summary-item">
          <Tags aria-hidden="true" size={22} />
          <strong>{categories.length + tags.length}</strong>
          <span>
            {categories.length} categories · {tags.length} tags
          </span>
        </Link>
      </section>

      {!hasContent ? (
        <EmptyState configured={hasBusabaseConfig} kind="content" />
      ) : (
        <section className="activity-list">
          <div>
            <h2>Recent canonical records</h2>
            <p>The list is read from merged, published Busabase records.</p>
          </div>
          {recentRecords.map((item) => (
            <Link className="activity-row" href={item.href} key={`${item.path}-${item.id}`}>
              <span>{item.title}</span>
              <code>{item.path}</code>
              <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString()}</time>
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          ))}
        </section>
      )}

      <section className="data-source" id="data-source" aria-labelledby="data-source-title">
        <div className="data-source__heading">
          <p className="eyebrow">Data source</p>
          <h2 id="data-source-title">Inspect the canonical records</h2>
          <p>
            This example reads its Posts, Pages, Categories, and Tags directly from the configured
            Busabase folder.
          </p>
        </div>
        {dataSourceLinks.length > 0 ? (
          <div className="data-source__links">
            {dataSourceLinks.map(({ label, href, icon: Icon }) => (
              <a href={href} key={label} rel="noreferrer" target="_blank">
                <Icon aria-hidden="true" size={18} />
                <span>
                  <strong>{label}</strong>
                  <code>{href}</code>
                </span>
                <ExternalLink aria-hidden="true" size={16} />
              </a>
            ))}
          </div>
        ) : (
          <p className="data-source__empty">
            Configure Busabase to inspect this example's source records.
          </p>
        )}
      </section>
    </main>
  );
}
