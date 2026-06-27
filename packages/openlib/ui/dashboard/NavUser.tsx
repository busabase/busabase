"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "kui/sidebar";
import { BadgeCheck, Bell, ChevronsUpDown, ExternalLink, LogOut } from "lucide-react";
import { AvatarLogo } from "../avatar-logo";
import type { UserData, UserMenuItem } from "./types";

interface NavUserProps {
  user: UserData;
  onSignOut: () => void;
  unreadCount?: number;
  onAccountClick?: () => void;
  onNotificationClick?: () => void;
  /** Additional menu items to display before the sign out button */
  extraMenuItems?: UserMenuItem[];
  /** Use compact button size (md:h-8 md:p-0) */
  compact?: boolean;
  /** Labels for i18n support */
  labels?: {
    accountSettings?: string;
    notifications?: string;
    logOut?: string;
  };
}

export function NavUser({
  user,
  onSignOut,
  unreadCount = 0,
  onAccountClick,
  onNotificationClick,
  extraMenuItems,
  compact = false,
  labels,
}: NavUserProps) {
  const { isMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={`data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center ${compact ? "md:h-8 md:p-0" : ""}`}
            >
              <AvatarLogo
                src={user.avatar}
                fallback={user.name}
                size={isCollapsed ? "xs" : "sm"}
                className="shrink-0"
              />
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:!hidden">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:!hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <AvatarLogo src={user.avatar} fallback={user.name} size="sm" />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onAccountClick}>
                <BadgeCheck />
                {labels?.accountSettings ?? "Account Settings"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onNotificationClick}>
                <Bell />
                {labels?.notifications ?? "Notifications"}
                {unreadCount > 0 && (
                  <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                    {unreadCount}
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {extraMenuItems && extraMenuItems.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {extraMenuItems.map((item) => {
                    const shouldRenderLink = Boolean(item.href && !item.onClick);

                    return (
                      <DropdownMenuItem
                        key={item.href ?? item.label}
                        asChild={shouldRenderLink}
                        onClick={item.onClick}
                      >
                        {shouldRenderLink ? (
                          <a
                            href={item.href}
                            target={item.external ? "_blank" : undefined}
                            rel={item.external ? "noopener noreferrer" : undefined}
                          >
                            {item.icon && <item.icon className="size-4" />}
                            {item.label}
                            {item.external && (
                              <ExternalLink className="ml-auto size-3 opacity-50" />
                            )}
                          </a>
                        ) : (
                          <>
                            {item.icon && <item.icon className="size-4" />}
                            {item.label}
                            {item.external && (
                              <ExternalLink className="ml-auto size-3 opacity-50" />
                            )}
                          </>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut />
              {labels?.logOut ?? "Log out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
