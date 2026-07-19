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
import {
  BadgeCheck,
  Bell,
  Check,
  ChevronsUpDown,
  ExternalLink,
  Loader2,
  LogOut,
  Plus,
  Users,
} from "lucide-react";
import { AvatarLogo } from "../avatar-logo";
import { useAccountSwitcherContext } from "./account-switcher-context";
import type { NavUserLabels, SwitchableAccountView, UserData, UserMenuItem } from "./types";

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
  /**
   * Accounts signed in on this device. Omit (or pass <2 entries) and the menu
   * renders exactly as it did before account switching existed — the switcher
   * and the split sign-out only appear once there is something to switch to.
   */
  accounts?: SwitchableAccountView[];
  onSwitchAccount?: (sessionToken: string) => void;
  /** Shown whenever provided, even for a single account. */
  onAddAccount?: () => void;
  /** Revokes every account on the device. Only rendered alongside `accounts`. */
  onSignOutAll?: () => void;
  /** Session token currently being switched to — renders a spinner on that row. */
  switchingTo?: string | null;
  /** At `maximumSessions`: adding another would silently not be listed, so the
   *  entry is disabled and explained instead. */
  isAccountsFull?: boolean;
  /** Labels for i18n support */
  labels?: NavUserLabels;
}

export function NavUser({
  user,
  onSignOut,
  unreadCount = 0,
  onAccountClick,
  onNotificationClick,
  extraMenuItems,
  compact = false,
  accounts: accountsProp,
  onSwitchAccount: onSwitchAccountProp,
  onAddAccount: onAddAccountProp,
  onSignOutAll: onSignOutAllProp,
  switchingTo: switchingToProp,
  isAccountsFull: isAccountsFullProp,
  labels,
}: NavUserProps) {
  const { isMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";

  // NavUser renders from several sidebars per app; the context lets the app
  // provide the switcher once instead of threading it through each of them.
  // Explicit props still win, so a caller that already passes them (or a test)
  // needs no provider.
  const ctx = useAccountSwitcherContext();
  const accounts = accountsProp ?? ctx?.accounts;
  const onSwitchAccount = onSwitchAccountProp ?? ctx?.switchTo;
  const onAddAccount = onAddAccountProp ?? ctx?.onAddAccount;
  const onSignOutAll = onSignOutAllProp ?? ctx?.signOutAll;
  const switchingTo = switchingToProp ?? ctx?.switchingTo ?? null;
  const isAccountsFull = isAccountsFullProp ?? ctx?.isFull ?? false;
  // Most callers' `onSignOut` is the app's raw `authClient.signOut()`, which
  // revokes *every* signed-in account. Once the switcher is mounted, prefer its
  // single-account revoke so "Log out" means what it says.
  const handleSignOut = ctx?.signOutCurrent ?? onSignOut;

  // Only a second account makes "switching" and "which one am I?" meaningful.
  const hasMultipleAccounts = (accounts?.length ?? 0) > 1;

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
            // The account rows make this menu grow: at the 5-account cap it is
            // already ~600px, which does not fit a short laptop viewport, and
            // raising `maximumSessions` would grow it without bound. Radix
            // measures the space left to the viewport edge for us; cap to that
            // and scroll, so the menu fits any screen at any account count.
            className="flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-[--radix-dropdown-menu-trigger-width] min-w-56 flex-col overflow-y-auto rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            collisionPadding={8}
          >
            {hasMultipleAccounts ? (
              // Which account is active must be unambiguous without opening a
              // submenu — mis-acting as the wrong account is the real risk of
              // multi-account, not slow switching.
              <DropdownMenuGroup>
                {accounts?.map((account) => (
                  <DropdownMenuItem
                    key={account.sessionToken}
                    onSelect={(event) => {
                      if (account.isActive) return;
                      // Keep the menu open so the spinner is visible.
                      event.preventDefault();
                      onSwitchAccount?.(account.sessionToken);
                    }}
                    className={`gap-2 ${account.isActive ? "bg-accent" : ""}`}
                    aria-current={account.isActive ? "true" : undefined}
                  >
                    <AvatarLogo
                      src={account.image ?? undefined}
                      fallback={account.name}
                      size="sm"
                      className={account.isActive ? "" : "opacity-60"}
                    />
                    <div className="grid min-w-0 flex-1 text-left leading-tight">
                      <span
                        className={`truncate text-sm ${account.isActive ? "font-medium" : "font-normal text-muted-foreground"}`}
                      >
                        {account.name}
                      </span>
                      <span className="truncate text-muted-foreground text-xs">
                        {account.email}
                      </span>
                    </div>
                    {switchingTo === account.sessionToken ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    ) : account.isActive ? (
                      <Check className="size-4 shrink-0" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : (
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <AvatarLogo src={user.avatar} fallback={user.name} size="sm" />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            )}
            {onAddAccount && (
              <DropdownMenuItem
                onClick={isAccountsFull ? undefined : onAddAccount}
                disabled={isAccountsFull}
                className="gap-2"
              >
                {isAccountsFull ? <Users className="size-4" /> : <Plus className="size-4" />}
                <span className="truncate">
                  {isAccountsFull
                    ? (labels?.accountsFull ?? "Account limit reached")
                    : (labels?.addAccount ?? "Add account")}
                </span>
              </DropdownMenuItem>
            )}
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
            {hasMultipleAccounts && onSignOutAll ? (
              // `signOut()` revokes every account at once. With more than one
              // signed in, a bare "Log out" would silently take them all down,
              // so the two outcomes are named separately and the
              // least-destructive one comes first.
              <>
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut />
                  {labels?.logOutCurrent ?? "Log out current account"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSignOutAll}>
                  <LogOut />
                  <span className="truncate">{labels?.logOutAll ?? "Log out of all accounts"}</span>
                  <span className="ml-auto text-muted-foreground text-xs">{accounts?.length}</span>
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut />
                {labels?.logOut ?? "Log out"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
