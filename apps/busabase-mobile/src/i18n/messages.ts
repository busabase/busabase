// Message catalog for the mobile app. English is the source of truth; every other
// locale must provide the same key shape (enforced by the `CoreMessages` type).
// Mirrors the lightweight approach in busabase-core/i18n — no external i18n library.

export const en = {
  common: {
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    create: "Create",
    restore: "Restore",
    deleteForever: "Delete forever",
    retry: "Retry",
    loading: "Loading",
    close: "Close",
    edit: "Edit",
    open: "Open",
    yes: "Yes",
    no: "No",
    notConnected: "Not connected",
  },
  nav: {
    review: "Review",
    home: "Home",
    inbox: "Inbox",
    search: "Search",
    activity: "Activity",
    graph: "Graph View",
    assets: "Assets",
    archived: "Archive",
    library: "Library",
    settings: "Settings",
    // The drawer's Favorites section header — rendered ONLY when the actor has
    // at least one favorite, exactly like the web sidebar (an empty Favorites
    // section is the clutter this feature exists to remove).
    favorites: "Favorites",
    records: "Records",
    bases: "Bases",
    newBase: "New Base",
    create: "Create",
    // Space Selector sheet: the destination group above the workspace list.
    goTo: "Go to",
    // An ACTION, not a route — the trailing ellipsis is what says "this opens
    // something", exactly as it does in the web Space Selector menu.
    installFromGithub: "Install from GitHub…",
    // The drawer section holding the whole node tree — every node type, not just
    // Bases or docs. Named for the scope it covers ("everything in this space"),
    // not for a node type, so adding a node type never dates the label. Same
    // string and same reasoning as the web sidebar (core's `nav.workspace`).
    workspace: "Workspace",
    workspaces: "Workspaces",
    workspaceLoading: "Loading workspace",
    workspaceError: "Could not load workspace",
    workspaceEmpty: "Nothing here yet",
  },
  // The landing digest — mirrors the web dashboard's `home` block
  // (packages/busabase-core/src/i18n/messages.ts). Keep the wording in sync.
  home: {
    title: "Home",
    subtitle: "Where you left off",
    pendingTitle: "Waiting for your review",
    pendingCount: "{count} pending",
    pendingViewAll: "Review all",
    recentTitle: "Recently visited",
    recentEmptyBody: "Bases and documents you open will show up here.",
    activityTitle: "Recent activity",
    activityViewAll: "View all activity",
    activityEmptyBody: "Changes made across this workspace will show up here.",
    emptyTitle: "Nothing here yet",
    emptyBody:
      "Create a Base, Doc, or Skill from the drawer — anything an agent proposes lands in your Inbox for review.",
    // The brand-new-workspace guide. Explanatory copy is shared word-for-word
    // with the web dashboard's EmptyAgentGuide so the two platforms read the
    // same; only the call to action differs (web opens Agent Skills, which this
    // app has no surface for, so it opens the create sheet instead).
    guideTitle: "Let an agent help fill this workspace",
    guideBody:
      "Busabase can stay manual, but it is designed so agents open Change Requests and humans approve what becomes canonical.",
    guideStructuredData: "Create structured data and seed useful examples",
    guideChangeRequests: "Open Change Requests for review instead of writing directly",
    guideAgentDatabase: "Add records, update fields, and evolve a Database with an AI agent",
    guideManualHint: "Or create manually from here.",
  },
  assets: {
    title: "Assets",
    subtitle: "Shared media library",
    empty: "No assets yet",
    emptyHint: "Files attached to records show up here.",
    usedTimes: "Used {count}×",
    unused: "Unused",
    info: "Info",
    preview: "Preview",
    size: "Size",
    type: "Type",
    contentHash: "Content hash",
    whereUsed: "Where used",
    notUsed: "Not referenced anywhere yet.",
    actionsTitle: "Asset actions",
    actionsHint: "Manage this asset from one place.",
    deleteTitle: "Delete asset",
    deleteBlocked: "Still referenced — remove all usages first.",
    deleteConfirm: "Permanently delete this asset? This cannot be undone.",
    notFound: "Asset not found",
  },
  archived: {
    title: "Archived",
    subtitle: "Restore or permanently delete",
    empty: "Trash is empty",
    emptyHint: "Deleted bases, folders, docs, and skills land here.",
    basesSection: "Bases",
    nodesSection: "Folders · Docs · Skills",
    restoreHint: "Tap row to restore",
    restoreConfirm: 'Create a restore change request for "{name}"?',
    purgeTitle: "Delete forever",
    purgeConfirm: 'Permanently delete "{name}"? This cannot be undone.',
  },
  createNode: {
    title: "Create",
    typeLabel: "Type",
    name: "Name",
    slug: "Slug",
    description: "Description (optional)",
    reviewNote: "Creates a change request for review. It appears after the request is merged.",
    submit: "Create {type}",
    nameRequired: "Name is required.",
    base: "Base",
    folder: "Folder",
    doc: "Doc",
    skill: "Skill",
    drive: "Drive",
  },
  attachment: {
    add: "Add file",
    addImage: "Add image",
    uploading: "Uploading…",
    remove: "Remove",
    empty: "No files",
  },
  // The drawer's per-node "•••" sheet — the touch stand-in for the web
  // sidebar's hover-revealed actions menu (dashboard-shell `buildNavItem`).
  nodeActions: {
    more: "More actions",
    sheetHint: "Manage this item",
    open: "Open",
    rename: "Rename",
    permissions: "Permissions",
    move: "Move to…",
    agentPrompts: "Agent prompts",
    share: "Share",
    delete: "Delete",
    back: "Back",
  },
  // Mirrors busabase-core's `favorites` block; keep the wording in sync.
  favorites: {
    add: "Add to Favorites",
    remove: "Remove from Favorites",
    updated: "Favorites updated",
    removeFailed: "Couldn't remove from Favorites",
    addFailed: "Couldn't add to Favorites",
  },
  // Node-level public link sharing. Mirrors busabase-core's `share` block; keep
  // the wording in sync. `expiry*` are mobile-only: there is no touch equivalent
  // of web's `datetime-local` input without a date-picker dependency, so the
  // mobile sheet offers presets instead.
  share: {
    title: "Share",
    shareToWeb: "Share to web",
    shareToWebHint: "Anyone with the link can open this node",
    capabilityLabel: "What visitors can do",
    capabilityRead: "View only",
    capabilitySubmit: "Allow submissions",
    passwordLabel: "Password",
    passwordHint: "Leave empty for no password",
    passwordPlaceholder: "Set a password",
    passwordSet: "A password is set — type a new one to change it, or clear it",
    passwordSave: "Set password",
    passwordClear: "Remove password",
    expiryLabel: "Expires",
    expiryHint: "Leave empty for no expiry",
    expiryNever: "Never",
    expiryDay: "24 hours",
    expiryWeek: "7 days",
    expiryMonth: "30 days",
    expiresOn: "Expires {date}",
    linkLabel: "Public link",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    copyUnavailable: "Copying isn't available here — select the link above instead.",
    linkUnavailable: "The public link needs a workspace id — reconnect and try again.",
    enabled: "Public link enabled",
    disabled: "Public link disabled",
    updated: "Share settings updated",
    failed: "Something went wrong",
  },
  // The Delete confirm. Mirrors busabase-core's `nodeDetail` delete strings
  // (web archives to Trash and the item can be restored); keep them in sync.
  nodeDelete: {
    title: "Delete {type}?",
    body: 'This moves "{name}" to Trash. You can restore it later.',
    folderBody: 'This moves "{name}" and its {count} items to Trash. You can restore them later.',
    confirm: "Move to Trash",
    moved: "{type} moved to Trash",
    failed: "Failed to delete {type}",
  },
  // "Agent prompts" — the per-node copy-paste cheatsheet. Mirrors busabase-core's
  // `agentPrompts` block plus a mobile port of the prompt bodies from
  // `helpers/node-agent-prompts.ts`; keep both in sync.
  agentPrompts: {
    title: "Agent prompts",
    intro:
      "Copy a prompt into your agent — it already points at this node, so the agent doesn't have to guess where to work.",
    scenariosTab: "Scenarios",
    capabilitiesTab: "Capabilities",
    scenariosEmpty: "No curated scenarios for this node type yet — see the Capabilities tab.",
    copy: "Copy prompt",
    copied: "Copied",
    copyUnavailable: "Copying isn't available here — select the prompt text above instead.",
    // Capability-list group headings.
    groupRecord: "Records",
    groupField: "Fields",
    groupView: "Views",
    groupContent: "Content",
    groupGeneral: "General",
    groupOther: "Other",
    // Shared framing: the target line (with and without a resolved space), the
    // approval-first footer appended to every prompt, and the capability body.
    target: 'Target: the Busabase {type} "{name}" (nodeId: {nodeId}).',
    targetWithSpace:
      'Target: the Busabase {type} "{name}" (nodeId: {nodeId}), in space "{spaceName}" (spaceId: {spaceId}).',
    footer:
      "Submit the change as a ChangeRequest and never merge it without my approval. Reply to me in English.",
    capabilityBody:
      "{target}\n\nPerform this operation: {operation}.\nInspect the node's current state first, then ask me for anything you still need.",
    baseBulkImportLabel: "Bulk-add records",
    baseBulkImportBody:
      "{target}\n\nI want to bulk-add records. Read the field schema first, then map what I give you onto those fields. Flag anything that looks like a duplicate of an existing record and ask me before writing it.",
    baseDesignSchemaLabel: "Design the schema for me",
    baseDesignSchemaBody:
      "{target}\n\nI'll describe what I need to track. Propose a field schema for it — field names, types, and why each one — and show me the proposal before creating or changing any field.",
    baseDedupeLabel: "Find and clean duplicates",
    baseDedupeBody:
      "{target}\n\nScan the records for duplicates and near-duplicates. List what you found and how you'd merge or remove each group — don't change anything until I pick.",
    baseSummarizeLabel: "Summarize and report",
    baseSummarizeBody:
      "{target}\n\nRead the records and give me a summary: the key numbers, notable patterns, and anything that looks off. This is read-only — don't modify the data.",
    docDraftLabel: "Draft / expand this doc",
    docDraftBody:
      "{target}\n\nRead the current content, then draft or expand it based on what I tell you next. Keep the existing structure and tone unless I ask otherwise.",
    docReviewLabel: "Review and suggest edits",
    docReviewBody:
      "{target}\n\nReview this doc for clarity, gaps, and anything factually shaky. Give me the suggested edits as a list first — don't rewrite it until I say which ones to apply.",
    driveOrganizeLabel: "Organize these files",
    driveOrganizeBody:
      "{target}\n\nList what's in here, then propose a cleaner structure — naming and grouping. Show me the plan before moving or renaming anything.",
    driveSummarizeLabel: "Summarize the contents",
    driveSummarizeBody:
      "{target}\n\nRead through the files and tell me what's in here — what each one is for, and anything outdated or redundant. Read-only.",
    skillImproveLabel: "Improve this skill",
    skillImproveBody:
      "{target}\n\nRead this skill's files and tell me where the instructions are ambiguous, missing, or likely to be misread by an agent. Propose concrete edits before changing anything.",
    airappAddFeatureLabel: "Add a feature",
    airappAddFeatureBody:
      "{target}\n\nRead the app's current source, then add the feature I describe next. Tell me which files you'll touch before you start.",
    airappDebugLabel: "Debug a problem",
    airappDebugBody:
      "{target}\n\nI'll describe what's going wrong. Read the source, find the actual cause, and explain it to me before you fix anything.",
  },
  // Mirrors busabase-core's `rename` block; keep the wording in sync.
  rename: {
    title: "Rename",
    nameLabel: "Name",
    namePlaceholder: "Enter a new name",
    requestRename: "Request rename",
    renameNow: "Rename now",
    renamed: "Renamed",
    renameRequestSubmitted: "Rename request submitted",
    requestReviewHint: "Submits a change request instead of applying it now.",
    nameRequired: "Name is required.",
    failed: "Failed to rename",
  },
  // Mirrors busabase-core's `move` block; keep the wording in sync.
  move: {
    title: "Move to…",
    description: 'Choose a destination folder for "{name}".',
    root: "Root",
    confirm: "Move here",
    empty: "No other folders to move into.",
    moved: "Moved",
    invalidTarget: "That folder sits inside the item you are moving.",
    failed: "Couldn't move the item. Please try again.",
  },
  // Mirrors busabase-core's `permissions` block; keep the wording in sync.
  permissions: {
    title: "Permissions",
    accessVisibleToAll: "Everyone in this space can see this",
    accessPrivate: "Private — only the people below can see this",
    accessInherited: 'Private — inherited from "{name}"',
    makePrivate: "Restrict access",
    makePrivateHint: "Only the people below (and space admins) can see this",
    inheritedLockHint: 'Already private via "{name}" — manage access there',
    peopleHeading: "People & spaces with access",
    everyone: "Everyone in this space",
    noGrants: "No one has been granted access yet.",
    loadingGrants: "Loading access",
    grantHeading: "Grant access",
    grantEveryone: "Grant to everyone in this space",
    userIdPlaceholder: "User id",
    userIdLabel: "User id",
    roleLabel: "Access level",
    add: "Add",
    remove: "Remove",
    roleRead: "Read",
    roleChangeRequest: "Can propose changes",
    roleWrite: "Can write",
    roleManage: "Manage",
    failed: "Something went wrong",
  },
  // "Install from GitHub" — the mobile face of spec §15.6. Copy is kept
  // word-for-word in sync with busabase-core's `install` block
  // (packages/busabase-core/src/i18n/messages.ts), because the flow and its
  // consequences are identical on both surfaces; only the layout differs.
  install: {
    title: "Install from GitHub",
    description:
      "Paste a link to a repository that holds a Busabase package. You'll see exactly what it would create before anything is installed.",
    repoUrl: "Repository URL",
    repoUrlPlaceholder: "https://github.com/owner/repo",
    repoUrlHint:
      "A tag or branch pins the version: .../tree/v1.2.0 — and a monorepo's package lives at .../tree/main/subdir.",
    repoUrlRequired: "Enter a GitHub repository URL.",
    preview: "Preview",
    previewing: "Fetching package…",
    previewFailed: "Could not read that package.",
    source: "Source",
    sourceRef: "at {ref}",
    sourceSubdir: "in {subdir}",
    packageVersion: "Version {version}",
    packageAuthor: "by {author}",
    packageLicense: "{license} license",
    contents: "What this would create",
    emptyPackage: "This package contains nothing to install.",
    baseSummary: "{fields} fields · {records} records",
    fileTreeSummary: "{files} files",
    countsSummary:
      "{folders} folders · {docs} docs · {bases} bases · {records} records · {files} files",
    collisionsTitle: "Names already taken",
    collisionsBody:
      "These would clash with content that already exists. Nothing is ever overwritten — either install them under new names, or choose a different target folder.",
    collisionNode: 'A node named "{slug}" already exists in {path}.',
    collisionBase:
      'A Base named "{slug}" already exists in this space (Base names are space-wide).',
    collisionRenamedTo: 'Will be installed as "{renamedTo}".',
    rename: "Install clashing items under new names",
    renameHint: "Adds a suffix (-2, -3, …). Existing content is left untouched.",
    warningsTitle: "Worth knowing",
    targetFolder: "Install into folder",
    targetFolderHint:
      "A new folder is created for the package. Defaults to the package's own name.",
    autoMerge: "Install immediately, without review",
    autoMergeBody:
      "By default the package's content arrives as change requests you read before anything goes live. Skipping that means trusting the author: a package can carry skills and AirApps, and that is code this space's agents will run.",
    autoMergeRequiredTitle: "This package can only be installed without review",
    autoMergeRequiredBody:
      "Its records link to each other, and a link can only point at a record that already exists. Held for review, every link would arrive empty — so the records have to be created immediately. Read the package on GitHub first: installing it runs the author's skills and AirApps in this space.",
    install: "Install",
    installing: "Installing…",
    installingHint: "This can take a while — each item is created one at a time.",
    installFailed: "Could not install the package.",
    resultTitle: "Installed into {folder}",
    resultCounts:
      "{folders} folders · {bases} bases · {views} views · {docs} docs · {records} records · {files} files",
    pendingTitle: "{count} change requests are waiting for you",
    pendingBody:
      "The package's content is proposed, not live. Nothing from it reaches your space until you review and merge it.",
    reviewNow: "Review them now",
    noPending: "Everything was merged — the package is live in your space.",
    done: "Done",
  },
  settings: {
    language: "Language",
    languageHint: "Changes the app interface language.",
    auto: "System default",
  },
} as const;

// Widen the `as const` leaf literals to `string` so other locales can supply their
// own translations while keeping the exact key shape.
export type CoreMessages = {
  [Section in keyof typeof en]: { [Key in keyof (typeof en)[Section]]: string };
};

// Simplified Chinese. Keep the key shape identical to `en`.
export const zhCN: CoreMessages = {
  common: {
    cancel: "取消",
    save: "保存",
    delete: "删除",
    create: "创建",
    restore: "恢复",
    deleteForever: "永久删除",
    retry: "重试",
    loading: "加载中",
    close: "关闭",
    edit: "编辑",
    open: "打开",
    yes: "是",
    no: "否",
    notConnected: "未连接",
  },
  nav: {
    review: "审阅",
    home: "首页",
    inbox: "收件箱",
    search: "搜索",
    activity: "动态",
    graph: "关系图",
    assets: "素材",
    archived: "归档",
    library: "资料库",
    settings: "设置",
    favorites: "收藏",
    records: "记录",
    bases: "数据表",
    newBase: "新建数据表",
    create: "创建",
    goTo: "前往",
    installFromGithub: "从 GitHub 安装…",
    workspace: "工作区",
    workspaces: "工作区",
    workspaceLoading: "正在加载工作区",
    workspaceError: "无法加载工作区",
    workspaceEmpty: "这里还没有内容",
  },
  home: {
    title: "首页",
    subtitle: "从上次的地方继续",
    pendingTitle: "等待你评审",
    pendingCount: "{count} 条待处理",
    pendingViewAll: "全部评审",
    recentTitle: "最近访问",
    recentEmptyBody: "你打开过的数据表和文档会显示在这里。",
    activityTitle: "最近动态",
    activityViewAll: "查看全部动态",
    activityEmptyBody: "这个工作区里发生的变更会显示在这里。",
    emptyTitle: "这里还是空的",
    emptyBody: "从抽屉里创建数据表、文档或技能 — 智能体提出的任何变更都会进入收件箱等你评审。",
    guideTitle: "让代理帮助填充此工作区",
    guideBody:
      "Busabase 可以手动使用，但它的设计目标是让代理发起变更请求，由人类批准哪些内容成为正式记录。",
    guideStructuredData: "创建结构化数据并填充有用示例",
    guideChangeRequests: "打开变更请求进行评审，而不是直接写入",
    guideAgentDatabase: "用 AI 代理添加记录、更新字段并演进数据库",
    guideManualHint: "也可以在这里手动创建。",
  },
  assets: {
    title: "素材",
    subtitle: "共享媒体库",
    empty: "暂无素材",
    emptyHint: "记录中的附件会显示在这里。",
    usedTimes: "引用 {count} 次",
    unused: "未使用",
    info: "信息",
    preview: "预览",
    size: "大小",
    type: "类型",
    contentHash: "内容哈希",
    whereUsed: "引用位置",
    notUsed: "尚未被任何地方引用。",
    actionsTitle: "素材操作",
    actionsHint: "在这里管理此素材。",
    deleteTitle: "删除素材",
    deleteBlocked: "仍被引用 — 请先移除所有引用。",
    deleteConfirm: "确定永久删除此素材？此操作无法撤销。",
    notFound: "未找到素材",
  },
  archived: {
    title: "归档",
    subtitle: "恢复或永久删除",
    empty: "回收站为空",
    emptyHint: "已删除的数据表、文件夹、文档和技能会出现在这里。",
    basesSection: "数据表",
    nodesSection: "文件夹 · 文档 · 技能",
    restoreHint: "点击行恢复",
    restoreConfirm: "为“{name}”创建恢复变更请求？",
    purgeTitle: "永久删除",
    purgeConfirm: "确定永久删除“{name}”？此操作无法撤销。",
  },
  createNode: {
    title: "创建",
    typeLabel: "类型",
    name: "名称",
    slug: "标识",
    description: "描述（可选）",
    reviewNote: "将创建一个待审阅的变更请求，合并后生效。",
    submit: "创建{type}",
    nameRequired: "名称不能为空。",
    base: "数据表",
    folder: "文件夹",
    doc: "文档",
    skill: "技能",
    drive: "文件盘",
  },
  attachment: {
    add: "添加文件",
    addImage: "添加图片",
    uploading: "上传中…",
    remove: "移除",
    empty: "暂无文件",
  },
  nodeActions: {
    more: "更多操作",
    sheetHint: "管理此项",
    open: "打开",
    rename: "重命名",
    permissions: "权限",
    move: "移动到…",
    agentPrompts: "Agent 提示词",
    share: "分享",
    delete: "删除",
    back: "返回",
  },
  favorites: {
    add: "添加到收藏",
    remove: "从收藏中移除",
    updated: "收藏已更新",
    removeFailed: "无法从收藏中移除",
    addFailed: "无法添加到收藏",
  },
  share: {
    title: "分享",
    shareToWeb: "分享到网页",
    shareToWebHint: "任何拿到链接的人都可以打开此节点",
    capabilityLabel: "访客可以做什么",
    capabilityRead: "仅查看",
    capabilitySubmit: "允许提交",
    passwordLabel: "密码",
    passwordHint: "留空表示不设密码",
    passwordPlaceholder: "设置密码",
    passwordSet: "已设置密码——输入新密码可修改，或清除它",
    passwordSave: "设置密码",
    passwordClear: "移除密码",
    expiryLabel: "过期时间",
    expiryHint: "留空表示永不过期",
    expiryNever: "永不过期",
    expiryDay: "24 小时",
    expiryWeek: "7 天",
    expiryMonth: "30 天",
    expiresOn: "{date} 过期",
    linkLabel: "公开链接",
    copyLink: "复制链接",
    linkCopied: "已复制链接",
    copyUnavailable: "此处无法复制，请直接选中上方的链接。",
    linkUnavailable: "生成公开链接需要工作区 ID，请重新连接后再试。",
    enabled: "已启用公开链接",
    disabled: "已关闭公开链接",
    updated: "分享设置已更新",
    failed: "操作出错",
  },
  nodeDelete: {
    title: "删除 {type}？",
    body: "这会将“{name}”移到回收站。之后可以恢复。",
    folderBody: "这会将“{name}”及其 {count} 个项目移到回收站。之后可以恢复。",
    confirm: "移到回收站",
    moved: "{type} 已移到回收站",
    failed: "删除 {type} 失败",
  },
  agentPrompts: {
    title: "Agent 提示词",
    intro:
      "复制一条提示词给你的 Agent —— 里面已经带上这个节点的定位信息，Agent 不用猜要在哪里干活。",
    scenariosTab: "场景",
    capabilitiesTab: "能力",
    scenariosEmpty: "这类节点还没有精选场景，可以看「能力」标签页。",
    copy: "复制提示词",
    copied: "已复制",
    copyUnavailable: "此处无法复制，请直接选中上方的提示词文本。",
    groupRecord: "记录",
    groupField: "字段",
    groupView: "视图",
    groupContent: "内容",
    groupGeneral: "通用",
    groupOther: "其他",
    target: "目标：Busabase 的 {type}「{name}」（nodeId: {nodeId}）。",
    targetWithSpace:
      "目标：Busabase 的 {type}「{name}」（nodeId: {nodeId}），位于空间「{spaceName}」（spaceId: {spaceId}）。",
    footer: "以 ChangeRequest 提交改动，未经我批准绝不要合并。请用简体中文回复我。",
    capabilityBody:
      "{target}\n\n请执行操作：{operation}。\n先查看该节点的当前状态，还缺什么信息就直接问我。",
    baseBulkImportLabel: "批量录入数据",
    baseBulkImportBody:
      "{target}\n\n我要批量录入数据。请先读取字段结构，再把我给你的内容按字段对应填好。遇到疑似和已有记录重复的，先问我再写入。",
    baseDesignSchemaLabel: "帮我设计表结构",
    baseDesignSchemaBody:
      "{target}\n\n我会描述我要记录什么。请据此设计字段结构——字段名、类型、以及每个字段的理由——先把方案给我看，我确认后再新建或修改字段。",
    baseDedupeLabel: "清理重复记录",
    baseDedupeBody:
      "{target}\n\n请扫描记录里的重复项和近似重复项。列出你找到的分组，以及每组你打算怎么合并或删除——在我挑选之前不要动任何数据。",
    baseSummarizeLabel: "汇总分析并出报告",
    baseSummarizeBody:
      "{target}\n\n请阅读记录并给我一份总结：关键数字、值得注意的规律、以及看起来不对劲的地方。这是只读任务——不要修改数据。",
    docDraftLabel: "起草或扩写这篇文档",
    docDraftBody:
      "{target}\n\n请先读当前内容，再根据我接下来的要求起草或扩写。除非我另有要求，保持现有的结构和语气。",
    docReviewLabel: "审阅并提出修改建议",
    docReviewBody:
      "{target}\n\n请从清晰度、缺漏、以及事实站不住脚的地方审阅这篇文档。先以列表形式给我修改建议——在我指定采纳哪些之前不要直接改写。",
    driveOrganizeLabel: "整理这些文件",
    driveOrganizeBody:
      "{target}\n\n请列出里面有什么，然后提出更清晰的组织方式——命名和分组。在移动或重命名任何东西之前，先把方案给我看。",
    driveSummarizeLabel: "总结文件内容",
    driveSummarizeBody:
      "{target}\n\n请通读这些文件，告诉我里面都有什么——每个文件是做什么的，以及哪些已经过时或冗余。只读，不要改动。",
    skillImproveLabel: "改进这个 Skill",
    skillImproveBody:
      "{target}\n\n请读这个 skill 的文件，告诉我哪些指令含糊、缺失、或容易被 agent 误读。先提出具体修改建议，再动手改。",
    airappAddFeatureLabel: "加一个功能",
    airappAddFeatureBody:
      "{target}\n\n请先读这个应用的现有代码，再实现我接下来描述的功能。动手前先告诉我你打算改哪些文件。",
    airappDebugLabel: "排查一个问题",
    airappDebugBody:
      "{target}\n\n我会描述出了什么问题。请读代码找出真正的原因，先讲清楚给我听，再动手修。",
  },
  rename: {
    title: "重命名",
    nameLabel: "名称",
    namePlaceholder: "输入新名称",
    requestRename: "提交重命名请求",
    renameNow: "立即重命名",
    renamed: "已重命名",
    renameRequestSubmitted: "重命名请求已提交",
    requestReviewHint: "提交变更请求，而不是立即生效。",
    nameRequired: "名称不能为空。",
    failed: "重命名失败",
  },
  move: {
    title: "移动到…",
    description: "为「{name}」选择目标文件夹。",
    root: "根目录",
    confirm: "移动到此处",
    empty: "没有其他可移动到的文件夹。",
    moved: "已移动",
    invalidTarget: "该文件夹位于你要移动的项目内部。",
    failed: "移动失败，请重试。",
  },
  permissions: {
    title: "权限",
    accessVisibleToAll: "本空间所有成员可见",
    accessPrivate: "私有 · 仅下方成员可见",
    accessInherited: "私有 · 继承自「{name}」",
    makePrivate: "限制访问",
    makePrivateHint: "仅下方成员（及空间管理员）可见",
    inheritedLockHint: "已由上级「{name}」设为私有，请在该处管理",
    peopleHeading: "有访问权限的成员和空间",
    everyone: "本空间所有成员",
    noGrants: "尚未授予任何人访问权限。",
    loadingGrants: "正在加载权限",
    grantHeading: "授予访问权限",
    grantEveryone: "授予本空间所有成员",
    userIdPlaceholder: "用户 ID",
    userIdLabel: "用户 ID",
    roleLabel: "访问级别",
    add: "添加",
    remove: "移除",
    roleRead: "只读",
    roleChangeRequest: "可提交变更",
    roleWrite: "可写入",
    roleManage: "可管理",
    failed: "操作出错",
  },
  install: {
    title: "从 GitHub 安装",
    description: "粘贴一个存放 Busabase 软件包的仓库链接。安装前你会先看到它到底会创建些什么。",
    repoUrl: "仓库地址",
    repoUrlPlaceholder: "https://github.com/owner/repo",
    repoUrlHint:
      "用标签或分支锁定版本：.../tree/v1.2.0；单仓多包时，包在 .../tree/main/subdir 下。",
    repoUrlRequired: "请填写 GitHub 仓库地址。",
    preview: "预览",
    previewing: "正在获取软件包…",
    previewFailed: "无法读取该软件包。",
    source: "来源",
    sourceRef: "版本 {ref}",
    sourceSubdir: "位于 {subdir}",
    packageVersion: "版本 {version}",
    packageAuthor: "作者 {author}",
    packageLicense: "{license} 许可证",
    contents: "将会创建的内容",
    emptyPackage: "该软件包没有可安装的内容。",
    baseSummary: "{fields} 个字段 · {records} 条记录",
    fileTreeSummary: "{files} 个文件",
    countsSummary:
      "{folders} 个文件夹 · {docs} 篇文档 · {bases} 个数据库 · {records} 条记录 · {files} 个文件",
    collisionsTitle: "名称已被占用",
    collisionsBody:
      "以下名称会和已有内容撞车。已有内容永远不会被覆盖——你可以让它们用新名称安装，或换一个目标文件夹。",
    collisionNode: "{path} 中已经有名为“{slug}”的节点。",
    collisionBase: "本空间已存在名为“{slug}”的数据库（数据库名称在整个空间内唯一）。",
    collisionRenamedTo: "将以“{renamedTo}”安装。",
    rename: "撞车的项目改名后安装",
    renameHint: "自动加上 -2、-3 等后缀。已有内容原封不动。",
    warningsTitle: "需要留意",
    targetFolder: "安装到文件夹",
    targetFolderHint: "会为该软件包新建一个文件夹，默认用软件包自己的名字。",
    autoMerge: "跳过评审，直接安装",
    autoMergeBody:
      "默认情况下，软件包的内容会先变成变更请求，等你读过之后才会生效。跳过这一步意味着你信任作者：软件包里可以带有 Skill 和 AirApp，那是本空间的 Agent 会真正执行的代码。",
    autoMergeRequiredTitle: "该软件包只能跳过评审安装",
    autoMergeRequiredBody:
      "它的记录之间互相关联，而关联只能指向已经存在的记录。如果先挂起评审，所有关联都会是空的——所以这些记录必须立即创建。安装前请先在 GitHub 上读一遍：装上之后，作者的 Skill 和 AirApp 就会在本空间里运行。",
    install: "安装",
    installing: "正在安装…",
    installingHint: "可能需要一点时间——每一项都是逐个创建的。",
    installFailed: "软件包安装失败。",
    resultTitle: "已安装到 {folder}",
    resultCounts:
      "{folders} 个文件夹 · {bases} 个数据库 · {views} 个视图 · {docs} 篇文档 · {records} 条记录 · {files} 个文件",
    pendingTitle: "有 {count} 个变更请求等你处理",
    pendingBody: "软件包的内容只是被提议，还没有生效。你评审并合并之前，它不会进入你的空间。",
    reviewNow: "现在去评审",
    noPending: "全部已合并——软件包已在你的空间中生效。",
    done: "完成",
  },
  settings: {
    language: "语言",
    languageHint: "更改应用界面语言。",
    auto: "跟随系统",
  },
};

export const messagesByLocale = {
  en,
  "zh-CN": zhCN,
} as const;

export type Locale = keyof typeof messagesByLocale;

export const localeOptions: Array<{ code: Locale; label: string }> = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
];

/**
 * Interpolate `{token}` placeholders in a catalog string.
 *
 * Lives HERE rather than in `./index.tsx` (which re-exports it, so every
 * existing `import { fmt } from "~/i18n"` is unchanged) because this module is
 * pure: `index.tsx` pulls in react-native, whose Flow-typed source cannot be
 * parsed by the node-environment Vitest runner. Keeping `fmt` on the pure side
 * lets logic modules that only format catalog strings stay unit-testable.
 */
export function fmt(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in tokens ? String(tokens[key]) : match,
  );
}
