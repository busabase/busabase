import type { LL } from "ts7-i18n";
import type { Locale } from "./app-locale";
import type { BaseTranslation } from "./en";

export type Locales = Locale;

/** The callable `LL` accessor shape, i.e. what `i18nObject(locale)` returns. */
export type TranslationFunctions = LL<BaseTranslation>;
