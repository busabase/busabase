"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "kui/sidebar";
import { Skeleton } from "kui/skeleton";
import Image from "next/image";
import type * as React from "react";
import { NavMain } from "./NavMain";
import { NavUser } from "./NavUser";
import { SpaceSelector } from "./SpaceSelector";
import type { AppBranding, NavGroup, Space, UserData, UserMenuItem } from "./types";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  navMain?: NavGroup[];
  spaces?: Space[];
  activeSpace?: Space;
  onSpaceChange?: (space: Space) => void;
  onAddSpace?: () => void;
  onSpaceSettingsClick?: () => void;
  onInviteMembersClick?: () => void;
  spaceSelectorReadonly?: boolean;
  isLoadingSpaces?: boolean;
  /**
   * App branding configuration displayed when no spaces are available
   */
  branding?: AppBranding;
  /**
   * App logo image URL for SpaceSelector (replaces Lucide icon)
   */
  appLogo?: string;
  user: UserData;
  onSignOut: () => void;
  onAccountClick?: () => void;
  onNotificationClick?: () => void;
  unreadCount?: number;
  extraContent?: React.ReactNode;
  footerExtra?: React.ReactNode;
  /**
   * Hide the account/user dropdown in deployments that do not have user identity.
   */
  hideUserMenu?: boolean;
  /**
   * Callback when a navigation group's header action button is clicked
   */
  onHeaderActionClick?: (groupLabel: string) => void;
  /**
   * Callback when a nav item with an action property is clicked
   */
  onNavItemAction?: (action: string) => void;
  /**
   * Additional menu items for user dropdown
   */
  userMenuItems?: UserMenuItem[];
  /**
   * Labels for SpaceSelector i18n support
   */
  spaceSelectorLabels?: {
    spaces?: string;
    settings?: string;
    inviteMembers?: string;
    addSpace?: string;
    focusMode?: string;
  };
  /**
   * Called when the user clicks the "enter agent focus mode" button in the SpaceSelector dropdown.
   */
  onSpaceSelectorFocusMode?: () => void;
  /**
   * Labels for NavUser i18n support
   */
  userMenuLabels?: {
    accountSettings?: string;
    notifications?: string;
    logOut?: string;
  };
  /**
   * Whether the task list is expanded (showing all tasks with scroll)
   */
  isTaskListExpanded?: boolean;
  /**
   * Callback when task list expand/collapse is toggled
   */
  onTaskListExpandToggle?: () => void;
  /**
   * Custom content for SidebarHeader — replaces SpaceSelector/branding when provided.
   * Use this to inject a custom selector (e.g. AgentSelector) in the top-left slot.
   */
  sidebarHeader?: React.ReactNode;
}

export function AppSidebar({
  navMain,
  spaces,
  activeSpace,
  onSpaceChange,
  onAddSpace,
  onSpaceSettingsClick,
  onInviteMembersClick,
  spaceSelectorReadonly,
  isLoadingSpaces,
  branding,
  appLogo,
  user,
  onSignOut,
  onAccountClick,
  onNotificationClick,
  unreadCount,
  extraContent,
  footerExtra,
  hideUserMenu,
  onHeaderActionClick,
  onNavItemAction,
  userMenuItems,
  spaceSelectorLabels,
  userMenuLabels,
  isTaskListExpanded,
  onTaskListExpandToggle,
  sidebarHeader,
  onSpaceSelectorFocusMode,
  ...props
}: AppSidebarProps) {
  const hasSpaces = spaces && spaces.length > 0;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="py-2">
        {sidebarHeader ? (
          sidebarHeader
        ) : branding ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" className="data-[slot=sidebar-menu-button]:!p-2">
                <a href={branding.href ?? "#"}>
                  <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Image
                      src={branding.logo}
                      alt={branding.name}
                      width={20}
                      height={20}
                      className="size-5"
                    />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{branding.name}</span>
                    {branding.description && (
                      <span className="truncate text-xs text-muted-foreground opacity-70">
                        {branding.description}
                      </span>
                    )}
                  </div>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : isLoadingSpaces ? (
          <div className="flex items-center gap-2 px-2 py-2">
            <Skeleton className="size-8 rounded-lg" />
            <div className="flex-1 space-y-1.5 group-data-[collapsible=icon]:hidden">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ) : hasSpaces ? (
          <SpaceSelector
            spaces={spaces}
            activeSpace={activeSpace}
            onSpaceChange={onSpaceChange}
            onAddSpace={onAddSpace}
            onSettingsClick={onSpaceSettingsClick}
            onInviteMembersClick={onInviteMembersClick}
            onFocusMode={onSpaceSelectorFocusMode}
            readonly={spaceSelectorReadonly}
            labels={spaceSelectorLabels}
            appLogo={appLogo}
          />
        ) : null}
      </SidebarHeader>
      <SidebarContent
        className={
          isTaskListExpanded
            ? "overflow-hidden flex flex-col gap-0 py-0 [&>[data-sidebar=group]]:px-2 [&>[data-sidebar=group]]:py-1"
            : "flex flex-col gap-0 py-0 [&>[data-sidebar=group]]:px-2 [&>[data-sidebar=group]]:py-1"
        }
      >
        {navMain && (
          <NavMain
            items={navMain}
            onHeaderActionClick={onHeaderActionClick}
            onNavItemAction={onNavItemAction}
            isTaskListExpanded={isTaskListExpanded}
            onTaskListExpandToggle={onTaskListExpandToggle}
          />
        )}
        {extraContent}
      </SidebarContent>
      {(footerExtra || !hideUserMenu) && (
        <SidebarFooter className="py-2 mt-auto">
          {footerExtra}
          {!hideUserMenu && (
            <NavUser
              user={user}
              onSignOut={onSignOut}
              unreadCount={unreadCount}
              onAccountClick={onAccountClick}
              onNotificationClick={onNotificationClick}
              extraMenuItems={userMenuItems}
              labels={userMenuLabels}
            />
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
