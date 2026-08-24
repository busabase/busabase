"use client";

/**
 * Shared client wrapper for the `[lang]/layout-client.tsx` present in every
 * fumadocs-based app (busabase-cloud, productready, acprouter-cloud, inpomo,
 * insure, sandock-cloud, buda). Provides NProgress navigation feedback on
 * locale changes and wires the fumadocs `RootProvider` i18n config.
 *
 * Each app keeps a thin `layout-client.tsx` that calls `LangLayoutClient`
 * with its own `defineI18nUI(...)` result (so per-app translation tables —
 * e.g. sandock-cloud has no `ja` entry, buda has 6 locales — are preserved
 * untouched).
 *
 * Deliberately does NOT override `RootProvider`'s `i18n.onLocaleChange`. A
 * previous version pushed a client-computed, prefix-stripped path directly
 * via `next/navigation`'s `router.push`, which was found in production
 * (busabase.com, inpomo.app, productready.dev, sandock.ai) to silently no-op
 * on locale switch — the cookie was written but no navigation occurred, and
 * this did not reproduce in local dev. Leaving `onLocaleChange` unset falls
 * back to fumadocs-ui's own default handler, which always pushes a
 * locale-prefixed path (e.g. `/en`, even when `en` is the default locale)
 * and relies on the server-side `createDefaultLocaleRedirect` middleware
 * (see `./middleware.ts`) to 308-redirect that down to the canonical,
 * prefix-less path. This is the same shape `apps/buda`'s hand-rolled
 * `layout-client.tsx` already used, and it round-trips correctly in
 * production. See `changelog/20260821-lang-switcher-fix-default-onchange.md`.
 */

import type { I18nProviderProps } from "fumadocs-ui/contexts/i18n";
import { RootProvider } from "fumadocs-ui/provider/next";
import { usePathname } from "next/navigation";
import type React from "react";
import { Suspense, useEffect } from "react";
import { NProgressProvider } from "../ui/nprogress";

export interface LangLayoutClientProps<Locale extends string> {
  lang: Locale;
  children: React.ReactNode;
  /** `provider` returned by each app's `defineI18nUI(i18n, { translations })` call. */
  provider: (locale: Locale) => I18nProviderProps;
  /**
   * Forwarded verbatim to `RootProvider`'s `theme` prop. sandock-cloud sets
   * `{ forcedTheme: "dark" }`; buda sets `{ enabled: false }` (disables the
   * theme toggle entirely — buda has never shown a theme switcher on its
   * marketing pages). Other apps omit it.
   */
  theme?: React.ComponentProps<typeof RootProvider>["theme"];
  /**
   * Only buda sets this. Re-derives the active locale from the current URL
   * pathname (first segment) instead of trusting the `lang` prop directly.
   * Added in buda's PR #3511 ("Fix Buda SEO metadata and sitemap issues") to
   * fix `<html lang>` not updating after a locale switch — see `syncHtmlLang`
   * below, which depends on this resolved value.
   */
  resolvePathnameLocale?: { supportedLocales: readonly Locale[] };
  /**
   * Only buda sets this. Keeps `document.documentElement.lang` in sync with
   * the resolved locale (see `resolvePathnameLocale`). Also from PR #3511.
   */
  syncHtmlLang?: boolean;
}

function resolveLocaleFromPathname<Locale extends string>(
  pathname: string,
  supportedLocales: readonly Locale[],
  fallback: Locale,
): Locale {
  const segment = pathname.split("/")[1];
  return supportedLocales.includes(segment as Locale) ? (segment as Locale) : fallback;
}

export function LangLayoutClient<Locale extends string>({
  lang,
  children,
  provider,
  theme,
  resolvePathnameLocale,
  syncHtmlLang,
}: LangLayoutClientProps<Locale>) {
  const pathname = usePathname();
  const currentLang = resolvePathnameLocale
    ? resolveLocaleFromPathname(pathname, resolvePathnameLocale.supportedLocales, lang)
    : lang;
  const i18nConfig = provider(currentLang);

  useEffect(() => {
    if (syncHtmlLang) document.documentElement.lang = currentLang;
  }, [currentLang, syncHtmlLang]);

  return (
    <RootProvider i18n={i18nConfig} {...(theme ? { theme } : {})}>
      <Suspense fallback={children}>
        <NProgressProvider>{children}</NProgressProvider>
      </Suspense>
    </RootProvider>
  );
}
