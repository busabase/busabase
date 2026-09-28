"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { TranslationRegistry } from "./registry";
import type { LL, Translatable } from "./typed-translations";

export interface I18nContextValue<Locale extends string, T extends object> {
  locale: Locale;
  LL: LL<T>;
}

export interface I18nReactBindingsOptions<Locale extends string, T extends object> {
  /**
   * Fetches a locale's translation tree on demand — typically a `switch` or map
   * of `() => import("./ja")`. When set, `Provider` and `useTranslations`
   * suspend until an unloaded locale arrives, instead of
   * throwing. That is what lets a client bundle ship zero locale trees: each
   * one becomes its own chunk, fetched only by the pages that render it.
   */
  loadLocale?: (locale: Locale) => Promise<Translatable<T>>;
}

export interface ProviderProps<Locale extends string, T extends object> {
  locale: Locale;
  /** The tree for `locale`, when the caller already has it (see `Provider`). */
  translations?: Translatable<T>;
  children: ReactNode;
}

export interface I18nReactBindings<Locale extends string, T extends object> {
  /**
   * Wraps `children` with the resolved `LL` accessor for `locale`. Suspends
   * while `locale` loads when the bindings have a `loadLocale`; throws if
   * `locale` is not loaded and there is no loader.
   *
   * Pass `translations` when the server already holds the tree (a Next.js
   * layout that awaited it): it is registered during render, so the first
   * render — and hydration — never waits on a chunk. The loader then only
   * serves locales the client switches to later.
   */
  Provider: (props: ProviderProps<Locale, T>) => ReactNode;
  /** Reads `{ locale, LL }` from the nearest `Provider`. Throws if called outside one. */
  useI18nContext: () => I18nContextValue<Locale, T>;
  /**
   * The `LL` accessor for an explicit `locale`, with the same load-or-suspend
   * behaviour as `Provider` — for components that render outside any
   * `Provider` (e.g. a root `not-found` page).
   */
  useTranslations: (locale: Locale) => LL<T>;
}

export interface LocaleLoader<Locale extends string, V> {
  /**
   * The value for `locale`: returned synchronously once loaded, otherwise the
   * calling component suspends until it is. A failed load is rethrown to the
   * nearest error boundary. Call it during render only.
   */
  read: (locale: Locale) => V;
  /**
   * Records a value you already have (an SSR payload, a test fixture, a tree
   * loaded some other way) so reading that locale never suspends. Ignored if
   * the locale has already loaded.
   */
  prime: (locale: Locale, value: V) => void;
}

/** A load in flight or settled, with its outcome recorded so reads can be synchronous. */
type TrackedPromise<V> = Promise<V> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: V;
  reason?: unknown;
};

/**
 * The suspend-until-loaded primitive behind `createI18nReactBindings`'s
 * `loadLocale` option, exported for per-locale data that isn't a ts7-i18n tree
 * (e.g. a shared package's own message catalog). One fetch per locale, shared
 * by every reader.
 *
 * Suspends by throwing the pending promise, not with React 19's `use`, and that
 * choice is load-bearing in both directions:
 * - `use` makes React *replay* a component that suspended mid-mount once the
 *   promise settles, and the replay must call `use` again in the same place.
 *   Skipping it once the value was known left later hooks without a slot —
 *   "Update hook called on initial render" (minified #467), hit on almost every
 *   warm-cache docs page load when the chunk landed mid-hydration.
 * - Calling `use` on every read, loaded or not, fixes that but changes how React
 *   schedules the rest of the tree (it flags the render as promise-using), which
 *   broke unrelated async state updates below the provider in tests.
 * A thrown promise makes React unwind and re-render the component from scratch
 * when it settles — no replay, no hook bookkeeping — and a loaded value is read
 * with no React API at all. It also works on React 18.
 *
 * A failed load stays failed — the same contract as `React.lazy` — so every
 * read rethrows it rather than refetching in a loop. Recovery is a reload.
 */
export function createLocaleLoader<Locale extends string, V>(
  load: (locale: Locale) => Promise<V>,
): LocaleLoader<Locale, V> {
  const promises = new Map<Locale, TrackedPromise<V>>();

  function read(locale: Locale): V {
    let promise = promises.get(locale);
    if (!promise) {
      const tracked: TrackedPromise<V> = load(locale);
      tracked.status = "pending";
      tracked.then(
        (value) => {
          tracked.status = "fulfilled";
          tracked.value = value;
        },
        (reason: unknown) => {
          tracked.status = "rejected";
          tracked.reason = reason;
        },
      );
      promises.set(locale, tracked);
      promise = tracked;
    }
    if (promise.status === "fulfilled") return promise.value as V;
    if (promise.status === "rejected") throw promise.reason;
    throw promise;
  }

  function prime(locale: Locale, value: V): void {
    if (promises.get(locale)?.status === "fulfilled") return;
    const promise: TrackedPromise<V> = Promise.resolve(value);
    promise.status = "fulfilled";
    promise.value = value;
    promises.set(locale, promise);
  }

  return { read, prime };
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
  options: I18nReactBindingsOptions<Locale, T> = {},
): I18nReactBindings<Locale, T> {
  const Context = createContext<I18nContextValue<Locale, T> | null>(null);
  const { loadLocale } = options;
  const loader = loadLocale
    ? createLocaleLoader<Locale, void>(async (locale) => {
        const translations = await loadLocale(locale);
        if (!registry.isLocaleLoaded(locale)) registry.loadLocale(locale, translations);
      })
    : undefined;

  function suspendUntilLoaded(locale: Locale): void {
    if (!loader) return;
    // A tree that reached the registry another way (server code, a sync load)
    // needs no fetch — but still goes through `read`, see createLocaleLoader.
    if (registry.isLocaleLoaded(locale)) loader.prime(locale);
    loader.read(locale);
  }

  function useTranslations(locale: Locale): LL<T> {
    suspendUntilLoaded(locale);
    return useMemo(() => registry.getTranslations(locale), [locale, registry.getTranslations]);
  }

  function Provider({ locale, translations, children }: ProviderProps<Locale, T>): ReactNode {
    // Registering during render is idempotent (first write wins) and has to
    // happen before `useTranslations` checks the registry — that ordering is
    // what keeps a server-supplied tree from suspending hydration.
    if (translations && !registry.isLocaleLoaded(locale)) registry.loadLocale(locale, translations);
    const LL = useTranslations(locale);
    return <Context.Provider value={{ locale, LL }}>{children}</Context.Provider>;
  }

  function useI18nContext(): I18nContextValue<Locale, T> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error("useI18nContext must be used within its Provider");
    return ctx;
  }

  return { Provider, useI18nContext, useTranslations };
}
