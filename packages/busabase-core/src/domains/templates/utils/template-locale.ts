import { type iString, iStringParse, type LocaleType } from "openlib/i18n/i-string";

/** A template's text in `locale`; a missing translation shows English, then any other language. */
export const templateTextForLocale = (value: iString, locale: LocaleType): string =>
  iStringParse(value, locale);
