import { describe, expect, it } from "vitest";
import { type CoreLocale, coreMessagesByLocale } from "../src/i18n";

const EXPECTED_COPY: Record<
  CoreLocale,
  {
    emptyBody: string;
    emptyTitle: string;
    errorBody: string;
    errorTitle: string;
    label: string;
    recentTitle: string;
    recentViewAll: string;
    retry: string;
    subtitle: string;
  }
> = {
  en: {
    label: "App Launcher",
    subtitle: "AirApps in this space — mini apps built on Busabase data and workflows.",
    emptyTitle: "No AirApps yet",
    emptyBody: "AirApps you create in this space will show up here.",
    errorTitle: "Couldn't load AirApps",
    errorBody: "Something went wrong loading the AirApps in this space.",
    retry: "Retry",
    recentTitle: "Recently used AirApps",
    recentViewAll: "Open App Launcher",
  },
  "zh-CN": {
    label: "应用启动台",
    subtitle: "此空间中的 AirApps —— 基于 Busabase 数据与工作流构建的迷你应用。",
    emptyTitle: "暂无 AirApps",
    emptyBody: "你在此空间中创建的 AirApps 会显示在这里。",
    errorTitle: "无法加载 AirApps",
    errorBody: "加载此空间中的 AirApps 时出错了。",
    retry: "重试",
    recentTitle: "最近使用的 AirApps",
    recentViewAll: "打开应用启动台",
  },
  "zh-TW": {
    label: "應用啟動台",
    subtitle: "此空間中的 AirApps —— 以 Busabase 資料與工作流程建置的迷你應用程式。",
    emptyTitle: "暫無 AirApps",
    emptyBody: "你在此空間建立的 AirApps 會顯示在這裡。",
    errorTitle: "無法載入 AirApps",
    errorBody: "載入此空間中的 AirApps 時發生錯誤。",
    retry: "重試",
    recentTitle: "最近使用的 AirApps",
    recentViewAll: "開啟應用啟動台",
  },
  ja: {
    label: "アプリランチャー",
    subtitle:
      "このスペースの AirApps — Busabase のデータとワークフロー上に構築されたミニアプリです。",
    emptyTitle: "AirApps はまだありません",
    emptyBody: "このスペースで作成した AirApps がここに表示されます。",
    errorTitle: "AirApps を読み込めませんでした",
    errorBody: "このスペースの AirApps の読み込み中にエラーが発生しました。",
    retry: "再試行",
    recentTitle: "最近使用した AirApps",
    recentViewAll: "アプリランチャーを開く",
  },
};

describe("App Launcher locale copy", () => {
  it.each(Object.entries(EXPECTED_COPY))("resolves the %s destination copy", (locale, copy) => {
    const messages = coreMessagesByLocale[locale as CoreLocale];

    expect({
      label: messages.nav.apps,
      subtitle: messages.airapp.librarySubtitle,
      emptyTitle: messages.airapp.libraryEmptyTitle,
      emptyBody: messages.airapp.libraryEmptyBody,
      errorTitle: messages.airapp.libraryErrorTitle,
      errorBody: messages.airapp.libraryErrorBody,
      retry: messages.airapp.libraryRetry,
      recentTitle: messages.home.recentAppsTitle,
      recentViewAll: messages.home.recentAppsViewAll,
    }).toEqual(copy);
  });
});
