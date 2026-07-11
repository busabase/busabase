// New i18n modules

export * from "./canonical-url";
export * from "./detect-server-locale";
export * from "./i-string";
export * from "./i18n";
export * from "./i18n-string";
// Legacy i18n modules (from develop branch)
// Re-export specific items to avoid conflicts with ./i18n exports
export {
  type DictionaryLoader,
  defaultUserSettingsFetcher,
  detectBrowserLocale,
  LocaleProvider,
  readStoredLocale,
  storeLocale,
  useDictionary,
  useFormat,
  useIntl,
  useLocale,
} from "./locale";
export * from "./middleware";
export * from "./page-metadata";
export type {
  Locale,
  Locale as LocaleFromTypes,
  LocaleProviderProps,
  UserSettingsFetcher,
} from "./types";
export { locales } from "./types";
export * from "./utils";
