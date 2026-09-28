import { createTranslationRegistry } from "ts7-i18n/registry";
import type { BaseTranslation } from "./en";
import type { Locales } from "./i18n-types";

// Registry only — zero `react` import. Safe to import from Server Components,
// middleware, or anywhere else. Client components read translations through
// `i18n-react.tsx`, which loads each locale on demand.
export const registry = createTranslationRegistry<Locales, BaseTranslation>();
export const { loadLocale, isLocaleLoaded, getTranslations } = registry;
