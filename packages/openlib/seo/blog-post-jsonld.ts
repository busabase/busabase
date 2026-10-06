/**
 * JSON-LD for a locally-authored (MDX) blog post: a `BlogPosting` plus a Home → Blog → Post
 * `BreadcrumbList`, ready to render as `<script type="application/ld+json">` tags.
 *
 * This is the MDX-only builder (insure, previewfile, inpomo, mcpsdk call it through
 * `resolveLocalPostJsonLd`). Apps that read Busabase CMS get the same nodes from
 * busabase-cms-sdk — `buildCmsPostJsonLd`, or
 * `createCmsPostResolver({ jsonLdSite }).resolvePostJsonLd` — and the two emit the same shape
 * on purpose; a parity test in an app that depends on both (`jsonld-parity.test.ts`) holds
 * them to it. They are separate implementations because the published SDK cannot import this
 * private package, and MDX-only apps should not take on the CMS SDK (and its Docker allowlist
 * entries) for one builder. Same split as `getLocalPostLocales` in ../i18n/local-post-locales.
 *
 * Every URL is built with the canonical-URL rule the page metadata uses (default locale
 * unprefixed), so `url`/`mainEntityOfPage` equal the page's `<link rel="canonical">`.
 */

import { createCanonicalUrlHelpers } from "../i18n/canonical-url";

export interface BlogPostJsonLdSite {
  /** Absolute base URL with no trailing slash, e.g. "https://insure.example". */
  baseUrl: string;
  /** The locale whose URLs carry no prefix. */
  defaultLocale: string;
  siteName?: string;
  /**
   * `@id` of the Organization node the app already renders site-wide. When set, `publisher`
   * references it; when omitted the publisher is inlined from `siteName` (and left out without
   * that too) — never a reference to a node the page does not contain.
   */
  organizationId?: string;
}

export interface BlogPostJsonLdInput {
  /** Path WITHOUT a locale prefix, e.g. "/blog/hello-world". */
  path: string;
  /** The locale the rendered body really is — on a fallback, the fallback's locale. */
  lang: string;
  title: string;
  description?: string | null;
  /** Absolute or root-relative. */
  image?: string | null;
  /** ISO 8601 string, or a `Date` (fumadocs parses an unquoted YAML `date:` into one). */
  datePublished?: string | Date | null;
  dateModified?: string | Date | null;
  author?: string | null;
  /** Breadcrumb labels, in `lang`. Default "Home" / "Blog". */
  homeLabel?: string;
  blogLabel?: string;
}

/** A complete ISO 8601 date or date-time — the shapes schema.org accepts verbatim. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** An ISO 8601 date, or `undefined` for anything that is not a date. */
const toIsoDate = (value: string | Date | null | undefined): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // An ISO string stays verbatim: re-serializing `2026-09-01` would invent a UTC instant.
  return ISO_8601.test(trimmed) ? trimmed : parsed.toISOString();
};

const text = (value: string | null | undefined): string | undefined =>
  value?.trim() ? value : undefined;

/** Drop keys whose value is undefined so the emitted JSON stays clean. */
const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

export const buildBlogPostJsonLd = (
  site: BlogPostJsonLdSite,
  input: BlogPostJsonLdInput,
): Array<Record<string, unknown>> => {
  const { getLocalizedUrl } = createCanonicalUrlHelpers({
    defaultLocale: site.defaultLocale,
    supportedLocales: [site.defaultLocale],
  });
  const url = getLocalizedUrl(site.baseUrl, input.lang, input.path);
  const image = text(input.image);
  const datePublished = toIsoDate(input.datePublished);
  const publisher = site.organizationId
    ? { "@id": site.organizationId }
    : site.siteName
      ? { "@type": "Organization", name: site.siteName, url: site.baseUrl }
      : undefined;

  const posting = compact({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.title,
    description: text(input.description),
    inLanguage: input.lang,
    datePublished,
    dateModified: toIsoDate(input.dateModified) ?? datePublished,
    image: image ? [/^https?:\/\//i.test(image) ? image : `${site.baseUrl}${image}`] : undefined,
    author: text(input.author) ? { "@type": "Person", name: input.author } : undefined,
    publisher,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
  });

  const trail = [
    { name: input.homeLabel ?? "Home", url: getLocalizedUrl(site.baseUrl, input.lang, "/") },
    { name: input.blogLabel ?? "Blog", url: getLocalizedUrl(site.baseUrl, input.lang, "/blog") },
    { name: input.title, url },
  ];
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return [posting, breadcrumbs];
};
