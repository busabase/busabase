import type { Translation } from "../i18n-types";
import zhCN from "../zh-CN";

const ja: Translation = {
  common: {
    appName: "Busabase",
  },
  shell: {
    graphView: "グラフビュー",
    loadingDashboard: "ダッシュボードを読み込み中...",
    failedToLoadDashboard: "ダッシュボードデータの読み込みに失敗しました",
    routeNotFoundTitle: "ダッシュボードのルートが見つかりません",
    routeNotFoundBody: "サイドバーから受信トレイ、アクティビティ、またはベースを開いてください。",
    localSpaceName: "ローカル Busabase",
    localReviewerName: "ローカルレビュアー",
    localPlan: "ローカル",
    approvalFirstKb: "承認優先ナレッジベース",
    addWorkspace: "ワークスペースを追加",
    inviteMembers: "メンバーを招待",
    accountSettings: "アカウント設定",
    settings: "設定",
    logOut: "ログアウト",
    notifications: "通知",
    workspaces: "ワークスペース",
    auto: "自動",
  },
  navigation: {
    review: "レビュー",
    inbox: "受信トレイ",
    activity: "アクティビティ",
    base: "ベース",
    blogPosts: "ブログ記事",
  },
  marketing: {
    rootDescription: "Busabase のオープンソースなローカルレビューエンジン。",
    aboutTitle: "BusaBase について",
    aboutDescription:
      "BusaBase は AI エージェント向けの承認優先データベースです。AI が生成したすべてのレコードは、人のレビューを通過してから正式な情報になります。",
    aboutEyebrow: "BusaBase を作った理由",
    aboutHeadline: "AI エージェントは無限の速度でゴミを生み出すためにあるのではありません",
    aboutSubhead: "AI エージェント向けの承認優先データベース。",
    aboutCategory: "カテゴリ:",
    aboutCategoryValue:
      "AI エージェント向けの（承認 | プライバシー）優先（データベース | ナレッジベース）",
    convictionTitle: "私たちの確信",
    convictionP1:
      "AI エージェントがコンテンツを生成する速度は、人が評価できる速度を超えました。その結果、未レビューの出力で埋まったデータベース、誰も信頼しないナレッジベース、行動につながらない AI ノイズに追われるチームが生まれています。",
    convictionP2:
      "BusaBase を作ったのは、AI エージェントはスループットの最大化ではなく、人間の利益に仕えるべきだと考えているからです。AI が生成したすべての内容は、人の判断を通過してからナレッジベースに入るべきです。",
    convictionP3:
      "つまり、変更リクエストが届き、人がレビューし、必要なら修正を依頼し、承認します。その後にだけ正式なレコードになります。監査履歴は残り続け、チームは主導権を保てます。",
    whatIsTitle: "BusaBase とは",
    pillarApprovalTitle: "承認優先",
    pillarApprovalBody:
      "人の承認なしに AI 出力が正式なレコードになることはありません。変更リクエスト → レビュー → マージ。常にこの流れです。",
    pillarPrivacyTitle: "プライバシー優先",
    pillarPrivacyBody:
      "オープンソースのローカルエンジン。あなたが選ばない限り、データは端末から出ません。SaaS は不要です。",
    pillarAgentTitle: "エージェントネイティブ",
    pillarAgentBody:
      "REST API と構造化 schema は、後付けではなく AI エージェントのワークフロー向けに最初から設計されています。",
    openCoreTitle: "オープンコア",
    openCoreP1:
      "BusaBase OSS（このアプリ）はオープンソースのローカルエンジンです。ログイン不要、単一ローカルワークスペース、PGLite 永続化、REST API を備えています。永久無料で、セルフホスト可能で、監査できます。",
    openCoreP2:
      "BusaBase Cloud は同じコアを基盤に、複数ユーザーのワークスペース、チームロール、請求、エンタープライズ監査ログを提供します。インフラ運用なしで承認ワークフローを使いたいチーム向けのホスト版です。",
    aboutCtaTitle: "今日から AI 出力をレビューしましょう",
    aboutCtaBody:
      "ローカルエンジンを起動し、AI エージェントを API につなぎ、何を正式な情報にするかを人が決められるようにします。",
    openDashboard: "ダッシュボードを開く",
    viewOnGithub: "GitHub で見る",
    downloadTitle: "Busabase Desktop をダウンロード",
    downloadDescription:
      "公開されている Busabase デスクトップのリリースチャンネルから、macOS、Windows、Linux 用の Busabase Desktop をダウンロードできます。",
    downloadOgDescription:
      "承認優先の AI エージェントデータワークフロー向けに、ローカルファーストのデスクトップアプリとして Busabase を実行します。",
    apiDocsTitle: "Busabase API ドキュメント",
    desktopBadge: "Busabase Desktop",
    downloadHeadline: "お使いのコンピューターに Busabase をダウンロード",
    downloadSubhead:
      "ローカルストレージ、レビューキュー、更新対応リリースを備えた専用デスクトップアプリで、AI エージェント向けの承認優先ローカルデータベースを実行します。",
    downloadLatest: "最新バージョンをダウンロード",
    openWebDashboard: "Web ダッシュボードを開く",
    latestDesktopBuild: "最新デスクトップビルド",
    version: "バージョン {version}",
    appleSilicon: "Apple Silicon",
    intel: "Intel",
    windows: "Windows",
    linux: "Linux",
    macAppleSiliconDescription: "M シリーズチップ搭載の新しい Mac 向け。",
    macIntelDescription: "Intel ベースの Mac 向け。",
    windowsDescription: "最新リリースから .msi または .exe バンドルを選択してください。",
    linuxDescription: "最新リリースから .deb バンドルを選択してください。",
    mobileTitle: "モバイル",
    mobileBody:
      "外出先でもレビューキューと承認を処理できます。iPhone、iPad、Android 向け Busabase アプリを入手してください。",
    iphoneIpad: "iPhone と iPad",
    phoneTablet: "スマートフォンとタブレット",
    appStoreAction: "App Store でダウンロード",
    googlePlayAction: "Google Play で入手",
    signingNoticeTitle: "署名に関するお知らせ",
    signingNoticeBody:
      "コード署名と notarization が完全に設定されるまで、macOS と Windows のバンドルではプラットフォームのセキュリティ警告が表示される場合があります。",
    installFlowTitle: "インストール手順",
    installStep1: "お使いのオペレーティングシステム用のバンドルをダウンロードします。",
    installStep2: "Busabase Desktop を開き、ローカルレビューエンジンを起動します。",
    installStep3: "今後のデスクトップ更新にはリリースチャンネルを使用します。",
  },
  support: {
    title: "Busabase サポート",
    description:
      "Busabase Desktop、Busabase Mobile、Agent Skill のセットアップ、承認優先データベースワークフローについてサポートを受けられます。",
    badge: "サポート",
    headline: "Busabase のヘルプ",
    subhead:
      "Busabase Desktop、Busabase Mobile、ローカルレビューのワークフロー、AI エージェントのセットアップには、以下のサポート経路をご利用ください。",
    emailTitle: "メールサポート",
    emailBody:
      "ワークスペース、デバイス、発生した問題の短い説明を送ってください。可能であればスクリーンショットやログも添付してください。",
    setupTitle: "Agent Skill を設定",
    setupBody:
      "Claude Code、Codex、または他の AI エージェントを Busabase に接続し、レビュー対象の変更リクエストを作成できるようにします。",
    setupAction: "セットアップガイドを開く",
    downloadTitle: "アプリをダウンロード",
    downloadBody:
      "ローカルレビューエンジン用のデスクトップアプリをインストールするか、モバイルアプリで外出先から変更をレビューします。",
    downloadAction: "ダウンロードを開く",
    dashboardTitle: "ダッシュボードを開く",
    dashboardBody:
      "Busabase ワークスペースで、ローカル受信トレイ、アクティビティフィード、ベース schema、保留中の変更リクエストを確認します。",
    dashboardAction: "ダッシュボードを開く",
    includeTitle: "含めてほしい情報",
    includeBody:
      "より早くトラブルシューティングするために、Busabase のバージョン、オペレーティングシステム、Desktop・Mobile・Cloud・セルフホストのどれを使用しているか、失敗した正確な操作を含めてください。",
  },
  userEnvSettings: {
    ...zhCN.userEnvSettings,
    title: "環境変数",
    description:
      "このBusabaseインスタンスを呼び出すエージェントとAPIツールの実行時秘密情報を保存します。",
    openButton: "環境変数",
    nameLabel: "名前",
    valueLabel: "値",
    valuePlaceholder: "値",
    addVariable: "変数を追加",
    save: "保存",
    saving: "保存中...",
    loading: "環境変数を読み込み中...",
    clear: "クリア",
    reveal: "表示",
    hide: "非表示",
    saved: "環境変数を保存しました",
    saveFailed: "環境変数の保存に失敗しました",
    cleared: "環境変数をクリアしました",
    storageTitle: "ローカルユーザースコープ",
    storageDescription:
      "これらの値はローカルBusabaseデータベースに保存され、組み込みローカルユーザーに注入されます。",
    requestScopeTitle: "リクエストスコープ",
    requestScopeDescription:
      "API、RPC、MCP呼び出しは、process.envに書き込まずにBusabaseランタイム経由でこれらの値を読めます。",
    noVariables: "まだ変数は設定されていません。",
  },
};

export default ja;
