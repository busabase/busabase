/**
 * Everything an MDX-only blog route needs for its structured data, in ONE call: works out the
 * locale the body really is (fumadocs `fallbackLanguage` serves the default-locale file for an
 * untranslated locale), asks for the breadcrumb labels in that locale, and returns
 * `buildBlogPostJsonLd`'s `BlogPosting` + `BreadcrumbList`.
 *
 * The MDX counterpart of busabase-cms-sdk's `createCmsPostResolver(...).resolvePostJsonLd`:
 * same rule (the canonical URL and `inLanguage` follow the CONTENT locale, never the requested
 * one), without the CMS. App specifics — the site config, the i18n dictionary — come in as
 * arguments, so this stays free of any app import.
 */

import { getLocalPostLocales } from "../i18n/local-post-locales";
import { type BlogPostJsonLdSite, buildBlogPostJsonLd } from "./blog-post-jsonld";

/** What the JSON-LD reads off a local post. A fumadocs YAML `date:` arrives as a `Date`. */
export interface LocalPostJsonLdFields {
  title: string;
  description?: string | null;
  image?: string | null;
  datePublished?: string | Date | null;
  dateModified?: string | Date | null;
  author?: string | null;
}

/** A breadcrumb label for a locale: a fixed string, or a lookup (e.g. loading a dictionary). */
export type LocalPostJsonLdLabel = (locale: string) => string | Promise<string>;

export interface ResolveLocalPostJsonLdOptions<TPage extends { data: unknown }> {
  /** The fumadocs `loader()` result the route reads the post from. */
  source: { getPage: (slugs: string[], locale: string) => TPage | undefined };
  /** Site identity; `site.defaultLocale` is also the fallback locale fumadocs serves. */
  site: BlogPostJsonLdSite;
  /** Every locale the app routes, for the "does this locale have its own file" probe. */
  supportedLocales: readonly string[];
  /** The post's slug segments under `/blog`. */
  slugs: string[];
  /** The locale in the URL — not necessarily the language of the body. */
  lang: string;
  /** Breadcrumb root label, asked for in the CONTENT locale. Default "Home". */
  homeLabel?: LocalPostJsonLdLabel;
  /** Breadcrumb label of the blog index, asked for in the CONTENT locale. Default "Blog". */
  blogLabel?: LocalPostJsonLdLabel;
  /**
   * Read the post's fields. Default: fumadocs frontmatter `title` / `description` / `image` /
   * `date` / `lastModified` / `author` — the same fields the SDK resolver's default reads.
   * Override for an app whose cover lives elsewhere (e.g. `cover`).
   */
  getFields?: (page: TPage) => LocalPostJsonLdFields;
}

const readFrontmatter = (page: { data: unknown }): LocalPostJsonLdFields => {
  const data = (page.data ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const date = (value: unknown) =>
    typeof value === "string" || value instanceof Date ? value : undefined;
  return {
    title: text(data.title) ?? "",
    description: text(data.description),
    image: text(data.image),
    datePublished: date(data.date),
    dateModified: date(data.lastModified),
    author: text(data.author),
  };
};

/** `[]` when the post does not exist at that slug — nothing to describe. */
export const resolveLocalPostJsonLd = async <TPage extends { data: unknown }>({
  source,
  site,
  supportedLocales,
  slugs,
  lang,
  homeLabel = () => "Home",
  blogLabel = () => "Blog",
  getFields = readFrontmatter,
}: ResolveLocalPostJsonLdOptions<TPage>): Promise<Array<Record<string, unknown>>> => {
  const page = source.getPage(slugs, lang);
  if (!page) return [];

  const contentLocale = getLocalPostLocales(
    source,
    supportedLocales,
    site.defaultLocale,
    slugs,
  ).includes(lang)
    ? lang
    : site.defaultLocale;
  const [home, blog] = await Promise.all([homeLabel(contentLocale), blogLabel(contentLocale)]);

  return buildBlogPostJsonLd(site, {
    ...getFields(page),
    path: `/blog/${slugs.join("/")}`,
    lang: contentLocale,
    homeLabel: home,
    blogLabel: blog,
  });
};
