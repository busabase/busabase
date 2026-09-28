"use client";

import { normalizeBusabaseAppLocale } from "./app-locale";
import { useTranslations } from "./i18n-react";
import type { Locales, TranslationFunctions } from "./i18n-types";

/**
 * This app's `LL` for any locale string the dashboard carries (a stored
 * preference, `?lang=`, a demo use case) — normalized, English when unknown.
 * Fetches that locale's chunk on first use and suspends until it lands.
 */
export const useBusabaseAppLL = (locale: string | undefined): TranslationFunctions =>
  useTranslations((normalizeBusabaseAppLocale(locale) ?? "en") as Locales);
