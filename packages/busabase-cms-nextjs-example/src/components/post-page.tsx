import { getSafeCmsExternalUrl, type PostVO } from "busabase-cms";
import { getSafeMarkdownToc, SafeMarkdown } from "busabase-cms/fumadocs";
import { ArrowLeft, CalendarDays, Download, Paperclip, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { getLinkedTaxonomies, taxonomyArchivePath } from "@/lib/content";

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = units[0];
  for (const nextUnit of units.slice(1)) {
    if (value < 1024) break;
    value /= 1024;
    unit = nextUnit;
  }
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
};

export const generatePostMetadata = (post: PostVO): Metadata => {
  const coverImageUrl = post.coverImage ? getSafeCmsExternalUrl(post.coverImage.url) : null;
  return {
    title: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.description,
    alternates: { canonical: post.path },
    openGraph: coverImageUrl ? { images: [coverImageUrl] } : undefined,
  };
};

interface PostPageProps {
  post: PostVO;
}

export async function PostPage({ post }: PostPageProps) {
  const [toc, taxonomies] = await Promise.all([
    getSafeMarkdownToc(post.body),
    getLinkedTaxonomies(post),
  ]);
  const attachments = post.attachments.flatMap((attachment) => {
    const url = getSafeCmsExternalUrl(attachment.url);
    return url ? [{ ...attachment, url }] : [];
  });
  const coverImageUrl = post.coverImage ? getSafeCmsExternalUrl(post.coverImage.url) : null;

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
          {taxonomies.categories.length > 0 || taxonomies.tags.length > 0 ? (
            <nav className="taxonomy-chips" aria-label="Post taxonomy">
              {taxonomies.categories.map((category) => {
                const href = taxonomyArchivePath("categories", category);
                return href ? (
                  <Link key={category.id} href={href} className="taxonomy-chip">
                    {category.name}
                  </Link>
                ) : null;
              })}
              {taxonomies.tags.map((tag) => {
                const href = taxonomyArchivePath("tags", tag);
                return href ? (
                  <Link key={tag.id} href={href} className="taxonomy-chip taxonomy-chip--tag">
                    #{tag.name}
                  </Link>
                ) : null;
              })}
            </nav>
          ) : null}
        </header>
        {coverImageUrl ? (
          <Image
            className="cover-image"
            src={coverImageUrl}
            alt={post.title}
            width={1280}
            height={720}
            sizes="(max-width: 800px) calc(100vw - 2rem), 46rem"
            unoptimized
          />
        ) : null}
        <div className="prose">
          <SafeMarkdown>{post.body}</SafeMarkdown>
        </div>
        {attachments.length > 0 ? (
          <section className="attachments" aria-labelledby="attachments-heading">
            <div className="attachments__heading">
              <Paperclip aria-hidden="true" size={18} />
              <h2 id="attachments-heading">Attachments</h2>
            </div>
            <ul>
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={attachment.fileName}
                  >
                    <span>
                      <strong>{attachment.fileName}</strong>
                      <small>
                        {attachment.mimeType || "File"} · {formatFileSize(attachment.size)}
                      </small>
                    </span>
                    <Download aria-hidden="true" size={17} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
