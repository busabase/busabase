import type { CmsCanonicalPath } from "./routing";

/**
 * Which CMS records a site index lists — the facts behind `/llms.txt`-style link lists.
 *
 * The SDK decides *which* records are one locale's own canonical, published pages, and at
 * which locale-free path they live. How those entries are grouped and rendered is the app's
 * business (apps typically share one formatter), so this module returns plain data and no text.
 */

/** The record fields an index reads — satisfied by `PostVO` and `PageSummaryVO` (and `PageVO`). */
export interface CmsIndexRecord {
  path: string;
  title: string;
  locale: string;
  canonicalUrl: string | null;
  seoDescription: string | null;
  /** Posts only. */
  description?: string | null;
  /** Posts only. */
  publishedAt?: string | null;
  updatedAt: string;
}

/** One listable record, reduced to what an index needs. */
export interface CmsIndexEntry {
  /** The record's canonical path, e.g. `/compare/busabase-vs-notion` (default locale: no prefix). */
  canonicalPath: string;
  /** Locale-free path segments, e.g. `["compare", "busabase-vs-notion"]`. */
  segments: string[];
  title: string;
  /**
   * The editor's SEO description when it is set, else the record's own description, verbatim
   * (the formatter owns whitespace handling). `null` when neither has any text.
   */
  description: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface CmsIndexEntries {
  posts: CmsIndexEntry[];
  pages: CmsIndexEntry[];
}

export interface SelectCmsIndexEntriesOptions {
  /** The app's bound path parser (`cmsPathHelpers.parsePath`). */
  parsePath: (
    path: string,
  ) => Pick<CmsCanonicalPath, "canonicalPath" | "locale" | "segments"> | null;
  /** Only this locale's records are listed. Default `en`. */
  locale?: string;
}

const hasText = (value: string | null | undefined): value is string => Boolean(value?.trim());

/** The pathname a `canonical-url` names, or `null` when it is not a URL. */
const canonicalUrlPath = (canonicalUrl: string): string | null => {
  try {
    return new URL(canonicalUrl).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
};

/**
 * The records that are `locale`'s own canonical page, in input order, one per path.
 *
 * - The path must parse, and its locale must agree with the record's `locale` field.
 * - A record whose `canonical-url` names a different page is declaring itself a duplicate,
 *   so it is left out rather than listed under a URL search engines are told to ignore.
 * - Records without a title are skipped; a repeated path keeps the first record seen.
 *
 * Published-only is the caller's input contract: the SDK's record mappers (and therefore
 * every `list*` read) only ever return `status: "published"` records.
 */
export const selectCmsIndexEntries = (
  records: readonly CmsIndexRecord[],
  { parsePath, locale = "en" }: SelectCmsIndexEntriesOptions,
): CmsIndexEntry[] => {
  const seen = new Set<string>();
  const entries: CmsIndexEntry[] = [];

  for (const record of records) {
    const parsed = parsePath(record.path);
    if (!parsed || parsed.locale !== locale || record.locale !== locale) continue;
    if (!hasText(record.title)) continue;
    if (record.canonicalUrl && canonicalUrlPath(record.canonicalUrl) !== parsed.canonicalPath) {
      continue;
    }
    if (seen.has(parsed.canonicalPath)) continue;
    seen.add(parsed.canonicalPath);

    entries.push({
      canonicalPath: parsed.canonicalPath,
      segments: [...parsed.segments],
      title: record.title,
      description: hasText(record.seoDescription)
        ? record.seoDescription
        : hasText(record.description)
          ? record.description
          : null,
      publishedAt: record.publishedAt ?? null,
      updatedAt: record.updatedAt,
    });
  }

  return entries;
};
