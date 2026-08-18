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
    archived: "Trash",
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
  workspaceSelector: {
    demoWorkspace: "Demo workspace",
    selfHostedWorkspace: "Self-hosted workspace",
    loadError: "Could not load workspaces.",
    loadingWorkspaces: "Loading workspaces",
    noWorkspaces: "No workspaces",
    reconnectHint: "Refresh or reconnect to Busabase Cloud.",
    refreshing: "Refreshing...",
    refresh: "Refresh workspaces",
    closeMenu: "Close workspace menu",
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
    title: "Trash",
    subtitle: "Restore or delete forever",
    empty: "Trash is empty",
    emptyHint: "Archived items appear here.",
    basesSection: "Bases",
    nodesSection: "Folders · Docs · Skills",
    restoreHint: "Tap row to restore",
    restoreConfirm: 'Create a restore change request for "{name}"?',
    purgeTitle: "Delete forever",
    purgeConfirm: 'Permanently delete "{name}"? This cannot be undone.',
  },
  createNode: {
    // `{suffix}` is empty at the space root and becomes `parentSuffix` when the
    // sheet was opened from a folder — same two-part title as web's dialog.
    title: "Create{suffix}",
    parentSuffix: " in {name}",
    typeLabel: "Type",
    name: "Name",
    slug: "Slug",
    description: "Description (optional)",
    reviewNote: "Creates a change request for review. It appears after the request is merged.",
    reviewNoteInParent:
      'Creates a change request for review. It appears inside "{name}" after the request is merged.',
    submit: "Create {type}",
    nameRequired: "Name is required.",
  },
  // Display names for node types, keyed by the registry's `type` id. The web
  // dialog renders the registry's own (English) `label`; mobile translates it,
  // so a type missing from this table falls back to that label rather than
  // disappearing — a newly registered creatable type still shows up.
  nodeTypeNames: {
    folder: "Folder",
    base: "Base",
    skill: "Skill",
    drive: "Drive",
    airapp: "AirApp",
    doc: "Doc",
    form: "Form",
    whiteboard: "Whiteboard",
    workflow: "Workflow",
    html: "HTML",
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
    // The touch stand-in for web's per-folder "+" button (`onAddChild`).
    createInside: "New inside…",
    expand: "Expand {name}",
    collapse: "Collapse {name}",
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
    accessRestrictedDefault: "Restricted — only granted members can see this",
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
    title: "Settings",
    connection: "Connection",
    demoWorkspace: "Demo workspace",
    selfHostedServer: "Self-hosted server",
    noServerConnected: "No server connected",
    connectServerHint: "Connect a Busabase server to review changes here.",
    connectAnotherServer: "Connect another server",
    workspace: "Workspace",
    accounts: "Accounts",
    savedAccount: "Saved account",
    cloudAccount: "Busabase Cloud account",
    working: "Working",
    active: "Active",
    accountLimitReached: "Account limit reached",
    addAnotherAccount: "Add another account",
    accountLimit: "Up to {count} accounts.",
    openingSignIn: "Opening sign in",
    accountActionFailed: "Account action failed",
    addAccountFailed: "Could not add this account.",
    switchAccountFailed: "Could not switch accounts.",
    removeAccountFailed: "Could not remove this account.",
    savedServers: "Saved servers",
    switching: "Switching",
    preferences: "Preferences",
    language: "Language",
    languageHint: "Changes the app interface language.",
    auto: "System default",
    notifications: "Notifications",
    newChangeRequests: "New change requests",
    disabledReviewBuild: "Disabled for this review build.",
    notifyAccessibility: "Notify about new change requests",
    openSystemSettings: "Open system settings",
    notificationsOff: "Notifications are turned off for this app in system settings.",
    checkEvery: "Check every",
    automation: "Automation",
    vault: "Vault",
    webhookRules: "Webhook Rules",
    agent: "Agent",
    agentSkillSetup: "Agent Skill setup",
    about: "About",
    checkForUpdates: "Check for updates",
    updateCheckFailed: "Could not check the latest version.",
    latestVersion: "Latest version v{version}",
    checking: "Checking",
    privacyPolicy: "Privacy Policy",
    termsOfService: "Terms of Service",
    support: "Support",
    dangerZone: "Danger zone",
    disconnectDevice: "Disconnect this device",
    cloudDisconnectHint:
      "Signs every saved account out of Busabase Cloud and clears secure sessions.",
    localDisconnectHint: "Clears the saved URL on this device. Saved servers stay available.",
    savedOnDevice: "Saved on this device",
    switchToAccount: "Switch to this account",
    removeFromDevice: "Remove from this device",
    savedServer: "Saved server",
    switchToServer: "Switch to this server",
    removeSavedServer: "Remove from saved servers",
    disconnectTitle: "Disconnect this device?",
    disconnect: "Disconnect",
  },
} as const;
