"use client";

import type { ReactNode } from "react";
import { createI18nReactBindings, type I18nContextValue } from "./react";
import { createTranslationRegistry, type TranslationRegistry } from "./registry";
import type { Translatable } from "./typed-translations";

export type { I18nContextValue } from "./react";
export type { TranslationRegistry } from "./registry";

export interface TypedI18n<Locale extends string, T extends object>
  extends TranslationRegistry<Locale, T> {
  /** Wraps `children` with the resolved `LL` accessor for `locale`. Throws if `locale` has not been `loadLocale`d yet. */
  Provider: (props: { locale: Locale; children: ReactNode }) => ReactNode;
  /** Reads `{ locale, LL }` from the nearest `Provider`. Throws if called outside one. */
  useI18nContext: () => I18nContextValue<Locale, T>;
}

/**
 * All-in-one convenience factory: registry + React bindings in a single call.
 * Fine for apps that don't need a Server/Client Component boundary (or use i18n
 * only from Client Components). For a Next.js App Router app where Server
 * Components (or middleware) need `getTranslations`/`loadLocale` directly,
 * import `ts7-i18n/registry`'s `createTranslationRegistry` there instead, and
 * only reach for `ts7-i18n/react`'s `createI18nReactBindings` in your
 * `"use client"` component tree — see the README's "Server Components" section.
 */
export function createTypedI18n<Locale extends string, T extends object>(
  initialTranslations: Partial<Record<Locale, Translatable<T>>> = {},
): TypedI18n<Locale, T> {
  const registry = createTranslationRegistry<Locale, T>(initialTranslations);
  const { Provider, useI18nContext } = createI18nReactBindings<Locale, T>(registry);
  return { ...registry, Provider, useI18nContext };
}
