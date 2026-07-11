/**
 * Canonical URL / localized-path helpers for marketing pages.
 *
 * Parameterized by each app's `defaultLocale`/`supportedLocales` instead of a
 * hardcoded app config, so a single implementation can be shared. This mirrors
 * (and is the shared home for) the per-app `lib/i18n/canonical-url.ts` files
 * (sandock, busabase-cloud, previewfile, productready), which should delegate
 * here rather than reimplementing this logic.
 *
 * See `./middleware.ts` for the analogous i18n proxy middleware helpers.
 */

import { transformPathToLocale } from "./middleware";

export interface CanonicalUrlConfig<T extends string> {
  /** Default locale whose URL prefix is hidden (e.g. 'en') */
  defaultLocale: T;
  /** Supported locales for this app, used by buildLocalizedPath */
  supportedLocales: readonly T[];
}

export interface CanonicalUrlHelpers {
  /** Build a locale-prefixed path (no prefix for the default locale). */
  getLocalizedPath(locale: string, path?: string): string;
  /** Build a full locale-prefixed URL from a base URL. */
  getLocalizedUrl(baseUrl: string, locale: string, path?: string): string;
  /** Strip the default locale's URL prefix from a pathname, e.g. "/en/docs" -> "/docs". */
  canonicalizeDefaultLocalePath(pathname: string): string;
  /** Build the canonical (default-locale-prefix-less) URL for a pathname. */
  getCanonicalUrl(baseUrl: string, pathname: string): string;
  /** Rewrite a pathname to target a different locale, replacing any existing locale prefix. */
  buildLocalizedPath(pathname: string, nextLocale: string): string;
}

/**
 * Create locale-aware canonical URL helpers bound to an app's default locale and
 * supported locale list.
 */
export function createCanonicalUrlHelpers<T extends string>(
  config: CanonicalUrlConfig<T>,
): CanonicalUrlHelpers {
  const { defaultLocale, supportedLocales } = config;

  function getLocalizedPath(locale: string, path = ""): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const suffix = normalizedPath === "/" ? "" : normalizedPath;

    if (locale === defaultLocale) {
      return suffix || "/";
    }

    return `/${locale}${suffix}`;
  }

  function getLocalizedUrl(baseUrl: string, locale: string, path = ""): string {
    const localizedPath = getLocalizedPath(locale, path);
    return localizedPath === "/" ? baseUrl : `${baseUrl}${localizedPath}`;
  }

  function canonicalizeDefaultLocalePath(pathname: string): string {
    const defaultLocalePrefix = `/${defaultLocale}`;
    if (pathname === defaultLocalePrefix) return "/";
    if (pathname.startsWith(`${defaultLocalePrefix}/`)) {
      return pathname.slice(defaultLocalePrefix.length) || "/";
    }
    return pathname;
  }

  function getCanonicalUrl(baseUrl: string, pathname: string): string {
    const canonicalPath = canonicalizeDefaultLocalePath(pathname);
    return canonicalPath === "/" ? baseUrl : `${baseUrl}${canonicalPath}`;
  }

  function buildLocalizedPath(pathname: string, nextLocale: string): string {
    return transformPathToLocale(pathname, nextLocale, supportedLocales, defaultLocale);
  }

  return {
    getLocalizedPath,
    getLocalizedUrl,
    canonicalizeDefaultLocalePath,
    getCanonicalUrl,
    buildLocalizedPath,
  };
}
