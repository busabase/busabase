import { z } from "zod";

export const i18n = {
  defaultLocale: "en",
  locales: ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt", "vi"],
  extendLocales: ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "ru", "it", "vi", "pt"],
} as const;

export type Locale = (typeof i18n)["locales"][number];

/** Each locale's name in its own language, for language pickers. */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  vi: "Tiếng Việt",
};

// Additional locales, currently used for AIGC, these languages are not yet available in the program
export type ExtendLocale = (typeof i18n)["extendLocales"][number];

export const LocaleSchema = z.enum(i18n.locales);
export type LocaleType = z.infer<typeof LocaleSchema>;
