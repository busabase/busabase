"use client";

// busabase-core's runtime i18n seam for the shared dashboard. The dashboard
// component lives here, but each host app generates its own typesafe-i18n `LL`,
// so the host injects the active locale via `CoreI18nProvider` and the
// dashboard reads strings with `useCoreI18n()`. The `Core*` names are deliberate:
// in apps/busabase-cloud this provider sits alongside the cloud app's own i18n
// context (`useI18nContext`), so the shared-package source stays obvious.
// Hosts can also import `coreMessagesEn` / `coreMessagesByLocale`
// into their own typesafe-i18n catalogs to manage these strings.

import { createContext, type ReactNode, useContext } from "react";
import { dashboardJa } from "./ja";
import { type CoreI18nMessages, coreMessagesEn } from "./messages";
import { dashboardZhCN } from "./zh-CN";
import { dashboardZhTW } from "./zh-TW";

// Locale set: a superset of apps/busabase-cloud (en, zh-CN, ja) that also ships
// Traditional Chinese (zh-TW). A host that resolves an unsupported locale falls
// back to English.
export type CoreLocale = "en" | "zh-CN" | "zh-TW" | "ja";

export const coreMessagesByLocale: Record<CoreLocale, CoreI18nMessages> = {
  en: coreMessagesEn,
  "zh-CN": dashboardZhCN,
  "zh-TW": dashboardZhTW,
  ja: dashboardJa,
};

// Display options for a language switcher, in sync with the catalog above.
export const coreLocaleOptions: { code: CoreLocale; name: string; nativeName: string }[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "zh-CN", name: "Simplified Chinese", nativeName: "简体中文" },
  { code: "zh-TW", name: "Traditional Chinese", nativeName: "繁體中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
];

const isSupportedLocale = (locale: string | undefined): locale is CoreLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

const CoreI18nContext = createContext<CoreI18nMessages>(coreMessagesEn);

export function CoreI18nProvider({
  children,
  locale,
}: {
  children: ReactNode;
  /** Active locale from the host (e.g. cloud's `[lang]`, or busabase's cookie). */
  locale?: string;
}) {
  const messages = isSupportedLocale(locale) ? coreMessagesByLocale[locale] : coreMessagesEn;
  return <CoreI18nContext.Provider value={messages}>{children}</CoreI18nContext.Provider>;
}

/** The active locale's busabase-core dashboard strings (typed against `en`). */
export function useCoreI18n(): CoreI18nMessages {
  return useContext(CoreI18nContext);
}

/** Interpolate `{token}` placeholders in a catalog string. */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export { coreMessagesEn };
export type { CoreI18nMessages };
