import { Separator } from "kui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "kui/sidebar";
import { cn } from "kui/utils";
import type * as React from "react";
import { AppSidebar } from "./AppSidebar";
import type { AppBranding, NavGroup, NavUserLabels, Space, UserData, UserMenuItem } from "./types";

interface DashboardLayoutProps {
  children: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  defaultOpen?: boolean;
  navMain?: NavGroup[];
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
  sidebarExtra?: React.ReactNode;
  footerExtra?: React.ReactNode;
  /**
   * Hide the account/user dropdown in deployments that do not have user identity.
   */
  hideUserMenu?: boolean;
  /**
   * Custom content for the top-left SidebarHeader slot — replaces SpaceSelector/branding.
   */
  sidebarHeader?: React.ReactNode;
  className?: string;
  sidebarClassName?: string;
  pageClassName?: string;
  headerClassName?: string;
  /**
   * Suppress the built-in header SidebarTrigger. Set this when the page content
   * renders its own trigger (typically alongside collapsing this header to zero
   * height via `headerClassName`) — otherwise two overlapping toggle buttons render.
   */
  hideSidebarTrigger?: boolean;
  /**
   * Callback when a navigation group's header action button is clicked
   */
  onHeaderActionClick?: (groupLabel: string) => void;
  /**
   * Callback when a nav item with an action property is clicked
   */
  onNavItemAction?: (action: string) => void;
  /**
   * Additional content to render at the right side of the header bar
   */
  headerActions?: React.ReactNode;
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
   * Optional badge to display before breadcrumbs (e.g., "Multi-Space Mode")
   */
  headerBadge?: React.ReactNode;
  /**
   * Whether the task list is expanded (showing all tasks with scroll)
   */
  isTaskListExpanded?: boolean;
  /**
   * Callback when task list expand/collapse is toggled
   */
  onTaskListExpandToggle?: () => void;
}

export function DashboardLayout({
  children,
  breadcrumbs,
  defaultOpen = true,
  navMain,
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
  sidebarExtra,
  footerExtra,
  hideUserMenu,
  sidebarHeader,
  className,
  sidebarClassName,
  pageClassName,
  headerClassName,
  hideSidebarTrigger,
  onHeaderActionClick,
  onNavItemAction,
  headerActions,
  userMenuItems,
  spaceSelectorLabels,
  userMenuLabels,
  headerBadge,
  isTaskListExpanded,
  onTaskListExpandToggle,
  onSpaceSelectorFocusMode,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className={cn(
        // Override min-h-svh to h-full so the layout respects parent container height
        // This fixes issues when banners are present above the dashboard
        "!min-h-0 h-full",
        className,
      )}
    >
      <AppSidebar
        className={sidebarClassName}
        navMain={navMain}
        spaces={spaces}
        activeSpace={activeSpace}
        onSpaceChange={onSpaceChange}
        onAddSpace={onAddSpace}
        onSpaceSettingsClick={onSpaceSettingsClick}
        onInviteMembersClick={onInviteMembersClick}
        spaceSelectorReadonly={spaceSelectorReadonly}
        spaceSelectorExtraMenuItems={spaceSelectorExtraMenuItems}
        isLoadingSpaces={isLoadingSpaces}
        branding={branding}
        appLogo={appLogo}
        user={user}
        onSignOut={onSignOut}
        onAccountClick={onAccountClick}
        onNotificationClick={onNotificationClick}
        unreadCount={unreadCount}
        extraContent={sidebarExtra}
        footerExtra={footerExtra}
        hideUserMenu={hideUserMenu}
        sidebarHeader={sidebarHeader}
        onHeaderActionClick={onHeaderActionClick}
        onNavItemAction={onNavItemAction}
        userMenuItems={userMenuItems}
        spaceSelectorLabels={spaceSelectorLabels}
        userMenuLabels={userMenuLabels}
        isTaskListExpanded={isTaskListExpanded}
        onTaskListExpandToggle={onTaskListExpandToggle}
        onSpaceSelectorFocusMode={onSpaceSelectorFocusMode}
      />
      <SidebarInset className="!min-h-0 flex flex-col overflow-hidden">
        <header
          className={cn(
            "flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
            headerClassName,
          )}
        >
          <div className="flex items-center gap-2 px-6">
            {!hideSidebarTrigger && <SidebarTrigger className="-ml-1" />}
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            {headerBadge}
            {breadcrumbs}
          </div>
          {headerActions && (
            <div className="ml-auto flex items-center gap-2 px-6">{headerActions}</div>
          )}
        </header>
        <div className={cn("flex flex-1 flex-col gap-6 p-6 pt-0 overflow-y-auto", pageClassName)}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
