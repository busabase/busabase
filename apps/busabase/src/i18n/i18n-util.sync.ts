import en from "./en";
import { isLocaleLoaded, loadLocale as loadLocaleData } from "./i18n-core";
import type { Locales } from "./i18n-types";
import { locales } from "./i18n-util";
import ja from "./ja";
import zhCN from "./zh-CN";

const localeTranslations = { en, ja, "zh-CN": zhCN };

export function loadLocale(locale: Locales): void {
  if (isLocaleLoaded(locale)) return;
  loadLocaleData(locale, localeTranslations[locale]);
}

export function loadAllLocales(): void {
  for (const locale of locales) loadLocale(locale);
}
