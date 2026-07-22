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
import { Archive, Github, Images, Network } from "lucide-react";
import { useAddDemoParam } from "openlib/ui/dashboard";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSPA } from "~/components/spa/spa-context";
import { SettingsDialog } from "~/domains/settings/components/settings-dialog";
import { getLanguageOptions } from "~/i18n/config";
import { getBusabaseAppLL } from "~/lib/i18n";

const BUSABASE_LOGO = "/icon.svg";

interface ProductReadyDashboardShellProps {
  children: ReactNode;
  activeChangeRequestCount: number;
  nodes: NodeVO[];
  onSearchClick: () => void;
  onCreateClick: (parent?: { id: string; name: string }) => void;
  /** Opens the "Install from GitHub" dialog from the local workspace menu. */
  onInstallClick?: () => void;
  /** oRPC query utils — forwarded to the core shell to power the sidebar "•••" → Permissions entry. */
  orpc?: BusabaseQueryUtils;
  /** Wires up sidebar drag-and-drop; omit to leave the tree read-only. */
  onMoveNode?: (payload: MoveNodePayload) => void;
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
export function ProductReadyDashboardShell({
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
}: ProductReadyDashboardShellProps) {
  const { activeSpace, spaces, unreadCount, user } = useSPA();
  const [location, navigate] = useLocation();
  const addDemoParam = useAddDemoParam();
  const LL = useMemo(() => getBusabaseAppLL(locale), [locale]);
  const coreMessages = useCoreI18n();
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const currentPath = location.split("?")[0];
  const languageOptions = useMemo(
    () => getLanguageOptions(locale === "zh-CN" || locale === "ja" ? locale : "en"),
    [locale],
  );

  const chrome: BusabaseDashboardChrome = {
    activeSpace: {
      id: activeSpace.id,
      logo: BUSABASE_LOGO,
      name: activeSpace.name,
      plan: LL.shell.localPlan(),
    },
    appLogo: BUSABASE_LOGO,
    footerExtra: <BusabaseAgentSkillButton defaultOrigin="http://localhost:15419" lang={locale} />,
    hideUserMenu: true,
    isLoadingSpaces: false,
    spaces: spaces.map((space) => ({
      id: space.id,
      logo: BUSABASE_LOGO,
      name: space.name,
      plan: LL.shell.localPlan(),
    })),
    unreadCount,
    user: { avatar: user.avatar, email: user.email, name: user.name },
    onAccountClick: () => undefined,
    onNotificationClick: () => undefined,
    onSignOut: () => undefined,
    onSpaceSettingsClick: () => setSettingsDialogOpen(true),
    spaceSelectorExtraMenuItems: (
      <>
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
        hiddenNavItems={["assets"]}
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
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        languageOptions={languageOptions}
        languagePref={languagePref}
        onLocaleChange={onLocaleChange}
      />
    </>
  );
}
