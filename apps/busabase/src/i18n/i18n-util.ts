import { SUPPORTED_LOCALES } from "./app-locale";
import { getTranslations } from "./i18n-core";
import type { Locales } from "./i18n-types";

export const baseLocale: Locales = "en";

export const locales: Locales[] = [...SUPPORTED_LOCALES];

export const isLocale = (locale: string): locale is Locales => (locales as string[]).includes(locale);

export const i18nObject = getTranslations;
