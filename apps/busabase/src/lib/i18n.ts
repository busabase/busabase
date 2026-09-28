import { DEMO_LOCALE_HEADER } from "openlib/ui/dashboard/demo";
import { isBusabaseAppLocale, type Locale, normalizeBusabaseAppLocale } from "~/i18n/app-locale";
import type { Locales, TranslationFunctions } from "~/i18n/i18n-types";
import { i18nObject } from "~/i18n/i18n-util";
import { loadLocale } from "~/i18n/i18n-util.sync";

export { isBusabaseAppLocale, normalizeBusabaseAppLocale };

/**
 * Server-side `LL` (route handlers, server components). It pulls in every
 * locale via `i18n-util.sync`, so client components must use
 * `useBusabaseAppLL` from `~/i18n/use-app-ll` instead.
 */
export const getBusabaseAppLL = (locale: string | undefined): TranslationFunctions => {
  const resolved = normalizeBusabaseAppLocale(locale) ?? "en";
  loadLocale(resolved as Locales);
  return i18nObject(resolved as Locales);
};

export const getBusabaseLocaleFromAcceptLanguage = (acceptLanguage: string | null): Locale => {
  const candidates =
    acceptLanguage
      ?.split(",")
      .map((part) => part.split(";")[0]?.trim())
      .filter(Boolean) ?? [];

  for (const candidate of candidates) {
    const resolved = normalizeBusabaseAppLocale(candidate);
    if (resolved) return resolved;
  }

  return "en";
};

/** The proxy forwards demo or explicit dashboard URL locale before the App Router renders. */
export const getBusabaseLocaleFromRequestHeaders = (headers: Pick<Headers, "get">): Locale =>
  normalizeBusabaseAppLocale(headers.get(DEMO_LOCALE_HEADER) ?? undefined) ??
  getBusabaseLocaleFromAcceptLanguage(headers.get("accept-language"));
