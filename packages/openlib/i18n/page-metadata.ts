/**
 * Page-level metadata helpers: canonical URL + full hreflang alternates for a
 * single locale+path, and a `generatePageMetadata` convenience factory built on
 * top of it.
 *
 * Next.js's `generateMetadata` merges results across nested layouts/pages by
 * REPLACING each top-level key wholesale, not deep-merging. In practice this
 * causes two distinct bugs that this module fixes at the source:
 *
 *   1. A page that returns Metadata with no `alternates` key at all still
 *      INHERITS the parent layout's `alternates.canonical` verbatim — typically
 *      the site root — so every child page (docs article, blog post, ...)
 *      would otherwise claim the homepage as its own canonical URL.
 *   2. A page that returns `alternates: { canonical }` without `languages`
 *      silently WIPES OUT the hreflang tags the parent layout set up (Next
 *      does not merge `languages` in from the parent).
 *
 * `getPageAlternates` always returns a complete `{ canonical, languages }`
 * pair (every supported locale + x-default) so pages can't fall into either
 * trap. `generatePageMetadata` wraps it for the common case (matches the
 * signature the per-app `lib/metadata-helper.ts` files already exposed).
 *
 * Reuses `createCanonicalUrlHelpers` (./canonical-url.ts) rather than
 * recomputing locale-prefix logic. See that file for the layout-level
 * counterpart, and `./middleware.ts` for the i18n proxy/redirect helpers.
 */

import { createCanonicalUrlHelpers } from "./canonical-url";

/**
 * Minimal shape of the subset of Next.js's `Metadata` type this module
 * returns. Deliberately not `import type { Metadata } from "next"` — that
 * would be a static type import of Next's ambient global declarations into
 * this package's single `tsc` compilation unit, which (confirmed) makes
 * `process.env.NODE_ENV` read-only project-wide and breaks unrelated test
 * files that reassign it (e.g. `storage/factory.test.ts`). See the `any`
 * convention already used for NextRequest/NextResponse in `./middleware.ts`
 * for the same reason (openlib is consumed by non-Next.js-typed contexts).
 */
export interface PageMetadata {
  title: string;
  description: string;
  alternates: PageAlternates;
  openGraph: {
    title: string;
    description: string;
    type: "website" | "article";
    url: string;
    images: Array<{ url: string; width: number; height: number; alt: string }>;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
    images: string[];
  };
}

export interface PageAlternatesConfig<T extends string> {
  /** App's absolute base URL, e.g. "https://productready.dev" (no trailing slash) */
  baseUrl: string;
  /** Default locale whose URL prefix is hidden (e.g. 'en') */
  defaultLocale: T;
  /** Supported locales for this app */
  supportedLocales: readonly T[];
}

export interface PageAlternates {
  canonical: string;
  languages: Record<string, string>;
}

export interface PageUrlAndAlternates {
  /** Canonical URL for this locale+path (default locale prefix hidden) */
  url: string;
  /** Complete `alternates`: canonical + hreflang for every supported locale + x-default */
  alternates: PageAlternates;
}

export interface PageAlternatesHelpers {
  /**
   * Build the canonical URL and complete `alternates` for a single locale+path.
   * Use this directly when a page assembles its own Metadata shape (custom
   * openGraph/twitter fields, extra keys like `keywords`/`authors`, a
   * page-specific OG image, etc.) instead of the full `generatePageMetadata`.
   */
  getPageAlternates(locale: string, path?: string): PageUrlAndAlternates;
}

/** Create page-level alternates helpers bound to an app's base URL and locale config. */
export function createPageAlternatesHelpers<T extends string>(
  config: PageAlternatesConfig<T>,
): PageAlternatesHelpers {
  const { baseUrl, defaultLocale, supportedLocales } = config;
  const { getLocalizedUrl } = createCanonicalUrlHelpers({ defaultLocale, supportedLocales });

  function getPageAlternates(locale: string, path = ""): PageUrlAndAlternates {
    const url = getLocalizedUrl(baseUrl, locale, path);
    const languages: Record<string, string> = {};
    for (const supportedLocale of supportedLocales) {
      languages[supportedLocale] = getLocalizedUrl(baseUrl, supportedLocale, path);
    }
    languages["x-default"] = getLocalizedUrl(baseUrl, defaultLocale, path);

    return { url, alternates: { canonical: url, languages } };
  }

  return { getPageAlternates };
}

export interface PageMetadataConfig<T extends string> extends PageAlternatesConfig<T> {
  /** Default OG/Twitter image URL used when a page doesn't pass its own `imageUrl` */
  defaultImageUrl: string;
}

export interface GeneratePageMetadataOptions {
  title: string;
  description: string;
  path: string;
  lang: string;
  type?: "website" | "article";
  imageUrl?: string;
}

export interface PageMetadataHelpers extends PageAlternatesHelpers {
  /**
   * Generate OpenGraph/Twitter/alternates metadata for a page. Signature-
   * compatible with the per-app `generatePageMetadata` helpers this replaces
   * (productready/sandock/busabase-cloud/previewfile `lib/metadata-helper.ts`)
   * — apps instantiate this once with their own config and re-export the
   * result verbatim, so existing call sites need no changes.
   */
  generatePageMetadata(options: GeneratePageMetadataOptions): PageMetadata;
}

/**
 * Create a page-level `generatePageMetadata` (+ the lower-level
 * `getPageAlternates`) bound to an app's base URL, locale config, and default
 * OG image.
 */
export function createPageMetadataHelpers<T extends string>(
  config: PageMetadataConfig<T>,
): PageMetadataHelpers {
  const { defaultImageUrl, ...alternatesConfig } = config;
  const { getPageAlternates } = createPageAlternatesHelpers(alternatesConfig);

  function generatePageMetadata({
    title,
    description,
    path,
    lang,
    type = "website",
    imageUrl,
  }: GeneratePageMetadataOptions): PageMetadata {
    const { url, alternates } = getPageAlternates(lang, path);
    const image = imageUrl || defaultImageUrl;

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        type,
        url,
        images: [{ url: image, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [image],
      },
    };
  }

  return { getPageAlternates, generatePageMetadata };
}
