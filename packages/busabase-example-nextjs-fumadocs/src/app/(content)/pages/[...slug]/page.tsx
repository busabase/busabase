import { sanitizeLandingPageHtml } from "busabase-cms/fumadocs";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLandingPageByRoute } from "@/lib/content";

interface LandingPageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getLandingPageByRoute(slug.join("/"));
  if (!page) return {};

  return {
    title: page.seoTitle ?? page.title,
    description: page.seoDescription,
    alternates: { canonical: page.canonicalUrl ?? `/pages/${slug.join("/")}` },
  };
}

export default async function LandingPageDetail({ params }: LandingPageProps) {
  const { slug } = await params;
  const page = await getLandingPageByRoute(slug.join("/"));
  if (!page) notFound();

  return (
    <main className="landing-preview-shell">
      <div className="preview-toolbar">
        <Link href="/pages" className="back-link">
          <ArrowLeft aria-hidden="true" size={15} />
          All pages
        </Link>
        <span>{page.locale}</span>
        <code>{page.path}</code>
      </div>
      <article
        className="landing-html"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared package sanitizes this stored HTML at the render boundary.
        dangerouslySetInnerHTML={{ __html: sanitizeLandingPageHtml(page.body) }}
      />
    </main>
  );
}
