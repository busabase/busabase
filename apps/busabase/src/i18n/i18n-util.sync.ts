import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import { isLocaleLoaded, loadLocale as loadLocaleData } from "./i18n-core";
import type { Locales } from "./i18n-types";
import { locales } from "./i18n-util";
import ja from "./ja";
import ko from "./ko";
import pt from "./pt";
import vi from "./vi";
import zhCN from "./zh-CN";
import zhTW from "./zh-TW";

const localeTranslations = {
  en,
  ja,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  es,
  ko,
  pt,
  vi,
  fr,
  de,
};

export function loadLocale(locale: Locales): void {
  if (isLocaleLoaded(locale)) return;
  loadLocaleData(locale, localeTranslations[locale]);
}

export function loadAllLocales(): void {
  for (const locale of locales) loadLocale(locale);
}
