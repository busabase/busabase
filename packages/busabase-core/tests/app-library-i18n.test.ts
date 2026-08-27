import { describe, expect, it } from "vitest";
import { type CoreLocale, coreMessagesByLocale } from "../src/i18n";

const EXPECTED_COPY: Record<
  CoreLocale,
  {
    emptyBody: string;
    emptyTitle: string;
    label: string;
    recentTitle: string;
    recentViewAll: string;
    subtitle: string;
  }
> = {
  en: {
    label: "App Library",
    subtitle: "AirApps in this space — mini apps built on Busabase data and workflows.",
    emptyTitle: "No AirApps yet",
    emptyBody: "AirApps you create in this space will show up here.",
    recentTitle: "Recently used AirApps",
    recentViewAll: "View App Library",
  },
  "zh-CN": {
    label: "应用库",
    subtitle: "此空间中的 AirApps —— 基于 Busabase 数据与工作流构建的迷你应用。",
    emptyTitle: "暂无 AirApps",
    emptyBody: "你在此空间中创建的 AirApps 会显示在这里。",
    recentTitle: "最近使用的 AirApps",
    recentViewAll: "查看应用库",
  },
  "zh-TW": {
    label: "應用庫",
    subtitle: "此空間中的 AirApps —— 以 Busabase 資料與工作流程建置的迷你應用程式。",
    emptyTitle: "暫無 AirApps",
    emptyBody: "你在此空間建立的 AirApps 會顯示在這裡。",
    recentTitle: "最近使用的 AirApps",
    recentViewAll: "查看應用庫",
  },
  ja: {
    label: "アプリライブラリ",
    subtitle:
      "このスペースの AirApps — Busabase のデータとワークフロー上に構築されたミニアプリです。",
    emptyTitle: "AirApps はまだありません",
    emptyBody: "このスペースで作成した AirApps がここに表示されます。",
    recentTitle: "最近使用した AirApps",
    recentViewAll: "アプリライブラリを表示",
  },
};

describe("App Library locale copy", () => {
  it.each(Object.entries(EXPECTED_COPY))("resolves the %s destination copy", (locale, copy) => {
    const messages = coreMessagesByLocale[locale as CoreLocale];

    expect({
      label: messages.nav.apps,
      subtitle: messages.airapp.librarySubtitle,
      emptyTitle: messages.airapp.libraryEmptyTitle,
      emptyBody: messages.airapp.libraryEmptyBody,
      recentTitle: messages.home.recentAppsTitle,
      recentViewAll: messages.home.recentAppsViewAll,
    }).toEqual(copy);
  });
});
