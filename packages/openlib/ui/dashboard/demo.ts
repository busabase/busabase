/**
 * Demo Mode Utilities (Shared)
 *
 * Demo mode is activated by a `?demo=…` URL param (`?demo=1` or a named use-case),
 * with an optional `?lang` selecting the demo dataset locale. Everything funnels
 * through `resolveDemoMode` — the one reader for both server and client.
 *
 * Note: Mock data (DEMO_USERS, DEMO_POSTS, …) lives in each app since it depends on
 * app-specific schema types.
 */

/** Header an app's proxy sets from the page `?lang` so RPC requests carry it. */
export const DEMO_LOCALE_HEADER = "x-demo-locale";

/** Demo dataset locale. Matches `DemoLocale` in busabase-core. */
export type DemoLocaleValue = "en" | "zh-CN";

/** A raw `?demo` value, or null for the "not demo" sentinels (``/`0`/`false`/`off`). */
const getActiveDemoFromValue = (value: string | null | undefined): string | null =>
  value && value !== "0" && value !== "false" && value !== "off" ? value : null;

/** `zh` / `zh-CN` (any case) → Chinese; anything else (incl. null) → English. */
const normalizeDemoLocale = (raw: string | null | undefined): DemoLocaleValue =>
  raw && /^zh(-cn)?$/i.test(raw.trim()) ? "zh-CN" : "en";

/** Read a query param from explicit searchParams, or the live URL when omitted (SSR-safe). */
function readParam(
  key: string,
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  if (!searchParams) {
    return typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get(key);
  }
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key);
  }
  const value = searchParams[key];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Both demo signals (`?demo` use-case + `?lang` locale) resolved together. */
export interface DemoMode {
  /** Raw `?demo` value (`"1"` / a named use-case), or null when not in demo mode. */
  useCase: string | null;
  /** Demo dataset locale from `?lang` (defaults to English). */
  locale: DemoLocaleValue;
}

/**
 * THE demo reader — interprets `?demo` + `?lang` for both server and client.
 *
 * - Server (API route): pass `searchParams` AND `headers` so it also reads the
 *   proxy-bridged `x-demo-mode` / `x-demo-locale` headers.
 * - Client: call with no args to read the current page URL (`window.location`).
 *
 * `useCase` is the RAW `?demo` value; apps with named use-cases validate it where it
 * is consumed (busabase-core's context normalizes it into a typed `DemoUseCase`).
 */
export function resolveDemoMode(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined>,
  headers?: Pick<Headers, "get">,
): DemoMode {
  // Query wins, then the proxy-bridged header (sentinels filtered on each independently).
  const useCase =
    getActiveDemoFromValue(readParam("demo", searchParams)) ??
    getActiveDemoFromValue(headers?.get("x-demo-mode"));
  const locale = normalizeDemoLocale(
    readParam("lang", searchParams) ?? headers?.get(DEMO_LOCALE_HEADER),
  );
  return { useCase, locale };
}

/**
 * Append the active `?demo` (and `?lang`, when the demo is non-English) to a URL so
 * the demo survives navigation. No-op outside demo mode or when `?demo=` is already
 * present. Reads the current page URL, so call client-side.
 */
export function addDemoParam(url: string): string {
  const { useCase, locale } = resolveDemoMode();
  if (!useCase || /[?&]demo=/.test(url)) {
    return url;
  }
  let next = `${url}${url.includes("?") ? "&" : "?"}demo=${encodeURIComponent(useCase)}`;
  if (locale === "zh-CN" && !/[?&]lang=/.test(next)) {
    next += "&lang=zh-CN";
  }
  return next;
}
