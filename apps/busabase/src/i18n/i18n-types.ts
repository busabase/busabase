import type { LL } from "ts7-i18n";
import type { BaseTranslation } from "./en";

export type Locales = "en" | "ja" | "zh-CN";

/** The callable `LL` accessor shape, i.e. what `i18nObject(locale)` returns. */
export type TranslationFunctions = LL<BaseTranslation>;
