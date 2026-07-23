import type { PageVO } from "busabase-cms";
import { sanitizeLandingPageHtml } from "busabase-cms/fumadocs";
import type { Metadata } from "next";

export const generateCmsPageMetadata = (page: PageVO): Metadata => ({
  title: page.seoTitle ?? page.title,
  description: page.seoDescription,
  alternates: { canonical: page.path },
});

interface CmsPageProps {
  page: PageVO;
}

export function CmsPage({ page }: CmsPageProps) {
  return (
    <main className="canonical-page-shell">
      <article
        className="landing-html"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared package sanitizes this stored HTML at the render boundary.
        dangerouslySetInnerHTML={{ __html: sanitizeLandingPageHtml(page.body) }}
      />
    </main>
  );
}
