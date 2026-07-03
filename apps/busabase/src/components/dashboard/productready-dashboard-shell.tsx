"use client";

import type { NodeVO } from "busabase-contract/types";
import { BusabaseAgentSkillButton } from "busabase-core/dashboard/agent-skill-button";
import {
  type BusabaseDashboardChrome,
  BusabaseDashboardShell as CoreDashboardShell,
} from "busabase-core/dashboard/dashboard-shell";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Network } from "lucide-react";
import Image from "next/image";
import { useAddDemoParam } from "openlib/ui/dashboard";
import { LanguageSwitcher } from "openlib/ui/LanguageSwitcher";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { useSPA } from "~/components/spa/spa-context";
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
            <SidebarMenuButton
              className="mx-2 w-[calc(100%-1rem)]"
              isActive={location.split("?")[0] === "/graph"}
              onClick={() => navigate(addDemoParam("/graph"))}
              tooltip={LL.shell.graphView()}
            >
              <Network />
              <span>{LL.shell.graphView()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <BusabaseAgentSkillButton defaultOrigin="http://localhost:15419" lang={locale} />
        <div className="px-2 group-data-[collapsible=icon]:hidden">
          <LanguageSwitcher
            className="w-full justify-start"
            currentLang={languagePref}
            languages={languageOptions}
            mode="with-text"
            onLanguageChange={onLocaleChange}
          />
        </div>
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
          <span className="truncate font-medium">Busabase</span>
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
