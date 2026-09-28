"use client";

// busabase-core's runtime i18n seam for the shared dashboard. The dashboard
// component lives here, but each host app owns its own ts7-i18n `LL`,
// so the host injects the active locale via `CoreI18nProvider` and the
// dashboard reads strings with `useCoreI18n()`. The `Core*` names are deliberate:
// in Busabase Cloud this provider sits alongside the cloud app's own i18n
// context (`useI18nContext`), so the shared-package source stays obvious.
// Hosts can also import `coreMessagesEn` (or, server/test-side only, every
// catalog via `./catalog`) into their own typed catalogs to manage these strings.

import { type iString, iStringParse } from "openlib/i18n/i-string";
import { LOCALE_NATIVE_NAMES } from "openlib/i18n/i18n";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import { createLocaleLoader } from "ts7-i18n/react";
import { CORE_LOCALES, type CoreLocale, isCoreLocale } from "./locales";
import { type CoreI18nMessages, coreMessagesEn } from "./messages";

// Locale set shared by every host (apps/busabase, Busabase Cloud) — see ./locales.
// A host that resolves an unsupported locale falls back to English.
export type { CoreLocale } from "./locales";

// Each non-English catalog is its own chunk, fetched only when a host renders
// that locale — bundling all of them cost every page ~1 MB of strings it never
// shows. English stays static: it is the type source and the context default.
// (Tests and server code that need every catalog at once import `./catalog`.)
const nonEnglishCatalogs: Record<Exclude<CoreLocale, "en">, () => Promise<CoreI18nMessages>> = {
  "zh-CN": async () => (await import("./zh-CN")).dashboardZhCN,
  "zh-TW": async () => (await import("./zh-TW")).dashboardZhTW,
  ja: async () => (await import("./ja")).dashboardJa,
  ko: async () => (await import("./ko")).dashboardKo,
  es: async () => (await import("./es")).dashboardEs,
  pt: async () => (await import("./pt")).dashboardPt,
  vi: async () => (await import("./vi")).dashboardVi,
  fr: async () => (await import("./fr")).dashboardFr,
  de: async () => (await import("./de")).dashboardDe,
};

export const loadCoreMessages = async (locale: CoreLocale): Promise<CoreI18nMessages> =>
  locale === "en" ? coreMessagesEn : nonEnglishCatalogs[locale]();

export const coreMessagesLoader = createLocaleLoader(loadCoreMessages);
coreMessagesLoader.prime("en", coreMessagesEn);

/**
 * The busabase-core strings for `locale` (unsupported → English). Suspends the
 * first time a locale is asked for, until its catalog chunk has loaded.
 */
export function useCoreMessages(locale?: string): CoreI18nMessages {
  return coreMessagesLoader.read(isCoreLocale(locale) ? locale : "en");
}

const ENGLISH_NAMES: Record<CoreLocale, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  pt: "Portuguese",
  vi: "Vietnamese",
  fr: "French",
  de: "German",
};

// Display options for a language switcher, in sync with the catalog above.
export const coreLocaleOptions: { code: CoreLocale; name: string; nativeName: string }[] =
  CORE_LOCALES.map((code) => ({
    code,
    name: ENGLISH_NAMES[code],
    nativeName: LOCALE_NATIVE_NAMES[code],
  }));

const CoreI18nContext = createContext<CoreI18nMessages>(coreMessagesEn);
const CoreLocaleContext = createContext<CoreLocale>("en");

export function CoreI18nProvider({
  children,
  locale,
}: {
  children: ReactNode;
  /** Active locale from the host (e.g. cloud's `[lang]`, or busabase's cookie). */
  locale?: string;
}) {
  const resolved = isCoreLocale(locale) ? locale : "en";
  const messages = useCoreMessages(resolved);
  return (
    <CoreLocaleContext.Provider value={resolved}>
      <CoreI18nContext.Provider value={messages}>{children}</CoreI18nContext.Provider>
    </CoreLocaleContext.Provider>
  );
}

/** The active locale's busabase-core dashboard strings (typed against `en`). */
export function useCoreI18n(): CoreI18nMessages {
  return useContext(CoreI18nContext);
}

/** The active dashboard locale (falls back to "en" for unsupported hosts). */
export function useCoreLocale(): CoreLocale {
  return useContext(CoreLocaleContext);
}

/**
 * Resolve an iString (e.g. a field's multilingual name) to the active locale,
 * falling back through iStringParse's chain (requested → en → any).
 */
export function useIString(): (value: iString) => string {
  const locale = useCoreLocale();
  return useCallback((value: iString) => iStringParse(value, locale), [locale]);
}

/** Interpolate `{token}` placeholders in a catalog string. Lives in the pure
 * `./fmt` module so React-Native consumers of the dashboard helpers don't pull
 * this "use client" file (and every locale catalog) into their bundle. */
export { fmt } from "./fmt";

export { coreMessagesEn };
export type { CoreI18nMessages };
