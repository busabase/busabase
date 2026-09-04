import { z } from "zod";
export declare const i18n: {
  readonly defaultLocale: "en";
  readonly locales: readonly ["en", "zh-CN", "zh-TW", "ja", "ko", "de", "fr", "es", "pt"];
  readonly extendLocales: readonly [
    "en",
    "zh-CN",
    "zh-TW",
    "ja",
    "ko",
    "fr",
    "de",
    "es",
    "ru",
    "it",
    "vi",
    "pt",
  ];
};
export type Locale = (typeof i18n)["locales"][number];
export type ExtendLocale = (typeof i18n)["extendLocales"][number];
export declare const LocaleSchema: z.ZodEnum<{
  de: "de";
  en: "en";
  es: "es";
  fr: "fr";
  ja: "ja";
  ko: "ko";
  pt: "pt";
  "zh-CN": "zh-CN";
  "zh-TW": "zh-TW";
}>;
export type LocaleType = z.infer<typeof LocaleSchema>;
