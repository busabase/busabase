/**
 * Middleware utilities for cookie-based language detection
 * Used by apps with marketing pages that need URL-based i18n
 */

// Cookie configuration - for webpage/marketing pages only (dashboard uses DB)
export const LANG_COOKIE_NAME = "webpage_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

// Default paths that skip i18n (dashboard routes, API, etc.)
// Apps can override or extend this list
export const DEFAULT_I18N_SKIP_PATHS = [
  "/api",
  "/dashboard",
  "/dashboard-nested",
  "/agents",
  "/spaces",
  "/systemadmin",
  "/redeem",
  "/og",
  "/llms-full.txt",
  "/sitemap.xml",
  "/robots.txt",
  "/llms.txt",
];

/**
 * Create language options for dashboard settings dropdown
 * @param supportedLocales - Array of supported locale codes
 * @param displayNames - Record mapping locale codes to display names
 * @param autoLabels - Record mapping locale codes to "Auto" option labels
 * @param currentLocale - Current UI locale for "Auto" label
 */
export function createLanguageOptions<T extends string>(
  supportedLocales: readonly T[],
  displayNames: Record<T, string>,
  autoLabels: Record<T, string>,
  currentLocale: T = "en" as T,
) {
  const autoName = autoLabels[currentLocale] || "Auto (Browser)";
  return [
    { code: "auto", label: autoName, name: autoName, nativeName: autoName },
    ...supportedLocales.map((locale) => {
      const name = displayNames[locale];
      return {
        code: locale,
        label: name,
        name,
        nativeName: name,
      };
    }),
  ];
}

/**
 * Get locale from cookie value
 * Returns null if cookie doesn't exist or contains unsupported locale
 */
export function getLocaleFromCookie<T extends string>(
  cookieValue: string | undefined,
  supportedLocales: readonly T[],
): T | null {
  if (cookieValue && supportedLocales.includes(cookieValue as T)) {
    return cookieValue as T;
  }
  return null;
}

/**
 * Get locale from URL path (first segment)
 * Returns null if path doesn't start with a supported locale
 */
export function getLocaleFromPath<T extends string>(
  pathname: string,
  supportedLocales: readonly T[],
): T | null {
  const segments = pathname.split("/");
  const firstSegment = segments[1]; // segments[0] is empty string
  if (firstSegment && supportedLocales.includes(firstSegment as T)) {
    return firstSegment as T;
  }
  return null;
}

function matchesPathBoundary(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * Transform a path from one locale to another
 * Handles both prefixed paths (/zh-CN/docs) and unprefixed paths (/docs for default locale)
 */
export function transformPathToLocale<T extends string>(
  pathname: string,
  targetLocale: T,
  supportedLocales: readonly T[],
  defaultLocale: T = "en" as T,
): string {
  const segments = pathname.split("/").filter(Boolean);

  // Check if first segment is a locale
  const firstSegment = segments[0];
  const hasLocalePrefix = supportedLocales.includes(firstSegment as T);

  if (hasLocalePrefix) {
    // Replace existing locale prefix
    segments[0] = targetLocale;
  } else {
    // No locale prefix - add target locale if not default
    if (targetLocale !== defaultLocale) {
      segments.unshift(targetLocale);
    }
  }

  // If target is default locale and we have a locale prefix, remove it
  if (targetLocale === defaultLocale && hasLocalePrefix) {
    segments.shift();
  }

  return `/${segments.join("/")}` || "/";
}

/**
 * Set language cookie in browser (client-side)
 */
export function setLanguageCookie(locale: string): void {
  if (typeof document === "undefined") return;
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API not widely supported
  document.cookie = `${LANG_COOKIE_NAME}=${locale};path=/;max-age=${LANG_COOKIE_MAX_AGE};samesite=lax`;
}

// ============================================
// Server-side middleware helpers (Next.js)
// Note: Uses 'any' for NextRequest/NextResponse to avoid version conflicts
// between sharelib and app's next versions
// ============================================

/** Set locale cookie on NextResponse */
export function setLocaleCookieOnResponse<T extends string>(response: any, locale: T): any {
  response.cookies.set(LANG_COOKIE_NAME, locale, {
    path: "/",
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}

/** Get locale from NextRequest cookie */
export function getLocaleFromRequest<T extends string>(
  req: any,
  supportedLocales: readonly T[],
): T | null {
  return getLocaleFromCookie(req.cookies.get(LANG_COOKIE_NAME)?.value, supportedLocales);
}

/**
 * Parse Accept-Language header and return best matching locale
 * Example: "zh-CN,zh;q=0.9,en;q=0.8" -> "zh-CN" if supported
 */
export function getLocaleFromAcceptLanguage<T extends string>(
  acceptLanguage: string | null,
  supportedLocales: readonly T[],
  defaultLocale: T,
): T {
  if (!acceptLanguage) return defaultLocale;

  // Parse Accept-Language header: "zh-CN,zh;q=0.9,en;q=0.8"
  const languages = acceptLanguage
    .split(",")
    .map((lang) => {
      const [code, qValue] = lang.trim().split(";q=");
      return {
        code: code.trim(),
        quality: qValue ? Number.parseFloat(qValue) : 1.0,
      };
    })
    .sort((a, b) => b.quality - a.quality);

  // Find first matching supported locale
  for (const { code } of languages) {
    // Exact match (e.g., "zh-CN")
    if (supportedLocales.includes(code as T)) {
      return code as T;
    }
    // Base language match (e.g., "zh" matches "zh-CN")
    const baseCode = code.split("-")[0];
    const match = supportedLocales.find((locale) => locale.startsWith(baseCode));
    if (match) {
      return match;
    }
  }

  return defaultLocale;
}

export interface I18nProxyConfig<T extends string> {
  /** Supported locales for this app */
  supportedLocales: readonly T[];
  /** Default locale (usually 'en') */
  defaultLocale: T;
  /** Paths to skip i18n middleware (dashboard routes, API, etc.) */
  skipPaths: string[];
  /** Fumadocs i18n middleware function */
  i18nMiddleware: (req: any, ev: any) => any;
  /** Enable Accept-Language based redirect for first-time visitors (default: true) */
  detectBrowserLanguage?: boolean;
}

/**
 * Create i18n proxy handler for Next.js middleware
 * Handles cookie-based language persistence with Fumadocs
 *
 * Priority order:
 * 1. URL language prefix (/zh-CN/...) - highest priority
 * 2. Cookie (webpage_lang) - returning visitors
 * 3. Accept-Language header - first-time visitors
 * 4. Default locale - fallback
 */
export function createI18nProxy<T extends string>(config: I18nProxyConfig<T>) {
  const {
    supportedLocales,
    defaultLocale,
    skipPaths,
    i18nMiddleware,
    detectBrowserLanguage = true,
  } = config;

  return async (req: any, ev: any) => {
    // Dynamically import NextResponse to use app's version
    const { NextResponse } = await import("next/server");
    const { pathname } = req.nextUrl;

    // Skip i18n for configured paths - must return NextResponse.next() for Next.js 16+
    if (skipPaths.some((path: string) => matchesPathBoundary(pathname, path))) {
      return NextResponse.next();
    }

    // 1. Check if URL already has a language prefix
    const pathLocale = getLocaleFromPath(pathname, supportedLocales);

    if (pathLocale) {
      // URL has language prefix - set cookie and continue
      const response = await i18nMiddleware(req, ev);
      if (response?.cookies && typeof response.cookies.set === "function") {
        return setLocaleCookieOnResponse(response, pathLocale);
      }
      const nextResponse = NextResponse.next();
      return setLocaleCookieOnResponse(nextResponse, pathLocale);
    }

    // 2. No language prefix - check cookie for returning visitors
    const cookieLocale = getLocaleFromRequest(req, supportedLocales);

    if (cookieLocale && cookieLocale !== defaultLocale) {
      // Redirect to preferred locale from cookie
      const url = req.nextUrl.clone();
      url.pathname = `/${cookieLocale}${pathname}`;
      const response = NextResponse.redirect(url);
      return setLocaleCookieOnResponse(response, cookieLocale);
    }

    // 3. First-time visitor - detect from Accept-Language header
    if (detectBrowserLanguage && !cookieLocale) {
      const acceptLanguage = req.headers.get("accept-language");
      const detectedLocale = getLocaleFromAcceptLanguage(
        acceptLanguage,
        supportedLocales,
        defaultLocale,
      );

      if (detectedLocale !== defaultLocale) {
        // Redirect to detected locale and set cookie
        const url = req.nextUrl.clone();
        url.pathname = `/${detectedLocale}${pathname}`;
        const response = NextResponse.redirect(url);
        return setLocaleCookieOnResponse(response, detectedLocale);
      }

      // Detected locale is default - set cookie to remember and continue
      const response = await i18nMiddleware(req, ev);
      if (response?.cookies && typeof response.cookies.set === "function") {
        return setLocaleCookieOnResponse(response, defaultLocale);
      }
      const nextResponse = NextResponse.next();
      return setLocaleCookieOnResponse(nextResponse, defaultLocale);
    }

    // 4. Fallback to Fumadocs middleware
    return i18nMiddleware(req, ev);
  };
}
