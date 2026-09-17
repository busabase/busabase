import { type CoreI18nMessages, type CoreLocale, coreMessagesByLocale } from "busabase-core/i18n";
import { DEMO_LOCALE_HEADER } from "openlib/ui/dashboard/demo";
import { isBusabaseAppLocale, type Locale, normalizeBusabaseAppLocale } from "~/i18n/app-locale";
import type { Locales, TranslationFunctions } from "~/i18n/i18n-types";
import { i18nObject } from "~/i18n/i18n-util";
import { loadLocale } from "~/i18n/i18n-util.sync";

export { isBusabaseAppLocale, normalizeBusabaseAppLocale };

export const isBusabaseLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

export const normalizeBusabaseLocale = (locale: string | undefined): CoreLocale | undefined => {
  if (!locale) return undefined;
  if (isBusabaseLocale(locale)) return locale;

  const normalized = locale.toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant") {
    return "zh-TW";
  }
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return undefined;
};

export const getBusabaseMessages = (locale: string | undefined): CoreI18nMessages =>
  coreMessagesByLocale[normalizeBusabaseLocale(locale) ?? "en"];

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
