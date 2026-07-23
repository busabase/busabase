import type { CategoryVO, CmsTaxonomyKind, TagVO } from "busabase-cms";
import { FolderTree, Tag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ContentCard } from "@/components/content-card";
import {
  canonicalContentPath,
  getCategoryArchive,
  getTagArchive,
  listPostsForTaxonomy,
  taxonomyArchivePath,
} from "@/lib/content";

type TaxonomyVO = CategoryVO | TagVO;

interface TaxonomyOverviewProps {
  kind: CmsTaxonomyKind;
  items: TaxonomyVO[];
}

export function TaxonomyOverview({ kind, items }: TaxonomyOverviewProps) {
  const label = kind === "categories" ? "Categories" : "Tags";
  const Icon = kind === "categories" ? FolderTree : Tag;

  return (
    <main className="shell">
      <header className="page-heading">
        <p className="eyebrow">{label} Base</p>
        <h1>{label}</h1>
        <p>Browse active taxonomy records and the published Posts related to each one.</p>
      </header>
      {items.length === 0 ? (
        <div className="taxonomy-empty">No active {label.toLowerCase()} are available.</div>
      ) : (
        <section className="taxonomy-grid" aria-label={label}>
          {items.map((item) => {
            const href = taxonomyArchivePath(kind, item);
            return href ? (
              <Link className="taxonomy-item" href={href} key={item.id}>
                <Icon aria-hidden="true" size={18} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description ?? item.locale}</small>
                </span>
                <code>{item.locale}</code>
              </Link>
            ) : null;
          })}
        </section>
      )}
    </main>
  );
}

export const getTaxonomy = async (kind: CmsTaxonomyKind, locale: string, slug: string) =>
  kind === "categories" ? getCategoryArchive(locale, slug) : getTagArchive(locale, slug);

export const generateTaxonomyMetadata = (
  kind: CmsTaxonomyKind,
  taxonomy: TaxonomyVO,
): Metadata => ({
  title: taxonomy.name,
  description:
    taxonomy.description ??
    `Published Posts in the ${taxonomy.name} ${kind === "categories" ? "category" : "tag"}.`,
  alternates: { canonical: taxonomyArchivePath(kind, taxonomy) ?? undefined },
});

interface TaxonomyArchiveProps {
  kind: CmsTaxonomyKind;
  taxonomy: TaxonomyVO;
}

export async function TaxonomyArchive({ kind, taxonomy }: TaxonomyArchiveProps) {
  const posts = await listPostsForTaxonomy(kind, taxonomy);
  const overviewHref = kind === "categories" ? "/categories" : "/tags";

  return (
    <main className="shell">
      <header className="page-heading taxonomy-heading">
        <Link href={overviewHref} className="back-link">
          All {kind}
        </Link>
        <p className="eyebrow">{taxonomy.locale}</p>
        <h1>{taxonomy.name}</h1>
        {taxonomy.description ? <p>{taxonomy.description}</p> : null}
      </header>
      {posts.length === 0 ? (
        <div className="taxonomy-empty">No published Posts use this taxonomy yet.</div>
      ) : (
        <section className="content-grid">
          {posts.map((post) => {
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
