import { createTranslationRegistry } from "ts7-i18n/registry";
import type { BaseTranslation } from "./en";
import type { Locales } from "./i18n-types";

// Registry only — zero `react` import. Safe to import from Server Components,
// middleware, or anywhere else. (This app has no React i18n bindings at all:
// its single consumer, `~/lib/i18n.ts`, resolves an `LL` accessor directly.)
export const registry = createTranslationRegistry<Locales, BaseTranslation>();
export const { loadLocale, isLocaleLoaded, getTranslations } = registry;
