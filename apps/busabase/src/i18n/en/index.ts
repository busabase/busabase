import type { BaseTranslation } from "../i18n-types";

const en: BaseTranslation = {
  common: {
    appName: "Busabase",
  },
  shell: {
    graphView: "Graph View",
    loadingDashboard: "Loading dashboard...",
    failedToLoadDashboard: "Failed to load dashboard data",
    routeNotFoundTitle: "Dashboard route not found",
    routeNotFoundBody: "Open Inbox, Activity, or a Base from the sidebar.",
    localPlan: "Local",
    approvalFirstKb: "Approval-first KB",
    addWorkspace: "Add workspace",
    inviteMembers: "Invite members",
    accountSettings: "Account settings",
    settings: "Settings",
    logOut: "Log out",
    notifications: "Notifications",
    workspaces: "Workspaces",
    auto: "Auto",
  },
  navigation: {
    review: "Review",
    inbox: "Inbox",
    activity: "Activity",
    base: "Base",
    blogPosts: "Blog Posts",
  },
  marketing: {
    aboutTitle: "About BusaBase",
    aboutDescription:
      "BusaBase is an approval-first database for AI agents. Every AI-generated record must pass human review before it becomes canonical.",
    aboutEyebrow: "Why we built BusaBase",
    aboutHeadline: "AI agents shouldn't exist to produce garbage at infinite speed",
    aboutSubhead: "An approval-first database for AI agents.",
    aboutCategory: "Category:",
    aboutCategoryValue: "(Approval | Privacy)-first (Database | Knowledgebase) for AI Agents",
    convictionTitle: "Our conviction",
    convictionP1:
      "The speed at which AI agents can generate content has outpaced the human capacity to evaluate it. The result: databases filled with unreviewed output, knowledge bases that nobody trusts, and teams drowning in AI-generated noise they can't act on.",
    convictionP2:
      "We built BusaBase because we believe AI agents should serve human interests — not optimize for throughput. Every piece of AI-generated content should earn its place in a knowledge base by passing human judgment first.",
    convictionP3:
      "That means: a change request comes in, a human reviews it, requests changes if needed, then approves. Only then does it become a canonical record. The audit trail stays forever. The team stays in control.",
    whatIsTitle: "What BusaBase is",
    pillarApprovalTitle: "Approval-first",
    pillarApprovalBody:
      "No AI output becomes a canonical record without human approval. Change Request → Review → Merge. Always.",
    pillarPrivacyTitle: "Privacy-first",
    pillarPrivacyBody:
      "Open-source local engine. Your data never leaves your machine unless you choose to. No SaaS required.",
    pillarAgentTitle: "Agent-native",
    pillarAgentBody:
      "REST API and structured schema designed from the ground up for AI agent workflows, not retrofitted.",
    openCoreTitle: "Open core",
    openCoreP1:
      "BusaBase OSS (this app) is the open-source local engine — no login, one local workspace, PGLite persistence, REST APIs. It's the foundation: free forever, self-hostable, auditable.",
    openCoreP2:
      "BusaBase Cloud wraps the same core with multi-user workspaces, team roles, billing, and enterprise audit logs. It's the hosted layer for teams who want the approval workflow without running infrastructure.",
    aboutCtaTitle: "Start reviewing AI output today",
    aboutCtaBody:
      "Run the local engine, point your AI agent at the API, and let humans decide what becomes canonical.",
    openDashboard: "Open Dashboard",
    viewOnGithub: "View on GitHub",
    downloadTitle: "Download Busabase Desktop",
    downloadDescription:
      "Download Busabase Desktop for macOS, Windows, and Linux from the public Busabase desktop release channel.",
    downloadOgDescription:
      "Run Busabase as a local-first desktop app for approval-first AI agent data workflows.",
    desktopBadge: "Busabase Desktop",
    downloadHeadline: "Download Busabase for your computer",
    downloadSubhead:
      "Run the approval-first local database for AI agents from a focused desktop app, with local storage, review queues, and updater-ready releases.",
    downloadLatest: "Download latest version",
    openWebDashboard: "Open web dashboard",
    latestDesktopBuild: "Latest desktop build",
    version: "Version {version:string}",
    macAppleSiliconDescription: "For newer Macs with M-series chips.",
    macIntelDescription: "For Intel-based Macs.",
    windowsDescription: "Choose the .msi or .exe bundle from the latest release.",
    linuxDescription: "Choose the .deb bundle from the latest release.",
    mobileTitle: "Mobile",
    mobileBody:
      "Review queues and approvals on the go — get the Busabase app for iPhone, iPad, and Android.",
    iphoneIpad: "iPhone & iPad",
    phoneTablet: "Phone & Tablet",
    appStoreAction: "Download on the App Store",
    googlePlayAction: "Get it on Google Play",
    signingNoticeTitle: "Signing notice",
    signingNoticeBody:
      "macOS and Windows bundles may show platform security warnings until code signing and notarization are fully configured.",
    installFlowTitle: "Install flow",
    installStep1: "Download the bundle for your operating system.",
    installStep2: "Open Busabase Desktop and start the local review engine.",
    installStep3: "Use the release channel for future desktop updates.",
  },
};

export default en;
