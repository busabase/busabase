import type { Translation } from "../i18n-types";
import zhCN from "../zh-CN";

const ja: Translation = {
  ...zhCN,
  common: {
    appName: "Busabase",
  },
  shell: {
    ...zhCN.shell,
    graphView: "グラフビュー",
    loadingDashboard: "ダッシュボードを読み込み中...",
    failedToLoadDashboard: "ダッシュボードデータの読み込みに失敗しました",
    localPlan: "ローカル",
    auto: "自動",
  },
  navigation: {
    ...zhCN.navigation,
    review: "レビュー",
    inbox: "受信箱",
    activity: "アクティビティ",
    base: "ベース",
  },
};

export default ja;
