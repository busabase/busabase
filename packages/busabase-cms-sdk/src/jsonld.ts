/**
 * Structured data (JSON-LD) for CMS-driven content.
 *
 * Pure and framework-agnostic on purpose: these take a site descriptor and plain
 * values, never an app's config module, so one implementation serves every app
 * that renders Busabase CMS content. Apps stringify the result into a
 * `<script type="application/ld+json">`.
 *
 * ## Why WebPage and not Article
 *
 * A CMS Page is a marketing/landing surface. `Article` is the type search engines
 * treat as editorial reporting, and claiming it for a product page is a
 * misrepresentation that can be judged as structured-data spam. `WebPage` is
 * accurate, carries the parts that actually pay off — `inLanguage`,
 * `dateModified`, a `publisher` link, `isPartOf` the WebSite — and feeds the
 * answer-engine extraction that increasingly matters more than rich results.
 * `buildCmsArticleJsonLd` exists separately for content that genuinely IS an
 * article (Blog Posts).
 *
 * The real rich-result win here is `BreadcrumbList`, which is emitted alongside.
 */

/** Site-level identity every builder needs. Supplied once by the calling app. */
export interface CmsJsonLdSite {
  /** Absolute base URL with no trailing slash, e.g. "https://buda.im". */
  baseUrl: string;
  siteName?: string;
  /**
   * `@id` of the Organization node the app already emits site-wide, so these
   * nodes reference it instead of duplicating the publisher. When omitted, the
   * publisher is inlined from `siteName`, and omitted entirely without that too.
   */
  organizationId?: string;
}

export interface CmsWebPageJsonLdInput {
  /** Absolute canonical URL of the page. */
  url: string;
  title: string;
  description?: string | null;
  /** BCP-47 code of the language the body actually is. */
  lang: string;
  /** ISO 8601. */
  dateModified?: string | null;
  /** Absolute or root-relative image URL. */
  image?: string | null;
}

export interface CmsArticleJsonLdInput extends CmsWebPageJsonLdInput {
  datePublished?: string | null;
  author?: string | null;
}

export interface CmsBreadcrumbItem {
  name: string;
  /** Absolute URL. */
  url: string;
}

export interface CmsFaqEntry {
  question: string;
  answer: string;
}

const absolute = (baseUrl: string, urlOrPath: string): string =>
  /^https?:\/\//i.test(urlOrPath) ? urlOrPath : `${baseUrl}${urlOrPath}`;

const publisherOf = ({ organizationId, siteName, baseUrl }: CmsJsonLdSite) => {
  if (organizationId) return { "@id": organizationId };
  if (siteName) return { "@type": "Organization", name: siteName, url: baseUrl };
  return undefined;
};

/** Drop keys whose value is undefined so the emitted JSON stays clean. */
const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** `WebPage` node for a CMS landing/marketing Page. */
export const buildCmsWebPageJsonLd = (site: CmsJsonLdSite, input: CmsWebPageJsonLdInput) =>
  compact({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": input.url,
    url: input.url,
    name: input.title,
    description: input.description ?? undefined,
    inLanguage: input.lang,
    dateModified: input.dateModified ?? undefined,
    primaryImageOfPage: input.image
      ? { "@type": "ImageObject", url: absolute(site.baseUrl, input.image) }
      : undefined,
    isPartOf: site.siteName
      ? { "@type": "WebSite", url: site.baseUrl, name: site.siteName }
      : undefined,
    publisher: publisherOf(site),
  });

/** `Article` node — for content that genuinely is editorial, i.e. Blog Posts. */
export const buildCmsArticleJsonLd = (site: CmsJsonLdSite, input: CmsArticleJsonLdInput) =>
  compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description ?? undefined,
    inLanguage: input.lang,
    datePublished: input.datePublished ?? undefined,
    dateModified: input.dateModified ?? input.datePublished ?? undefined,
    image: input.image ? [absolute(site.baseUrl, input.image)] : undefined,
    author: input.author ? { "@type": "Person", name: input.author } : undefined,
    publisher: publisherOf(site),
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
  });

/**
 * `BreadcrumbList` node. Returns `undefined` for a trail too short to be a trail —
 * a single-item breadcrumb is noise, not navigation.
 */
export const buildCmsBreadcrumbJsonLd = (items: readonly CmsBreadcrumbItem[]) => {
  if (items.length < 2) return undefined;

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
};

// ── FAQ extraction ─────────────────────────────────────────────────────────────
// CMS bodies are stored HTML, and the FAQ convention in them is a run of
// <details><summary>question</summary>answer</details>. Extraction is deliberately
// strict: a malformed or ambiguous block yields nothing rather than a plausible-
// looking FAQPage full of wrong pairs. Wrong structured data is worse than none —
// it can be judged as spam, and unlike a missing tag nobody notices it.

const DETAILS_BLOCK = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
const SUMMARY_BLOCK = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*)$/i;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#?\w+);/g, (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match);

const toPlainText = (html: string): string =>
  decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pull question/answer pairs out of a CMS body's `<details>` blocks.
 *
 * Returns `[]` — never a partial guess — when the body has no such structure, when
 * a block has no `<summary>` as its first child, or when either side is empty.
 * Nested `<details>` are not supported and are skipped: the non-greedy match would
 * pair an outer question with an inner answer, which is exactly the silent
 * mis-pairing this function refuses to emit.
 */
export const extractCmsFaqEntries = (bodyHtml: string): CmsFaqEntry[] => {
  const entries: CmsFaqEntry[] = [];

  for (const match of bodyHtml.matchAll(DETAILS_BLOCK)) {
    const inner = match[1];
    // A nested <details> means the non-greedy outer match closed on the wrong tag.
    if (/<details\b/i.test(inner)) continue;

    const parts = SUMMARY_BLOCK.exec(inner);
    if (!parts) continue;

    const question = toPlainText(parts[1]);
    const answer = toPlainText(parts[2]);
    if (!question || !answer) continue;

    entries.push({ question, answer });
  }

  return entries;
};

/**
 * `FAQPage` node. Returns `undefined` below two entries — one "FAQ" is not a FAQ,
 * and emitting the type for it invites a structured-data warning for no gain.
 */
export const buildCmsFaqJsonLd = (entries: readonly CmsFaqEntry[]) => {
  if (entries.length < 2) return undefined;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
};

/**
 * Everything a CMS Page route needs, in one call: the WebPage node, the breadcrumb
 * trail, and a FAQPage when the body really contains one. Nodes that do not apply
 * are omitted, so the caller can render the array as-is.
 */
export const buildCmsPageJsonLd = (
  site: CmsJsonLdSite,
  input: CmsWebPageJsonLdInput & {
    breadcrumbs?: readonly CmsBreadcrumbItem[];
    bodyHtml?: string;
  },
): Array<Record<string, unknown>> => {
  const nodes: Array<Record<string, unknown> | undefined> = [
    buildCmsWebPageJsonLd(site, input),
    input.breadcrumbs ? buildCmsBreadcrumbJsonLd(input.breadcrumbs) : undefined,
    input.bodyHtml ? buildCmsFaqJsonLd(extractCmsFaqEntries(input.bodyHtml)) : undefined,
  ];

  return nodes.filter((node): node is Record<string, unknown> => node !== undefined);
};
