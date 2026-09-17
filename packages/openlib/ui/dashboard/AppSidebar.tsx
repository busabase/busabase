"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "kui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "kui/sidebar";
import { Skeleton } from "kui/skeleton";
import Image from "next/image";
import type * as React from "react";
import { NavMain } from "./NavMain";
import { NavUser } from "./NavUser";
import { SpaceSelector } from "./SpaceSelector";
import type {
  AppBranding,
  NavGroup,
  NavMainLabels,
  NavUserLabels,
  Space,
  UserData,
  UserMenuItem,
} from "./types";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  navMain?: NavGroup[];
  navMainLabels?: NavMainLabels;
  mobileSidebarLabels?: { title: string; description: string };
  spaces?: Space[];
  activeSpace?: Space;
  onSpaceChange?: (space: Space) => void;
  onAddSpace?: () => void;
  onSpaceSettingsClick?: () => void;
  onInviteMembersClick?: () => void;
  spaceSelectorReadonly?: boolean;
  spaceSelectorExtraMenuItems?: React.ReactNode;
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
  userMenuLabels?: NavUserLabels;
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

// KUI's mobile Sidebar fixes its accessible title and description in English.
function SidebarFrame({
  children,
  mobileSidebarLabels,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  mobileSidebarLabels?: { title: string; description: string };
}) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  if (!isMobile || !mobileSidebarLabels) {
    return <Sidebar {...props}>{children}</Sidebar>;
  }

  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        data-sidebar="sidebar"
        data-mobile="true"
        className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
        side={props.side ?? "left"}
        style={{ "--sidebar-width": "18rem" } as React.CSSProperties}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{mobileSidebarLabels.title}</SheetTitle>
          <SheetDescription>{mobileSidebarLabels.description}</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function AppSidebar({
  navMain,
  navMainLabels,
  mobileSidebarLabels,
  spaces,
  activeSpace,
  onSpaceChange,
  onAddSpace,
  onSpaceSettingsClick,
  onInviteMembersClick,
  spaceSelectorReadonly,
  spaceSelectorExtraMenuItems,
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
    <SidebarFrame collapsible="icon" mobileSidebarLabels={mobileSidebarLabels} {...props}>
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
            extraMenuItems={spaceSelectorExtraMenuItems}
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
            labels={navMainLabels}
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
    </SidebarFrame>
  );
}
