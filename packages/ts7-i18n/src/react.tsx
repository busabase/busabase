"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { TranslationRegistry } from "./registry";
import type { LL } from "./typed-translations";

export interface I18nContextValue<Locale extends string, T extends object> {
  locale: Locale;
  LL: LL<T>;
}

export interface I18nReactBindings<Locale extends string, T extends object> {
  /** Wraps `children` with the resolved `LL` accessor for `locale`. Throws if `locale` has not been `loadLocale`d yet. */
  Provider: (props: { locale: Locale; children: ReactNode }) => ReactNode;
  /** Reads `{ locale, LL }` from the nearest `Provider`. Throws if called outside one. */
  useI18nContext: () => I18nContextValue<Locale, T>;
}

/**
 * Wraps an existing `TranslationRegistry` (from `ts7-i18n/registry`'s
 * `createTranslationRegistry`) with a React context `Provider` + `useI18nContext`
 * hook. Kept in its own module — with an explicit `"use client"` directive —
 * so importing it never drags a `react`-context dependency into code that also
 * needs to run in a Server Component / middleware / non-React context.
 */
export function createI18nReactBindings<Locale extends string, T extends object>(
  registry: TranslationRegistry<Locale, T>,
): I18nReactBindings<Locale, T> {
  const Context = createContext<I18nContextValue<Locale, T> | null>(null);

  function Provider({ locale, children }: { locale: Locale; children: ReactNode }): ReactNode {
    const LL = useMemo(() => registry.getTranslations(locale), [locale, registry.getTranslations]);
    return <Context.Provider value={{ locale, LL }}>{children}</Context.Provider>;
  }

  function useI18nContext(): I18nContextValue<Locale, T> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error("useI18nContext must be used within its Provider");
    return ctx;
  }

  return { Provider, useI18nContext };
}
