import type { Metadata } from "next";

import { ContentCard } from "@/components/content-card";
import { EmptyState } from "@/components/empty-state";
import { canonicalContentPath, hasBusabaseConfig, listLandingPages } from "@/lib/content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pages",
  description: "Published Pages loaded from Busabase CMS.",
};

export default async function LandingPageIndex() {
  const pages = await listLandingPages();

  return (
    <main className="shell">
      <header className="page-heading">
        <p className="eyebrow">Pages Base</p>
        <h1>Pages</h1>
        <p>Sanitized HTML previews of the canonical landing-page records.</p>
      </header>
      {pages.length === 0 ? (
        <EmptyState configured={hasBusabaseConfig} kind="pages" />
      ) : (
        <section className="content-grid">
          {pages.map((page) => {
            const href = canonicalContentPath(page.path);
            return href ? (
              <ContentCard
                key={page.id}
                href={href}
                title={page.title}
                description={page.seoDescription}
                locale={page.locale}
                updatedAt={page.updatedAt}
              />
            ) : null;
          })}
        </section>
      )}
    </main>
  );
}
