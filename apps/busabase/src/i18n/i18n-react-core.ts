"use client";

import { createI18nReactBindings } from "ts7-i18n/react";
import { registry } from "./i18n-core";
import { importLocaleAsync } from "./i18n-util.async";

// React bindings only, wrapping the SAME registry instance `i18n-core.ts`
// exports. A client module, so a Server Component (e.g. the `[lang]` layout)
// can render the Provider directly; server code that needs translations uses
// the registry in `i18n-core.ts` instead.
//
// `loadLocale` makes every locale its own chunk: `Provider` / `useTranslations`
// suspend until the requested one arrives, so client code never needs to import
// a locale tree (`i18n-util.sync`) — doing so puts every language in the bundle.
export const { Provider, useI18nContext, useTranslations } = createI18nReactBindings(registry, {
  loadLocale: importLocaleAsync,
});
