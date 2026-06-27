import { z } from "zod";

export const i18n = {
  defaultLocale: "en",
  locales: ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt"],
  extendLocales: ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "ru", "it", "vi", "pt"],
} as const;

export type Locale = (typeof i18n)["locales"][number];

// Additional locales, currently used for AIGC, these languages are not yet available in the program
export type ExtendLocale = (typeof i18n)["extendLocales"][number];

export const LocaleSchema = z.enum(i18n.locales);
export type LocaleType = z.infer<typeof LocaleSchema>;
