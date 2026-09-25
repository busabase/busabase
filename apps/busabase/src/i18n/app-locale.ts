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
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const isBusabaseAppLocale = (locale: string | undefined): locale is Locale =>
  locale !== undefined && SUPPORTED_LOCALES.includes(locale as Locale);

export const normalizeBusabaseAppLocale = (locale: string | undefined): Locale | undefined => {
  if (!locale) return undefined;
  if (isBusabaseAppLocale(locale)) return locale;

  const normalized = locale.toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-hant") return "zh-TW";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  if (normalized === "pt" || normalized.startsWith("pt-")) return "pt";
  if (normalized === "vi" || normalized.startsWith("vi-")) return "vi";
  if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
  if (normalized === "de" || normalized.startsWith("de-")) return "de";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return undefined;
};
