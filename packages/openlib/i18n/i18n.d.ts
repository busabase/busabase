import { z } from "zod";
export declare const i18n: {
  readonly defaultLocale: "en";
  readonly locales: readonly ["en", "zh-CN", "zh-TW", "ja", "pt", "de"];
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
  en: "en";
  "zh-CN": "zh-CN";
  "zh-TW": "zh-TW";
  ja: "ja";
  pt: "pt";
  de: "de";
}>;
export type LocaleType = z.infer<typeof LocaleSchema>;
