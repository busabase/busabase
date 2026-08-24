"use client";

import { defineI18nUI } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/next";
import type React from "react";
import { LOCALE_DISPLAY_NAMES } from "~/i18n/config";
import { fumadocsI18n } from "~/lib/fumadocs-i18n";
import type { LangLocale } from "./locale";

const { provider } = defineI18nUI(fumadocsI18n, {
  en: {
    displayName: LOCALE_DISPLAY_NAMES.en,
    search: "Search",
  },
  "zh-CN": {
    displayName: LOCALE_DISPLAY_NAMES["zh-CN"],
    search: "搜索文档",
  },
});

export function LangLayoutClient({
  lang,
  children,
}: {
  lang: LangLocale;
  children: React.ReactNode;
}) {
  return (
    <RootProvider i18n={provider(lang)} theme={{ enabled: false }}>
      {children}
    </RootProvider>
  );
}
