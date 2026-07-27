import { type CoreI18nMessages, type CoreLocale, coreMessagesByLocale } from "busabase-core/i18n";
import { type Locale, SUPPORTED_LOCALES } from "~/i18n/config";
import type { Locales, TranslationFunctions } from "~/i18n/i18n-types";
import { i18nObject } from "~/i18n/i18n-util";
import { loadLocale } from "~/i18n/i18n-util.sync";

export const isBusabaseAppLocale = (locale: string | undefined): locale is Locale =>
  locale !== undefined && SUPPORTED_LOCALES.includes(locale as Locale);

export const isBusabaseLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

export const normalizeBusabaseAppLocale = (locale: string | undefined): Locale | undefined => {
  if (!locale) return undefined;
  if (isBusabaseAppLocale(locale)) return locale;

  const normalized = locale.toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return undefined;
};

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
