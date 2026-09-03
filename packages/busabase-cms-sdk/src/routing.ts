export interface CmsCanonicalPath {
  canonicalPath: string;
  locale: string;
  pathWithoutLocale: string;
  segments: string[];
}

export interface CmsCanonicalPathOptions {
  supportedLocales: readonly string[];
  defaultLocale?: string;
}

export type CmsTaxonomyKind = "categories" | "tags";

const normalizeSegment = (segment: string): string | null => {
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded === "." || decoded === ".." || /[\\/\0]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
};

/** Normalize a stored or requested path into a stable, decoded canonical key. */
export const normalizeCmsPath = (path: string): string | null => {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) return null;

  const segments: string[] = [];
  for (const rawSegment of path.split("/").filter(Boolean)) {
    const segment = normalizeSegment(rawSegment);
    if (segment === null) return null;
    segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};

/** Parse locale ownership from a canonical CMS path. The default locale is unprefixed. */
export const parseCmsCanonicalPath = (
  path: string,
  { supportedLocales, defaultLocale = "en" }: CmsCanonicalPathOptions,
): CmsCanonicalPath | null => {
  if (!supportedLocales.includes(defaultLocale)) return null;

  const canonicalPath = normalizeCmsPath(path);
  if (!canonicalPath || canonicalPath === "/") return null;

  const segments = canonicalPath.slice(1).split("/");
  const first = segments[0];
  if (first === defaultLocale) return null;

  const hasLocalePrefix = supportedLocales.includes(first);
  const locale = hasLocalePrefix ? first : defaultLocale;
  const contentSegments = hasLocalePrefix ? segments.slice(1) : segments;
  if (contentSegments.length === 0) return null;

  const pathWithoutLocale = `/${contentSegments.join("/")}`;
  return {
    canonicalPath: locale === defaultLocale ? pathWithoutLocale : `/${locale}${pathWithoutLocale}`,
    locale,
    pathWithoutLocale,
    segments: contentSegments,
  };
};

export const buildCmsCanonicalPath = (
  locale: string,
  path: string | readonly string[],
  options: CmsCanonicalPathOptions,
): string | null => {
  if (!options.supportedLocales.includes(locale)) return null;

  const contentPath = Array.isArray(path) ? path.join("/") : path;
  const localePrefix = locale === (options.defaultLocale ?? "en") ? "" : `/${locale}`;
  return parseCmsCanonicalPath(`${localePrefix}/${contentPath}`, options)?.canonicalPath ?? null;
};

export const isCmsContentForLocale = (
  item: { locale: string; path: string },
  locale: string,
  options: CmsCanonicalPathOptions,
): boolean => {
  const parsed = parseCmsCanonicalPath(item.path, options);
  return item.locale === locale && parsed?.locale === locale;
};

export const isCmsBlogPostPath = (path: string, options: CmsCanonicalPathOptions): boolean => {
  const parsed = parseCmsCanonicalPath(path, options);
  return parsed?.segments[0] === "blog" && parsed.segments.length > 1;
};

/** Build a locale-aware archive URL for a Category or Tag record. */
export const buildCmsTaxonomyArchivePath = (
  kind: CmsTaxonomyKind,
  taxonomy: { locale: string; slug: string },
  options: CmsCanonicalPathOptions,
): string | null => buildCmsCanonicalPath(taxonomy.locale, [kind, taxonomy.slug], options);

/**
 * A `CmsCanonicalPathOptions` bound once into ready-to-call helpers — every app consuming
 * busabase-cms was hand-rolling the same `buildXPath`/`parseXPath`/`isXForLocale` wrappers
 * around its own copy of `{ supportedLocales, defaultLocale }`. Call this once per app with
 * its locale config and pass the result around instead of re-deriving these closures.
 */
export interface CmsPathHelpers {
  readonly options: CmsCanonicalPathOptions;
  normalizePath: (path: string) => string | null;
  parsePath: (path: string) => CmsCanonicalPath | null;
  buildPath: (locale: string, path: string | readonly string[]) => string | null;
  isForLocale: (item: { locale: string; path: string }, locale: string) => boolean;
  /** A record is valid content when its path parses AND actually belongs to its own claimed locale. */
  isValidContent: (item: { locale: string; path: string }) => boolean;
  isBlogPostPath: (path: string) => boolean;
  buildTaxonomyArchivePath: (
    kind: CmsTaxonomyKind,
    taxonomy: { locale: string; slug: string },
  ) => string | null;
}

export const createCmsPathHelpers = (options: CmsCanonicalPathOptions): CmsPathHelpers => ({
  options,
  normalizePath: normalizeCmsPath,
  parsePath: (path) => parseCmsCanonicalPath(path, options),
  buildPath: (locale, path) => buildCmsCanonicalPath(locale, path, options),
  isForLocale: (item, locale) => isCmsContentForLocale(item, locale, options),
  isValidContent: (item) => isCmsContentForLocale(item, item.locale, options),
  isBlogPostPath: (path) => isCmsBlogPostPath(path, options),
  buildTaxonomyArchivePath: (kind, taxonomy) =>
    buildCmsTaxonomyArchivePath(kind, taxonomy, options),
});

/** Select Posts related to one taxonomy record without mixing locales. */
export const filterCmsPostsByTaxonomy = <
  T extends { locale: string; categoryIds: readonly string[]; tagIds: readonly string[] },
>(
  posts: readonly T[],
  kind: CmsTaxonomyKind,
  taxonomy: { id: string; locale: string },
): T[] => {
  const relationKey = kind === "categories" ? "categoryIds" : "tagIds";
  return posts.filter(
    (post) => post.locale === taxonomy.locale && post[relationKey].includes(taxonomy.id),
  );
};
