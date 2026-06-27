/**
 * Core i18n locale provider and hooks.
 *
 * Applications should import from "openlib/i18n" to ensure a single shared context instance (without dictionaries).
 * Each app is responsible for its own typed-dictionary loading logic (e.g., via code splitting).
 *
 */
"use client";
import { match as localeMatch } from "@formatjs/intl-localematcher";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { templateFormat } from "./format";
import { DEFAULT_LOCAL_STORAGE_KEY, readStoredLocale, storeLocale } from "./storage";
import type { Locale, LocaleProviderProps, UserSettingsFetcher } from "./types";

export { readStoredLocale, storeLocale } from "./storage";
export { type DictionaryLoader, type Locale, LocaleSchema, locales } from "./types";
export const defaultUserSettingsFetcher: UserSettingsFetcher = async () => null;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  dictionary: Record<string, unknown> | null;
  loading: boolean;
  /** Lightweight template formatting: replaces {var} tokens */
  format: (template: string, vars?: Record<string, string | number>) => string;
  /** Intl helpers bound to current locale */
  numberFormat: (value: number, opts?: Intl.NumberFormatOptions) => string;
  dateFormat: (value: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  relativeTimeFormat: (value: number, unit: Intl.RelativeTimeFormatUnit) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function detectBrowserLocale(supportedLocales: readonly Locale[]): Locale {
  if (typeof navigator === "undefined") return "en";
  const requested = navigator.languages?.length ? navigator.languages : [navigator.language];
  const matched = localeMatch(requested, supportedLocales as string[], "en");
  return (supportedLocales.includes(matched as Locale) ? matched : "en") as Locale;
}

// storage helpers are re-exported above from ./storage

export function LocaleProvider({
  children,
  userSettingsFetcher = defaultUserSettingsFetcher,
  loadDictionary,
  initialLocale,
  supportedLocales,
  localStorageKey = DEFAULT_LOCAL_STORAGE_KEY,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale || "en");
  const [dictionary, setDictionary] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    storeLocale(l, localStorageKey);
  };

  // Initial resolve chain
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let resolved: Locale | null = null;
        const user = await userSettingsFetcher();
        if (user?.locale && supportedLocales.includes(user.locale as Locale)) {
          resolved = user.locale as Locale;
        }
        if (!resolved) {
          const stored = readStoredLocale(supportedLocales, localStorageKey);
          if (stored) resolved = stored;
        }
        if (!resolved) {
          resolved = detectBrowserLocale(supportedLocales);
        }
        if (!cancelled) {
          setLocaleState(resolved || "en");
          const dict = await loadDictionary(resolved || "en");
          if (!cancelled) setDictionary(dict);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userSettingsFetcher, loadDictionary, supportedLocales, localStorageKey]);

  // Reload dictionary on locale change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const dict = await loadDictionary(locale);
      if (!cancelled) setDictionary(dict);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, loadDictionary]);

  const format = (template: string, vars?: Record<string, string | number>) =>
    templateFormat(template, vars);

  // Memoized Intl formatters
  const numberFormatterCache = useMemo(() => new Map<string, Intl.NumberFormat>(), []);
  const dateFormatterCache = useMemo(() => new Map<string, Intl.DateTimeFormat>(), []);
  const rtfCache = useMemo(() => new Map<string, Intl.RelativeTimeFormat>(), []);

  const numberFormat = (value: number, opts?: Intl.NumberFormatOptions) => {
    const key = JSON.stringify(opts || {});
    let fmt = numberFormatterCache.get(key);
    if (!fmt) {
      fmt = new Intl.NumberFormat(locale, opts);
      numberFormatterCache.set(key, fmt);
    }
    return fmt.format(value);
  };

  const dateFormat = (value: Date | string | number, opts?: Intl.DateTimeFormatOptions) => {
    const key = JSON.stringify(opts || {});
    let fmt = dateFormatterCache.get(key);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, opts);
      dateFormatterCache.set(key, fmt);
    }
    const date = value instanceof Date ? value : new Date(value);
    return fmt.format(date);
  };

  const relativeTimeFormat = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
    const key = unit;
    let fmt = rtfCache.get(key);
    if (!fmt) {
      fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      rtfCache.set(key, fmt);
    }
    return fmt.format(value, unit);
  };

  return (
    <LocaleContext.Provider
      value={{
        locale,
        setLocale,
        dictionary,
        loading,
        format,
        numberFormat,
        dateFormat,
        relativeTimeFormat,
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function useDictionary() {
  const { dictionary, loading, format } = useLocale();
  return { t: dictionary, loading, format } as const;
}

export function useFormat() {
  return useLocale().format;
}

export interface UseIntlOptions {
  number?: Intl.NumberFormatOptions;
  date?: Intl.DateTimeFormatOptions;
}

export function useIntl() {
  const { numberFormat, dateFormat, relativeTimeFormat, locale } = useLocale();
  return {
    locale,
    number: numberFormat,
    date: dateFormat,
    relativeTime: relativeTimeFormat,
  } as const;
}
