import { createLanguageOptions } from "openlib/i18n";
import { type Locale, SUPPORTED_LOCALES } from "./app-locale";

export { type Locale, SUPPORTED_LOCALES } from "./app-locale";

export const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  pt: "Português",
  vi: "Tiếng Việt",
  fr: "Français",
  de: "Deutsch",
};

export const AUTO_LABEL: Record<Locale, string> = {
  en: "Auto",
  "zh-CN": "自动",
  "zh-TW": "自動",
  ja: "自動",
  ko: "자동",
  es: "Automático",
  pt: "Automático",
  vi: "Tự động",
  fr: "Automatique",
  de: "Automatisch",
};

export function getLanguageOptions(currentLocale: Locale = "en") {
  return createLanguageOptions(SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES, AUTO_LABEL, currentLocale);
}
