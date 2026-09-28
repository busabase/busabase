import type { Locale as OpenlibLocale } from "openlib/i18n";

// The one list of locales this app ships. `satisfies` makes listing a locale
// that openlib does not know about a compile error.
export const SUPPORTED_LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "pt",
  "vi",
  "fr",
  "de",
] as const satisfies readonly OpenlibLocale[];

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const isBusabaseAppLocale = (locale: string | undefined): locale is Locale =>
  locale !== undefined && SUPPORTED_LOCALES.includes(locale as Locale);

const TRADITIONAL_CHINESE = new Set(["zh-tw", "zh-hk", "zh-hant"]);

const languageOf = (locale: Locale) => locale.split("-")[0].toLowerCase();

/** Maps browser/stored tags (`ja-JP`, `zh-Hans`, `pt-BR`, …) onto a supported locale. */
export const normalizeBusabaseAppLocale = (locale: string | undefined): Locale | undefined => {
  if (!locale) return undefined;
  if (isBusabaseAppLocale(locale)) return locale;

  const normalized = locale.toLowerCase();
  if (TRADITIONAL_CHINESE.has(normalized)) return "zh-TW";

  // First match wins, so a bare or any other `zh-*` tag resolves to zh-CN.
  return SUPPORTED_LOCALES.find((supported) => {
    const language = languageOf(supported);
    return normalized === language || normalized.startsWith(`${language}-`);
  });
};
