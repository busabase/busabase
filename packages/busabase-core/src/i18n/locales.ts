import type { Locale as OpenlibLocale } from "openlib/i18n/i18n";

/**
 * The locales the shared dashboard ships a catalog for. Deliberately a pure
 * module — no React, no catalogs — so server code and small helpers can ask
 * "is this a supported locale?" without importing `./index.tsx` (a client
 * module that statically pulls in every catalog).
 */
export const CORE_LOCALES = [
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

export type CoreLocale = (typeof CORE_LOCALES)[number];

export const isCoreLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && (CORE_LOCALES as readonly string[]).includes(locale);
