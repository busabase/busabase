import type { Translation } from "../i18n-types";

const zhCN: Translation = {
  common: {
    appName: "Busabase",
  },
  shell: {
    graphView: "图谱视图",
    loadingDashboard: "工作台加载中...",
    failedToLoadDashboard: "加载工作台数据失败",
    routeNotFoundTitle: "未找到工作台路由",
    routeNotFoundBody: "请从侧边栏打开收件箱、动态或数据库。",
    localPlan: "本地",
    approvalFirstKb: "审批优先知识库",
    addWorkspace: "添加工作区",
    inviteMembers: "邀请成员",
    accountSettings: "账号设置",
    settings: "设置",
    logOut: "退出登录",
    notifications: "通知",
    workspaces: "工作区",
    auto: "自动",
  },
  navigation: {
    review: "评审",
    inbox: "收件箱",
    activity: "动态",
    base: "数据库",
    blogPosts: "博客文章",
  },
  marketing: {
    aboutTitle: "关于 BusaBase",
    aboutDescription:
      "BusaBase 是面向 AI 代理的审批优先数据库。每条 AI 生成记录都必须经过人工评审，才能成为正式记录。",
    aboutEyebrow: "我们为什么构建 BusaBase",
    aboutHeadline: "AI 代理不应该以无限速度制造垃圾内容",
    aboutSubhead: "面向 AI 代理的审批优先数据库。",
    aboutCategory: "类别：",
    aboutCategoryValue: "面向 AI 代理的（审批 | 隐私）优先（数据库 | 知识库）",
    convictionTitle: "我们的判断",
    convictionP1:
      "AI 代理生成内容的速度已经超过了人类评估它的能力。结果是：数据库塞满未经评审的输出，知识库没人信任，团队被无法采取行动的 AI 噪音淹没。",
    convictionP2:
      "我们构建 BusaBase，是因为相信 AI 代理应该服务于人的利益，而不是只优化吞吐量。每一段 AI 生成内容都应该先通过人工判断，才有资格进入知识库。",
    convictionP3:
      "这意味着：变更请求进入系统，人类评审，需要时请求修改，然后批准。只有这样，它才会成为正式记录。审计轨迹永久保留，团队始终掌控。",
    whatIsTitle: "BusaBase 是什么",
    pillarApprovalTitle: "审批优先",
    pillarApprovalBody:
      "没有人工批准，任何 AI 输出都不会成为正式记录。变更请求 → 评审 → 合并。始终如此。",
    pillarPrivacyTitle: "隐私优先",
    pillarPrivacyBody: "开源本地引擎。除非你主动选择，否则数据不会离开你的机器。不需要 SaaS。",
    pillarAgentTitle: "代理原生",
    pillarAgentBody: "REST API 和结构化 schema 从一开始就为 AI 代理工作流设计，而不是事后改造。",
    openCoreTitle: "开放核心",
    openCoreP1:
      "BusaBase OSS（此应用）是开源本地引擎：无需登录、单一本地工作区、PGLite 持久化、REST API。它是基础层：永久免费、可自托管、可审计。",
    openCoreP2:
      "BusaBase Cloud 基于同一核心，提供多用户工作区、团队角色、计费和企业审计日志。它是为不想运行基础设施的团队准备的托管层。",
    aboutCtaTitle: "今天开始评审 AI 输出",
    aboutCtaBody: "运行本地引擎，把 AI 代理接到 API，让人类决定哪些内容成为正式记录。",
    openDashboard: "打开工作台",
    viewOnGithub: "在 GitHub 查看",
    downloadTitle: "下载 Busabase Desktop",
    downloadDescription:
      "从公开 Busabase 桌面发布频道下载适用于 macOS、Windows 和 Linux 的 Busabase Desktop。",
    downloadOgDescription: "以本地优先桌面应用运行 Busabase，用于审批优先的 AI 代理数据工作流。",
    desktopBadge: "Busabase Desktop",
    downloadHeadline: "为你的电脑下载 Busabase",
    downloadSubhead:
      "通过专注的桌面应用运行面向 AI 代理的审批优先本地数据库，包含本地存储、评审队列和可更新发布。",
    downloadLatest: "下载最新版本",
    openWebDashboard: "打开网页版工作台",
    latestDesktopBuild: "最新桌面版本",
    version: "版本 {version}",
    macAppleSiliconDescription: "适用于搭载 M 系列芯片的新款 Mac。",
    macIntelDescription: "适用于 Intel 芯片 Mac。",
    windowsDescription: "从最新发布中选择 .msi 或 .exe 安装包。",
    linuxDescription: "从最新发布中选择 .deb 安装包。",
    mobileTitle: "移动端",
    mobileBody: "随时处理评审队列和批准流程：获取适用于 iPhone、iPad 和 Android 的 Busabase 应用。",
    iphoneIpad: "iPhone 与 iPad",
    phoneTablet: "手机与平板",
    appStoreAction: "在 App Store 下载",
    googlePlayAction: "在 Google Play 获取",
    signingNoticeTitle: "签名提示",
    signingNoticeBody:
      "在代码签名和 notarization 完全配置前，macOS 和 Windows 安装包可能会显示平台安全警告。",
    installFlowTitle: "安装流程",
    installStep1: "下载适用于你操作系统的安装包。",
    installStep2: "打开 Busabase Desktop 并启动本地评审引擎。",
    installStep3: "使用发布频道获取后续桌面更新。",
  },
};

export default zhCN;
