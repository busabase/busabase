import type React from "react";
import z from "zod";
import { i18n } from "./i18n";

export const locales = i18n.locales;
export type Locale = (typeof locales)[number];

export const LocaleSchema = z.enum(locales);

export type DictionaryLoader = (locale: Locale) => Promise<Record<string, unknown>>;

export type UserSettingsFetcher = () => Promise<{ locale?: string } | null>;

export interface LocaleProviderProps {
  children: React.ReactNode;
  userSettingsFetcher?: UserSettingsFetcher;
  /** Provide a dictionary loader so apps can decide how to bundle / code split */
  loadDictionary: DictionaryLoader;
  initialLocale?: Locale;
  /** App-specific supported locales */
  supportedLocales: readonly Locale[];
  /** Custom localStorage key for storing locale preference */
  localStorageKey?: string;
}
