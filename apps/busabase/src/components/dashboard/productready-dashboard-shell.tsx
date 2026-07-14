"use client";

import type { NodeVO } from "busabase-contract/types";
import { BusabaseAgentSkillButton } from "busabase-core/dashboard/agent-skill-button";
import {
  type BusabaseDashboardChrome,
  BusabaseDashboardShell as CoreDashboardShell,
} from "busabase-core/dashboard/dashboard-shell";
import type { MoveNodePayload } from "busabase-core/dashboard/use-move-node";
import { useCoreI18n } from "busabase-core/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Archive, ChevronsUpDown, Images, Network, Settings } from "lucide-react";
import Image from "next/image";
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
 * login here, so the chrome is a single fixed local workspace: the user menu is
 * hidden and the space-selector header is replaced by the Busabase logo. Keep the
 * footer quiet so no floating control competes with review work.
 */
export function ProductReadyDashboardShell({
  activeChangeRequestCount,
  children,
  nodes,
  onSearchClick,
  onCreateClick,
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
    onAddSpace: () => undefined,
    onInviteMembersClick: () => undefined,
    onNotificationClick: () => undefined,
    onSignOut: () => undefined,
    onSpaceChange: () => undefined,
    onSpaceSettingsClick: () => undefined,
    sidebarHeader: (
      <div className="flex flex-col gap-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="min-h-10 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1"
                  tooltip="Busabase"
                >
                  <Image
                    src={BUSABASE_LOGO}
                    alt="Busabase"
                    width={28}
                    height={28}
                    className="size-7 shrink-0 object-contain opacity-90 dark:invert"
                  />
                  <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">Busabase</span>
                      <span className="shrink-0 rounded-[4px] border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-sidebar-foreground/80">
                        {LL.shell.localPlan()}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground opacity-70">
                      {LL.shell.approvalFirstKb()}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex min-w-0 items-center gap-2">
                    <Image
                      src={BUSABASE_LOGO}
                      alt="Busabase"
                      width={24}
                      height={24}
                      className="size-6 shrink-0 object-contain opacity-90 dark:invert"
                    />
                    <div className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate text-sm font-medium">Busabase</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {LL.shell.approvalFirstKb()}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
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
                <DropdownMenuItem
                  onSelect={() => navigate(addDemoParam("/graph"))}
                  className={currentPath === "/graph" ? "bg-accent" : undefined}
                >
                  <Network />
                  <span>{LL.shell.graphView()}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSettingsDialogOpen(true)}>
                  <Settings />
                  <span>{LL.shell.settings()}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
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
      </div>
    ),
    spaceSelectorLabels: {
      addSpace: LL.shell.addWorkspace(),
      inviteMembers: LL.shell.inviteMembers(),
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
    <CoreDashboardShell
      activeChangeRequestCount={activeChangeRequestCount}
      chrome={chrome}
      hiddenNavItems={["assets"]}
      locale={locale}
      nodes={nodes}
      onCreateClick={onCreateClick}
      onMoveNode={onMoveNode}
      onSearchClick={onSearchClick}
      pinnedNavItems={["activity"]}
      loadingNodeIds={loadingNodeIds}
      onExpandNode={onExpandNode}
      checkIsDescendant={checkIsDescendant}
    >
      {children}
    </CoreDashboardShell>
  );
}
