"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { BusabaseAgentSkillButton } from "busabase-core/dashboard/agent-skill-button";
import {
  type BusabaseDashboardChrome,
  BusabaseDashboardShell as CoreDashboardShell,
} from "busabase-core/dashboard/dashboard-shell";
import type { MoveNodePayload } from "busabase-core/dashboard/use-move-node";
import { useCoreI18n } from "busabase-core/i18n";
import { DropdownMenuItem, DropdownMenuSeparator } from "kui/dropdown-menu";
import { Activity, Archive, Github, Images, Inbox, Network } from "lucide-react";
import { useAddDemoParam } from "openlib/ui/dashboard";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSPA } from "~/components/spa/spa-context";
import { SettingsDialog } from "~/domains/settings/components/settings-dialog";
import { useAppBranding } from "~/domains/settings/hooks/use-app-branding";
import { getLanguageOptions } from "~/i18n/config";
import { getBusabaseAppLL } from "~/lib/i18n";

const BUSABASE_LOGO = "/icon.svg";

interface BusabaseDashboardShellProps {
  children: ReactNode;
  activeChangeRequestCount: number;
  nodes: NodeVO[];
  onSearchClick: () => void;
  onCreateClick: (parent?: { id: string; name: string }) => void;
  /** Opens the "Install from GitHub" dialog from the local workspace menu. */
  onInstallClick?: () => void;
  /** oRPC query utils — forwarded to the core shell to power the sidebar "•••" → Permissions entry. */
  orpc?: BusabaseQueryUtils;
  /** Wires up sidebar drag-and-drop and the "Move to…" dialog; omit to leave the tree read-only. */
  onMoveNode?: (
    payload: MoveNodePayload,
    options?: { onSuccess?: () => void; onError?: () => void },
  ) => void;
  /** Resolved active locale (drives sidebar/content i18n). */
  locale: string;
  /** Saved preference shown in the switcher — `"auto"` or a concrete locale. */
  languagePref: string;
  onLocaleChange: (locale: string) => void;
  /** Ids of nodes whose children are currently being lazy-fetched. */
  loadingNodeIds?: Set<string>;
  /** Fired when a depth-boundary folder is expanded for the first time. */
  onExpandNode?: (nodeId: string) => void;
  /** Server-authoritative descendant check, gates cross-branch drag-and-drop drops. */
  checkIsDescendant?: (params: { nodeId: string; potentialAncestorId: string }) => Promise<boolean>;
}

/**
 * Open-source adapter for the shared `busabase-core` workbench shell. There is no
 * login here, so the chrome is a single fixed local workspace. It still uses the
 * shared Space Selector so workspace identity and plan read exactly like Cloud;
 * only account and multi-workspace actions are inert.
 */
export function BusabaseDashboardShell({
  activeChangeRequestCount,
  children,
  nodes,
  onSearchClick,
  onCreateClick,
  onInstallClick,
  orpc,
  onMoveNode,
  locale,
  languagePref,
  onLocaleChange,
  loadingNodeIds,
  onExpandNode,
  checkIsDescendant,
}: BusabaseDashboardShellProps) {
  const { activeSpace, spaces, unreadCount, user } = useSPA();
  const [location, navigate] = useLocation();
  const addDemoParam = useAddDemoParam();
  const LL = useMemo(() => getBusabaseAppLL(locale), [locale]);
  const coreMessages = useCoreI18n();
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const currentPath = location.split("?")[0];
  const branding = useAppBranding();
  const languageOptions = useMemo(
    () => getLanguageOptions(locale === "zh-CN" || locale === "ja" ? locale : "en"),
    [locale],
  );

  // Built-in defaults — also what the Branding settings tab shows as placeholders.
  const brandingDefaults = {
    name: LL.shell.localSpaceName(),
    description: LL.shell.approvalFirstKb(),
    logoUrl: BUSABASE_LOGO,
  };
  // A white-labelled instance overrides the top-left slot's name/description/logo.
  // Everything else (the workspace dropdown with Inbox/Activity/Settings/…) is
  // deliberately left intact, so nothing becomes unreachable after branding.
  const brandedLogo = branding?.logoUrl || BUSABASE_LOGO;
  const brandedName = branding?.name || activeSpace.name;
  const brandedDescription = branding?.description
    ? branding.description
    : branding?.name || branding?.logoUrl
      ? brandingDefaults.description
      : undefined;

  const chrome: BusabaseDashboardChrome = {
    activeSpace: {
      id: activeSpace.id,
      logo: brandedLogo,
      name: brandedName,
      plan: LL.shell.localPlan(),
      description: brandedDescription,
    },
    appLogo: brandedLogo,
    footerExtra: (
      <BusabaseAgentSkillButton
        defaultOrigin="http://localhost:15419"
        edition="desktop"
        lang={locale}
      />
    ),
    hideUserMenu: true,
    isLoadingSpaces: false,
    spaces: spaces.map((space) => ({
      id: space.id,
      logo: brandedLogo,
      name: space.id === activeSpace.id ? brandedName : space.name,
      plan: LL.shell.localPlan(),
    })),
    unreadCount,
    user: { avatar: user.avatar, email: user.email, name: user.name },
    onAccountClick: () => undefined,
    onNotificationClick: () => undefined,
    onSignOut: () => undefined,
    onSpaceSettingsClick: () => setSettingsDialogOpen(true),
    // The workspace-wide destinations. Inbox/Activity live here rather than in
    // the sidebar so the resting sidebar is just Home + Search + the node tree;
    // opening one surfaces it as the shell's single contextual sidebar row.
    spaceSelectorExtraMenuItems: (
      <>
        <DropdownMenuItem
          onSelect={() => navigate(addDemoParam("/inbox"))}
          className={currentPath.startsWith("/inbox") ? "bg-accent" : undefined}
        >
          <Inbox />
          <span>{coreMessages.nav.inbox}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate(addDemoParam("/activity"))}
          className={currentPath === "/activity" ? "bg-accent" : undefined}
        >
          <Activity />
          <span>{coreMessages.nav.activity}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate(addDemoParam("/archived"))}
          className={currentPath === "/archived" ? "bg-accent" : undefined}
        >
          <Archive />
          <span>{coreMessages.nav.archive}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => navigate(addDemoParam("/assets"))}
          className={currentPath.startsWith("/assets") ? "bg-accent" : undefined}
        >
          <Images />
          <span>{coreMessages.nav.assets}</span>
        </DropdownMenuItem>
        {onInstallClick ? (
          <DropdownMenuItem onSelect={onInstallClick}>
            <Github />
            <span>{coreMessages.nav.installFromGithub}</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onSelect={() => navigate(addDemoParam("/graph"))}
          className={currentPath === "/graph" ? "bg-accent" : undefined}
        >
          <Network />
          <span>{LL.shell.graphView()}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </>
    ),
    spaceSelectorLabels: {
      settings: LL.shell.settings(),
      spaces: LL.shell.workspaces(),
    },
    userMenuLabels: {
      accountSettings: LL.shell.accountSettings(),
      logOut: LL.shell.logOut(),
      notifications: LL.shell.notifications(),
    },
  };

  return (
    <>
      <CoreDashboardShell
        activeChangeRequestCount={activeChangeRequestCount}
        chrome={chrome}
        locale={locale}
        nodes={nodes}
        orpc={orpc}
        onCreateClick={onCreateClick}
        onMoveNode={onMoveNode}
        onSearchClick={onSearchClick}
        loadingNodeIds={loadingNodeIds}
        onExpandNode={onExpandNode}
        checkIsDescendant={checkIsDescendant}
      >
        {children}
      </CoreDashboardShell>
      <SettingsDialog
        labels={LL.settingsDialog}
        vaultLabels={LL.vaultSettings}
        webhookLabels={LL.webhookSettings}
        cloudConnectLabels={LL.cloudConnect}
        brandingLabels={LL.appBranding}
        brandingDefaults={brandingDefaults}
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        languageOptions={languageOptions}
        languagePref={languagePref}
        onLocaleChange={onLocaleChange}
      />
    </>
  );
}
