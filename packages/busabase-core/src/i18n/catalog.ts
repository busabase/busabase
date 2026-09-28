// Every busabase-core catalog, statically imported, with no React in sight.
//
// For server code and tests only. `./index.tsx` is `"use client"`: a server
// module that imports a value from it gets a client reference under the React
// Server bundler, not the object — and the server needs the real catalog, since
// it renders the same agent prompts the dashboard shows (`playbooks.get`), which
// must come out byte-identical.
//
// Client code must NOT import this module: it puts every language in the bundle.
// Components read the active locale's strings through `useCoreI18n()` /
// `useCoreMessages()` in `./index`, which fetches each catalog on demand
// (`scripts/check-client-i18n-imports.test.ts` enforces this).

import { dashboardDe } from "./de";
import { dashboardEs } from "./es";
import { dashboardFr } from "./fr";
import { dashboardJa } from "./ja";
import { dashboardKo } from "./ko";
import type { CoreLocale } from "./locales";
import { type CoreI18nMessages, coreMessagesEn } from "./messages";
import { dashboardPt } from "./pt";
import { dashboardVi } from "./vi";
import { dashboardZhCN } from "./zh-CN";
import { dashboardZhTW } from "./zh-TW";

// Re-exported for server importers; the locale set itself lives in ./locales.
export type { CoreLocale };

export const coreMessagesByLocale: Record<CoreLocale, CoreI18nMessages> = {
  en: coreMessagesEn,
  "zh-CN": dashboardZhCN,
  "zh-TW": dashboardZhTW,
  ja: dashboardJa,
  ko: dashboardKo,
  es: dashboardEs,
  pt: dashboardPt,
  vi: dashboardVi,
  fr: dashboardFr,
  de: dashboardDe,
};
