"use client";

import type { NodeVO } from "busabase-contract/types";
import { AgentIntegrationDialog } from "busabase-core/dashboard/agent-skill-button";
import {
  type BusabaseDashboardChrome,
  BusabaseDashboardShell as CoreDashboardShell,
} from "busabase-core/dashboard/dashboard-shell";
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
import { Check, ChevronsUpDown, Languages, Network, Sparkles, Variable } from "lucide-react";
import Image from "next/image";
import { useAddDemoParam } from "openlib/ui/dashboard";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSPA } from "~/components/spa/spa-context";
import { UserEnvSettingsDialog } from "~/domains/user-env/components/user-env-settings-dialog";
import { getLanguageOptions } from "~/i18n/config";
import { getBusabaseAppLL } from "~/lib/i18n";

const BUSABASE_LOGO = "/icon.svg";

interface ProductReadyDashboardShellProps {
  children: ReactNode;
  activeChangeRequestCount: number;
  nodes: NodeVO[];
  onSearchClick: () => void;
  onCreateClick: (parent?: { id: string; name: string }) => void;
  /** Resolved active locale (drives sidebar/content i18n). */
  locale: string;
  /** Saved preference shown in the switcher — `"auto"` or a concrete locale. */
  languagePref: string;
  onLocaleChange: (locale: string) => void;
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
  locale,
  languagePref,
  onLocaleChange,
}: ProductReadyDashboardShellProps) {
  const { activeSpace, spaces, unreadCount, user } = useSPA();
  const [location, navigate] = useLocation();
  const addDemoParam = useAddDemoParam();
  const LL = useMemo(() => getBusabaseAppLL(locale), [locale]);
  const coreMessages = useCoreI18n();
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const languageOptions = useMemo(
    () => [
      { code: "auto", name: LL.shell.auto(), nativeName: LL.shell.auto() },
      ...getLanguageOptions(locale === "zh-CN" || locale === "ja" ? locale : "en"),
    ],
    [LL, locale],
  );

  const chrome: BusabaseDashboardChrome = {
    activeSpace: {
      id: activeSpace.id,
      logo: BUSABASE_LOGO,
      name: activeSpace.name,
      plan: LL.shell.localPlan(),
    },
    footerExtra: (
      <div className="flex flex-col gap-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className="mx-2 w-[calc(100%-1rem)] data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center"
                  tooltip={LL.shell.localSpaceName()}
                >
                  <Image
                    src={BUSABASE_LOGO}
                    alt="Busabase"
                    width={20}
                    height={20}
                    className="size-5 shrink-0 object-contain opacity-90 dark:invert"
                  />
                  <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">
                      {LL.shell.localSpaceName()}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {LL.shell.localReviewerName()}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="right"
                sideOffset={8}
                className="w-64 rounded-lg"
              >
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
                      <span className="truncate text-sm font-medium">
                        {LL.shell.localSpaceName()}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {LL.shell.approvalFirstKb()}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => navigate(addDemoParam("/graph"))}
                  className={location.split("?")[0] === "/graph" ? "bg-accent" : undefined}
                >
                  <Network />
                  <span>{LL.shell.graphView()}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAgentDialogOpen(true)}>
                  <Sparkles />
                  <span>{coreMessages.integration.agentSkills}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEnvDialogOpen(true)}>
                  <Variable />
                  <span>{LL.userEnvSettings.openButton()}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Languages className="size-3.5" />
                  {LL.shell.settings()}
                </DropdownMenuLabel>
                {languageOptions.map((option) => {
                  const isActive = option.code === languagePref;
                  return (
                    <DropdownMenuItem
                      key={option.code}
                      onSelect={() => onLocaleChange(option.code)}
                      className={isActive ? "bg-accent" : undefined}
                    >
                      <span>{option.nativeName || option.name}</span>
                      {isActive ? <Check className="ml-auto size-4" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <AgentIntegrationDialog
          defaultOrigin="http://localhost:15419"
          lang={locale}
          open={agentDialogOpen}
          onOpenChange={setAgentDialogOpen}
        />
        <UserEnvSettingsDialog
          labels={LL.userEnvSettings}
          open={envDialogOpen}
          onOpenChange={setEnvDialogOpen}
          showTrigger={false}
        />
      </div>
    ),
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
      <a
        href="/dashboard"
        className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1"
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
      </a>
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
      locale={locale}
      nodes={nodes}
      onCreateClick={onCreateClick}
      onSearchClick={onSearchClick}
    >
      {children}
    </CoreDashboardShell>
  );
}
