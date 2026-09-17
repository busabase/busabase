import type { PageVO } from "busabase-cms-sdk";
import { buildCmsPageJsonLd } from "busabase-cms-sdk";
import { sanitizeLandingPageHtml } from "busabase-cms-sdk/fumadocs";
import type { Metadata } from "next";

import {
  availableLocalesForPath,
  cmsAlternates,
  listLandingPages,
  parseContentPath,
} from "@/lib/content";
import { siteName, siteUrl } from "@/lib/site";

/**
 * Metadata for a CMS Page.
 *
 * This example is what people copy into their own site, so it shows the whole rule
 * rather than the easy half:
 *
 *  - the canonical is an ABSOLUTE URL for the locale that owns the content, not the
 *    stored path (a relative canonical is resolved against metadataBase, which works
 *    until someone renders the page under a different prefix);
 *  - hreflang lists only the locales that REALLY have this Page. Advertising every
 *    configured locale for English-only content contradicts the canonical, and Google
 *    responds by discarding the entire hreflang cluster;
 *  - `og:site_name` and the rest of the site identity are set here because Next
 *    REPLACES `openGraph` wholesale rather than merging it with the root layout's.
 */
export const generateCmsPageMetadata = async (page: PageVO): Promise<Metadata> => {
  const parsed = parseContentPath(page.path);
  if (!parsed) return {};

  const available = availableLocalesForPath(await listLandingPages(), parsed.pathWithoutLocale);
  // The locale that produced this Page demonstrably has a version of it, even if a
  // transient CMS outage made the list read come back empty.
  const availableLocales = available.includes(parsed.locale) ? available : [parsed.locale];
  const alternates = cmsAlternates(parsed.pathWithoutLocale, parsed.locale, availableLocales);
  const title = page.seoTitle ?? page.title;
  const description = page.seoDescription ?? undefined;

  return {
    // A CMS seo-title is a complete title an editor authored, not a fragment for the
    // root layout's `%s | Site` template to decorate.
    title: page.seoTitle ? { absolute: page.seoTitle } : title,
    description,
    // An editor-set canonical-url wins, and suppresses hreflang: we cannot know the
    // alternates of a URL we did not compute, and wrong hreflang is worse than none.
    alternates: page.canonicalUrl
      ? { canonical: page.canonicalUrl }
      : (alternates ?? { canonical: page.path }),
    openGraph: {
      type: "website",
      title,
      description,
      url: alternates?.canonical,
      siteName,
      locale: parsed.locale.replace(/-/g, "_"),
    },
    twitter: { card: "summary_large_image", title, description },
  };
};

interface CmsPageProps {
  page: PageVO;
}

export async function CmsPage({ page }: CmsPageProps) {
  const parsed = parseContentPath(page.path);
  // WebPage + BreadcrumbList + a FAQPage when the body really contains one. Built by
  // the SDK so every consumer emits the same shape — see busabase-cms-sdk/src/jsonld.ts.
  const jsonLd = parsed
    ? buildCmsPageJsonLd(
        { baseUrl: siteUrl.origin, siteName },
        {
          url: `${siteUrl.origin}${parsed.canonicalPath}`,
          title: page.seoTitle ?? page.title,
          description: page.seoDescription,
          lang: parsed.locale,
          dateModified: page.updatedAt,
          breadcrumbs: [
            { name: siteName, url: siteUrl.origin },
            { name: page.title, url: `${siteUrl.origin}${parsed.canonicalPath}` },
          ],
          bodyHtml: page.body,
        },
      )
    : [];

  return (
    <main className="canonical-page-shell">
      {jsonLd.map((node) => (
        <script
          key={String(node["@type"])}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify output is safe
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
      <article
        className="landing-html"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared package sanitizes this stored HTML at the render boundary.
        dangerouslySetInnerHTML={{ __html: sanitizeLandingPageHtml(page.body) }}
      />
    </main>
  );
}
