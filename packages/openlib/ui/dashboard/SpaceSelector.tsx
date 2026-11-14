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
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Cloud,
  Focus,
  LayoutList,
  Monitor,
  Plus,
  Settings,
  UserPlus,
} from "lucide-react";
import * as React from "react";
import { AvatarLogo } from "../avatar-logo";
import { orderSpacesByRecent, useRecentSpaceIds } from "./recent-spaces";
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

/**
 * The line under the space name. Defaults to the uppercase plan badge; a space
 * that carries a `description` (white-label hosts) renders that as plain muted
 * text instead, since a sentence does not belong in a badge. Additive — spaces
 * with no `description` render exactly as before.
 *
 * `plan: ""` means "this host has no plans", and renders nothing — distinct
 * from `plan: undefined`, which still falls back to "Free" so every existing
 * caller keeps its current badge. Uses an empty string rather than widening
 * the type to `string | null`: eight apps each carry their own local `Space`
 * type mirroring this one, and none of them needed to change for this.
 */
function SpaceSubtitle({ space, badgeClassName }: { space: Space; badgeClassName: string }) {
  if (space.description) {
    return (
      <span className="truncate text-xs text-muted-foreground opacity-70" title={space.description}>
        {space.description}
      </span>
    );
  }
  if (space.plan === "") return null;
  return (
    <span className={`${badgeClassName} ${getPlanBadgeStyle(space.plan ?? "free")}`}>
      {space.plan ?? "Free"}
    </span>
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

/**
 * The spaces listed in the menu when a host caps the list (`maxVisibleSpaces`).
 *
 * Keeps the order it is given (the menu passes recently active first, see
 * `orderSpacesByRecent`) and always includes the active space — swapped in for
 * the last visible row when it falls past the cap — so the check mark never
 * points at a row that was cut. Uncapped, or under the cap, it is the list as-is.
 */
export const pickVisibleSpaces = <T extends Pick<Space, "id">>(
  spaces: T[],
  activeSpaceId: string | undefined,
  maxVisibleSpaces?: number,
): T[] => {
  if (!maxVisibleSpaces || maxVisibleSpaces < 1 || spaces.length <= maxVisibleSpaces) {
    return spaces;
  }
  const head = spaces.slice(0, maxVisibleSpaces);
  if (!activeSpaceId || head.some((space) => space.id === activeSpaceId)) return head;
  const active = spaces.find((space) => space.id === activeSpaceId);
  return active ? [...head.slice(0, maxVisibleSpaces - 1), active] : head;
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
    /** Row that opens the full list once the menu is capped (`maxVisibleSpaces`). */
    viewAllSpaces?: string;
  };
  /** Use compact button size (md:h-8 md:p-0) */
  compact?: boolean;
  /** App logo image URL to use instead of Lucide icon */
  appLogo?: string;
  /** Optional secondary workspace actions rendered after the primary Space actions. */
  extraMenuItems?: React.ReactNode;
  /**
   * Cap on how many spaces the menu lists. Past it, the menu shows that many
   * (always including the active one) plus a "view all" row that calls
   * `onViewAllSpaces`. Both must be set for the cap to apply; omit them and every
   * space is listed, exactly as before. For people who belong to dozens of
   * spaces (agencies, partners), where a full list buries the menu's other
   * destinations.
   */
  maxVisibleSpaces?: number;
  onViewAllSpaces?: () => void;
  /**
   * How many spaces the user has, when `spaces` is only some of them (a host
   * that loads a bounded slice for people in hundreds of spaces). Drives the
   * counts, and the "view all" row whenever spaces are left out.
   */
  totalSpaces?: number;
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
  maxVisibleSpaces,
  onViewAllSpaces,
  totalSpaces,
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
  const [isHydrated, setIsHydrated] = React.useState(false);
  const [scrollRegion, setScrollRegion] = React.useState<HTMLDivElement | null>(null);
  const scrollContentRef = React.useRef<HTMLDivElement>(null);
  const activeSpaceItemRef = React.useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = React.useState(false);
  const [canScrollDown, setCanScrollDown] = React.useState(false);

  const currentSpace = activeSpace || internalActiveSpace;
  const logoSrc = currentSpace?.logo || appLogo;

  // Recently active spaces first, so the ones in use stay within reach (and
  // inside the cap) however many spaces someone belongs to. Only the host's
  // `activeSpace` is recorded — not the `spaces[0]` fallback shown while it loads.
  const recentSpaceIds = useRecentSpaceIds(activeSpace?.id);
  const orderedSpaces = React.useMemo(
    () => orderSpacesByRecent(spaces, recentSpaceIds),
    [spaces, recentSpaceIds],
  );

  // Streaming SSR can expose this button before React attaches the dropdown
  // handler. Keep it disabled until hydration so an early click is not lost.
  React.useEffect(() => {
    setIsHydrated(true);
  }, []);

  const updateScrollAffordances = React.useCallback(() => {
    if (!scrollRegion) return;

    const overflow = scrollRegion.scrollHeight - scrollRegion.clientHeight;
    setCanScrollUp(overflow > 1 && scrollRegion.scrollTop > 1);
    setCanScrollDown(overflow > 1 && scrollRegion.scrollTop < overflow - 1);
  }, [scrollRegion]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;

    if (!scrollRegion) return;

    const frame = window.requestAnimationFrame(() => {
      activeSpaceItemRef.current?.scrollIntoView?.({ block: "nearest" });
      updateScrollAffordances();
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateScrollAffordances);

    resizeObserver?.observe(scrollRegion);
    if (scrollContentRef.current) resizeObserver?.observe(scrollContentRef.current);
    window.addEventListener("resize", updateScrollAffordances);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScrollAffordances);
    };
  }, [isOpen, scrollRegion, updateScrollAffordances]);

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

  const handleViewAllSpaces = () => {
    setIsOpen(false);
    onViewAllSpaces?.();
  };

  if (!currentSpace) return null;

  // The cap only applies when the host also gives a way to reach the rest.
  const listedSpaces = onViewAllSpaces
    ? pickVisibleSpaces(orderedSpaces, currentSpace.id, maxVisibleSpaces)
    : orderedSpaces;
  const spaceCount = Math.max(totalSpaces ?? 0, spaces.length);
  const hasHiddenSpaces = listedSpaces.length < spaceCount;

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
              <SpaceSubtitle
                space={currentSpace}
                badgeClassName="inline-flex w-fit rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              />
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
              disabled={!isHydrated}
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
                <SpaceSubtitle
                  space={currentSpace}
                  badgeClassName="inline-flex w-fit rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                />
              </div>
              <ChevronsUpDown className="ml-auto shrink-0 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="flex max-h-[min(40rem,var(--radix-dropdown-menu-content-available-height))] w-96 min-w-96 max-w-96 flex-col overflow-hidden rounded-lg p-0"
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

            <DropdownMenuSeparator className="my-0 shrink-0" />

            {/* Scrollable primary actions and workspace destinations */}
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {canScrollUp && (
                <div
                  aria-hidden="true"
                  data-space-scroll-affordance="top"
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-8 items-start justify-center bg-popover/90 pt-0.5 shadow-sm"
                >
                  <ChevronUp className="size-4 text-muted-foreground" />
                </div>
              )}
              <div
                ref={setScrollRegion}
                data-space-scroll-region="true"
                onScroll={updateScrollAffordances}
                className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-1 [scrollbar-gutter:stable]"
              >
                <div ref={scrollContentRef}>
                  <DropdownMenuLabel className="px-2 py-1.5 text-muted-foreground text-xs">
                    {labels.spaces} · {spaceCount}
                  </DropdownMenuLabel>
                  {listedSpaces.map((space) => {
                    const isActive = space.id === currentSpace.id;
                    return (
                      <DropdownMenuItem
                        ref={isActive ? activeSpaceItemRef : undefined}
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

                  {hasHiddenSpaces && (
                    <DropdownMenuItem
                      className="cursor-pointer gap-2 p-2"
                      onClick={handleViewAllSpaces}
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                        <LayoutList className="size-4" />
                      </div>
                      <span className="text-muted-foreground">
                        {labels.viewAllSpaces ?? "View all spaces"} · {spaceCount}
                      </span>
                    </DropdownMenuItem>
                  )}

                  {onAddSpace && (
                    <>
                      <DropdownMenuSeparator className="my-0" />
                      <div className="p-1">
                        <DropdownMenuItem
                          className="cursor-pointer gap-2 p-2"
                          onClick={handleAddSpace}
                        >
                          <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                            <Plus className="size-4" />
                          </div>
                          <span className="text-muted-foreground">{labels.addSpace}</span>
                        </DropdownMenuItem>
                      </div>
                    </>
                  )}

                  {extraMenuItems && (
                    <>
                      <DropdownMenuSeparator className="my-0" />
                      <div className="p-1">{extraMenuItems}</div>
                    </>
                  )}
                </div>
              </div>
              {canScrollDown && (
                <div
                  aria-hidden="true"
                  data-space-scroll-affordance="bottom"
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-8 items-end justify-center bg-popover/90 pb-0.5 shadow-sm"
                >
                  <ChevronDown className="size-4 text-muted-foreground" />
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
