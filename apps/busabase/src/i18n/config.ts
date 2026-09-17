import { createLanguageOptions } from "openlib/i18n";
import { type Locale, SUPPORTED_LOCALES } from "./app-locale";

export { type Locale, SUPPORTED_LOCALES } from "./app-locale";

export const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
};

export const AUTO_LABEL: Record<Locale, string> = {
  en: "Auto",
  "zh-CN": "自动",
  ja: "自動",
};

export function getLanguageOptions(currentLocale: Locale = "en") {
  return createLanguageOptions(SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES, AUTO_LABEL, currentLocale);
}
