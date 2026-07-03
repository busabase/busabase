import { type CoreI18nMessages, type CoreLocale, coreMessagesByLocale } from "busabase-core/i18n";
import { type Locale, SUPPORTED_LOCALES } from "~/i18n/config";
import type { Locales, TranslationFunctions } from "~/i18n/i18n-types";
import { i18nObject } from "~/i18n/i18n-util";
import { loadLocale } from "~/i18n/i18n-util.sync";

export const isBusabaseAppLocale = (locale: string | undefined): locale is Locale =>
  locale !== undefined && SUPPORTED_LOCALES.includes(locale as Locale);

export const isBusabaseLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

export const getBusabaseMessages = (locale: string | undefined): CoreI18nMessages =>
  isBusabaseLocale(locale) ? coreMessagesByLocale[locale] : coreMessagesByLocale.en;

export const getBusabaseAppLL = (locale: string | undefined): TranslationFunctions => {
  const resolved = isBusabaseAppLocale(locale) ? locale : "en";
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
    if (isBusabaseAppLocale(candidate)) {
      return candidate;
    }
    const language = candidate.split("-")[0];
    if (language === "zh") {
      return "zh-CN";
    }
    if (language === "ja") {
      return "ja";
    }
  }

  return "en";
};
