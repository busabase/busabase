import { type iString, iStringParse, type LocaleType } from "openlib/i18n/i-string";

/** The workbench prefers English for untranslated Japanese catalog entries; public pages retain iString's fallback. */
export const templateTextForLocale = (
  value: iString,
  locale: LocaleType,
  preferEnglishFallback = false,
): string => {
  if (!preferEnglishFallback) return iStringParse(value, locale);
  if (typeof value === "string") return value;
  const requested = value[locale];
  if (requested?.trim()) return requested;
  if (value.en?.trim()) return value.en;
  return iStringParse(value, locale);
};
