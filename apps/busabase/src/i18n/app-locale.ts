export const SUPPORTED_LOCALES = ["en", "zh-CN", "ja"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const isBusabaseAppLocale = (locale: string | undefined): locale is Locale =>
  locale !== undefined && SUPPORTED_LOCALES.includes(locale as Locale);

export const normalizeBusabaseAppLocale = (locale: string | undefined): Locale | undefined => {
  if (!locale) return undefined;
  if (isBusabaseAppLocale(locale)) return locale;

  const normalized = locale.toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";

  return undefined;
};
