import type { Translatable } from "ts7-i18n";
import type { BaseTranslation } from "./en";
import { isLocaleLoaded, loadLocale } from "./i18n-core";
import type { Locales } from "./i18n-types";
import { locales } from "./i18n-util";

const localeTranslationLoaders = {
  en: () => import("./en"),
  "zh-CN": () => import("./zh-CN"),
  "zh-TW": () => import("./zh-TW"),
  ja: () => import("./ja"),
  ko: () => import("./ko"),
  es: () => import("./es"),
  pt: () => import("./pt"),
  vi: () => import("./vi"),
  fr: () => import("./fr"),
  de: () => import("./de"),
};

/** Returns a locale's raw translation tree (plain strings, not `LL` accessors). */
export async function importLocaleAsync(locale: Locales): Promise<Translatable<BaseTranslation>> {
  const mod = await localeTranslationLoaders[locale]();
  return mod.default;
}

export async function loadLocaleAsync(locale: Locales): Promise<void> {
  if (isLocaleLoaded(locale)) return;
  loadLocale(locale, await importLocaleAsync(locale));
}

export const loadAllLocalesAsync = (): Promise<void[]> => Promise.all(locales.map(loadLocaleAsync));
