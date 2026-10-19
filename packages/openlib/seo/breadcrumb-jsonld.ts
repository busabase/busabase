/** One step of a breadcrumb trail; `path` is locale-neutral (`/`, `/docs`, `/blog/x`). */
export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface BreadcrumbJsonLdOptions {
  /** Absolute origin, no trailing slash (`https://buda.im`). */
  siteUrl: string;
  /** The page's locale; non-default locales are prefixed (`/zh-CN/docs`). */
  lang: string;
  /** The unprefixed locale. Default `en`. */
  defaultLanguage?: string;
}

/** A schema.org `BreadcrumbList` for a localized marketing page. */
export const buildBreadcrumbJsonLd = (
  items: readonly BreadcrumbItem[],
  { siteUrl, lang, defaultLanguage = "en" }: BreadcrumbJsonLdOptions,
) => {
  const localePrefix = lang === defaultLanguage ? "" : `/${lang}`;

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      // A locale root is the home page, whose canonical has no trailing slash
      // (`https://buda.im`, `https://buda.im/zh-CN`) — the same URL post breadcrumbs use.
      item: `${siteUrl}${localePrefix}${item.path === "/" ? "" : item.path}`,
    })),
  };
};
