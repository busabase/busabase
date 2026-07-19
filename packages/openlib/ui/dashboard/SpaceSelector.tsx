"use client";

import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "kui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { cn } from "kui/utils";
import {
  Check,
  ChevronsUpDown,
  Cloud,
  Focus,
  Monitor,
  Plus,
  Settings,
  UserPlus,
} from "lucide-react";
import * as React from "react";
import { AvatarLogo } from "../avatar-logo";
import type { Space } from "./types";

/** Whether a space is a synthetic "remote space" (e.g. a connected tunnel). */
const isRemoteSpace = (space: Space): boolean => space.kind === "remote_tunnel";

/** Whether a remote space's connection is currently down — drives dimming. */
const isRemoteSpaceOffline = (space: Space): boolean =>
  isRemoteSpace(space) && space.online === false;

/**
 * Small Cloud/Local icon next to a space's name, so every space's type is
 * visible, not just the special one. Only shown when the current `spaces`
 * list actually contains a `kind: "remote_tunnel"` entry (e.g. busabase-cloud
 * with a connected Local ↔ Cloud Tunnel instance) — every other consumer of
 * `SpaceSelector` has no local/cloud distinction to show, so this stays
 * strictly additive there: a space list with no remote entries renders
 * byte-for-byte as it always has.
 */
function SpaceTypeBadge({ space, show }: { space: Space; show: boolean }) {
  if (!show) return null;
  const remote = isRemoteSpace(space);
  const offline = isRemoteSpaceOffline(space);
  const Icon = remote ? Monitor : Cloud;
  const label = remote ? (offline ? "Local (offline)" : "Local") : "Cloud";
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center",
              offline ? "text-muted-foreground/50" : "text-blue-600/80 dark:text-blue-400/80",
            )}
          >
            <Icon className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Helper to get plan badge styles based on plan type
// Minimal, refined design with subtle borders - Studio-Grade aesthetic
const getPlanBadgeStyle = (plan: string) => {
  const planLower = plan.toLowerCase().trim();

  // Free tier - most subtle (almost invisible)
  if (planLower === "free" || planLower === "免费版" || !planLower) {
    return "bg-transparent text-muted-foreground/50 border border-border/30";
  }

  // Plus/Starter tier - subtle neutral with refined border
  if (planLower === "plus" || planLower.includes("starter")) {
    return "bg-muted/30 text-muted-foreground/70 border border-border/40";
  }

  // Enterprise/Business tier - subtle purple with refined border
  if (
    planLower.includes("enterprise") ||
    planLower.includes("business") ||
    planLower.includes("scale")
  ) {
    return "bg-violet-500/8 text-violet-600/70 dark:text-violet-400/70 border border-violet-500/20";
  }

  // Pro/Growth/Premium tier - subtle gold with refined border
  if (planLower.includes("pro") || planLower.includes("growth") || planLower.includes("premium")) {
    return "bg-amber-500/8 text-amber-600/70 dark:text-amber-400/70 border border-amber-500/20";
  }

  // Default fallback - neutral styling
  return "bg-transparent text-muted-foreground/50 border border-border/30";
};

export interface SpaceSelectorProps {
  spaces: Space[];
  activeSpace?: Space;
  onSpaceChange?: (space: Space) => void;
  onAddSpace?: () => void;
  onSettingsClick?: () => void;
  onInviteMembersClick?: () => void;
  /** Called when user clicks the top-right "enter agent focus mode" button. */
  onFocusMode?: () => void;
  readonly?: boolean;
  /** Labels for i18n support */
  labels?: {
    spaces?: string;
    settings?: string;
    inviteMembers?: string;
    addSpace?: string;
    /** Tooltip for the focus-mode button (top-right of dropdown header). */
    focusMode?: string;
  };
  /** Use compact button size (md:h-8 md:p-0) */
  compact?: boolean;
  /** App logo image URL to use instead of Lucide icon */
  appLogo?: string;
  /** Optional workspace-level actions rendered before the spaces list. */
  extraMenuItems?: React.ReactNode;
}

const defaultLabels = {
  spaces: "Spaces",
  settings: "Settings",
  inviteMembers: "Invite members",
  addSpace: "Add space",
};

export function SpaceSelector({
  spaces,
  activeSpace,
  onSpaceChange,
  onAddSpace,
  onSettingsClick,
  onInviteMembersClick,
  onFocusMode,
  readonly = false,
  labels: customLabels,
  compact = false,
  appLogo,
  extraMenuItems,
}: SpaceSelectorProps) {
  const { isMobile, state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const avatarSize = compact || isCollapsed ? "xxs" : "sm";
  const labels = { ...defaultLabels, ...customLabels };
  // Only show the Cloud/Local type badge when the list actually has a
  // remote entry to distinguish from — see SpaceTypeBadge's doc comment.
  const hasRemoteSpace = spaces.some(isRemoteSpace);

  // Fallback to internal state if not controlled, or just use first space if activeSpace is undefined
  const [internalActiveSpace, setInternalActiveSpace] = React.useState(spaces[0]);

  // Control dropdown open state
  const [isOpen, setIsOpen] = React.useState(false);

  const currentSpace = activeSpace || internalActiveSpace;
  const logoSrc = currentSpace?.logo || appLogo;

  const handleSpaceChange = (space: (typeof spaces)[0]) => {
    setInternalActiveSpace(space);
    onSpaceChange?.(space);
    setIsOpen(false); // Close dropdown after space change
  };

  const handleSettingsClick = () => {
    setIsOpen(false); // Close dropdown before opening settings modal
    onSettingsClick?.();
  };

  const handleInviteMembersClick = () => {
    setIsOpen(false); // Close dropdown before opening invite modal
    onInviteMembersClick?.();
  };

  const handleAddSpace = () => {
    setIsOpen(false); // Close dropdown before opening add space modal
    onAddSpace?.();
  };

  if (!currentSpace) return null;

  if (readonly) {
    const logoSrc = currentSpace.logo || appLogo;

    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size={compact ? "default" : "lg"}
            className={cn(
              "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-default",
              "hover:bg-transparent hover:text-sidebar-foreground",
              compact ? "!p-1" : "group-data-[collapsible=icon]:!p-1",
              // Grow to fit the 2-line (line-clamp-2) name + plan badge instead of
              // clipping it inside the fixed button height. Icon-collapsed rail still
              // pins to 32px via the base `!size-8`.
              "h-auto",
              isRemoteSpaceOffline(currentSpace) && "opacity-60 grayscale",
            )}
          >
            <AvatarLogo src={logoSrc} fallback={currentSpace.name[0]} size={avatarSize} />
            <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:!hidden">
              <span
                className="flex items-center gap-1.5 break-words line-clamp-2 font-medium"
                title={currentSpace.name}
              >
                {currentSpace.name}
                <SpaceTypeBadge space={currentSpace} show={hasRemoteSpace} />
              </span>
              <span
                className={`inline-flex w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getPlanBadgeStyle(currentSpace.plan ?? "free")}`}
              >
                {currentSpace.plan ?? "Free"}
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size={compact ? "default" : "lg"}
              className={cn(
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
                compact ? "!p-1" : "group-data-[collapsible=icon]:!p-1",
                // Grow to fit the 2-line (line-clamp-2) name + plan badge instead of
                // clipping it inside the fixed button height. Icon-collapsed rail still
                // pins to 32px via the base `!size-8`.
                "h-auto",
                isRemoteSpaceOffline(currentSpace) && "opacity-60 grayscale",
              )}
            >
              <AvatarLogo src={logoSrc} fallback={currentSpace.name[0]} size={avatarSize} />
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:!hidden">
                <span
                  className="flex items-center gap-1.5 break-words line-clamp-2 font-medium"
                  title={currentSpace.name}
                >
                  {currentSpace.name}
                  <SpaceTypeBadge space={currentSpace} show={hasRemoteSpace} />
                </span>
                <span
                  className={`inline-flex w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${getPlanBadgeStyle(currentSpace.plan ?? "free")}`}
                >
                  {currentSpace.plan ?? "Free"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="flex max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-96 min-w-96 max-w-96 flex-col overflow-hidden rounded-lg p-0"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {/* Active Space Header */}
            <div
              className={cn(
                "shrink-0 p-3 pb-2",
                isRemoteSpaceOffline(currentSpace) && "opacity-60 grayscale",
              )}
            >
              <div className="flex items-center gap-3">
                <AvatarLogo src={logoSrc} fallback={currentSpace.name[0]} size="md" />
                <div className="min-w-0 flex-1">
                  <div
                    className="flex items-center gap-1.5 truncate font-medium"
                    title={currentSpace.name}
                  >
                    {currentSpace.name}
                    <SpaceTypeBadge space={currentSpace} show={hasRemoteSpace} />
                  </div>
                  <span
                    className={`mt-1 inline-flex w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${getPlanBadgeStyle(currentSpace.plan ?? "free")}`}
                  >
                    {currentSpace.plan ?? "Free"}
                  </span>
                </div>
                {onFocusMode && (
                  <div className="flex shrink-0 items-center gap-0.5 self-start">
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              onFocusMode();
                            }}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            <Focus className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {labels.focusMode ?? "Agent Focus Mode"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {(onSettingsClick || onInviteMembersClick) && (
                <div className="mt-3 flex gap-2">
                  {onSettingsClick && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      onClick={handleSettingsClick}
                    >
                      <Settings className="mr-1.5 size-3.5" />
                      {labels.settings}
                    </Button>
                  )}
                  {onInviteMembersClick && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 text-xs"
                      onClick={handleInviteMembersClick}
                    >
                      <UserPlus className="mr-1.5 size-3.5" />
                      {labels.inviteMembers}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {extraMenuItems && (
              <>
                <DropdownMenuSeparator className="my-0 shrink-0" />
                <div className="shrink-0 p-1">{extraMenuItems}</div>
              </>
            )}

            <DropdownMenuSeparator className="my-0 shrink-0" />

            {/* Spaces List */}
            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-1">
              <DropdownMenuLabel className="px-2 py-1.5 text-muted-foreground text-xs">
                {labels.spaces}
              </DropdownMenuLabel>
              {spaces.map((space) => {
                const isActive = space.id === currentSpace.id;
                return (
                  <DropdownMenuItem
                    key={space.id || space.name}
                    onClick={() => handleSpaceChange(space)}
                    className={cn(
                      "min-w-0 w-full cursor-pointer items-center gap-2 p-2",
                      isRemoteSpaceOffline(space) && "opacity-60 grayscale",
                    )}
                  >
                    <AvatarLogo src={space.logo} fallback={space.name[0]} size="xs" />
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className="flex min-w-0 items-center gap-1.5 truncate"
                        title={space.name}
                      >
                        <span className="truncate">{space.name}</span>
                        <SpaceTypeBadge space={space} show={hasRemoteSpace} />
                      </span>
                      <span
                        className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${getPlanBadgeStyle(space.plan ?? "free")}`}
                      >
                        {space.plan ?? "Free"}
                      </span>
                    </div>
                    {isActive && <Check className="size-4 shrink-0 text-muted-foreground" />}
                  </DropdownMenuItem>
                );
              })}
            </div>

            {/* Add Space */}
            {onAddSpace && (
              <>
                <DropdownMenuSeparator className="my-0 shrink-0" />
                <div className="shrink-0 p-1">
                  <DropdownMenuItem className="cursor-pointer gap-2 p-2" onClick={handleAddSpace}>
                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                      <Plus className="size-4" />
                    </div>
                    <span className="text-muted-foreground">{labels.addSpace}</span>
                  </DropdownMenuItem>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
