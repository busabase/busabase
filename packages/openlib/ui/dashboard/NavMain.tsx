"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "kui/sidebar";
import { ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { useLocation } from "wouter";
import { SidebarTaskList } from "./SidebarTaskList";
import { SPALink } from "./SPALink";
import type { NavGroup } from "./types";

interface NavKeyItem {
  title: string;
  url: string;
  id?: string;
  onClick?: string;
}

const getNavItemKey = (item: NavKeyItem, index: number, prefix = "item") =>
  [prefix, item.id, item.onClick, item.url, item.title, String(index)]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .join(":");

interface NavMainProps {
  items: NavGroup[];
  /**
   * Callback when a group's header action button is clicked
   * @param groupLabel - The label of the group whose action was clicked
   */
  onHeaderActionClick?: (groupLabel: string) => void;
  /**
   * Callback when a nav item with an action property is clicked
   * @param action - The action key from the nav item
   */
  onNavItemAction?: (action: string) => void;
  /**
   * Whether the task list is expanded (controlled externally)
   */
  isTaskListExpanded?: boolean;
  /**
   * Callback when task list expand/collapse is toggled
   */
  onTaskListExpandToggle?: () => void;
}

function NavMainComponent({
  items,
  onHeaderActionClick,
  onNavItemAction,
  isTaskListExpanded,
  onTaskListExpandToggle,
}: NavMainProps) {
  const [location] = useLocation();
  // A nav url is "active" for the current location on an exact match OR when the
  // location is a descendant route (e.g. a record under a base folder). This keeps
  // the parent folder highlighted and expanded while browsing its child pages.
  const isPathActive = (url?: string) =>
    !!url && (location === url || (url !== "/" && location.startsWith(`${url}/`)));
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Per-folder manual expand/collapse override (by nav-item key). A folder on the
  // active route is always expanded; this only adds extra opens for other folders.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  // Check if any dynamic group exists (for flex layout)
  const hasDynamicGroup = items.some((group) => group.isDynamic);

  return (
    <div className={hasDynamicGroup ? "flex flex-col flex-1 min-h-0 gap-1" : "contents"}>
      {items.map((group, groupIndex) => {
        const HeaderActionIcon = group.headerAction;
        const GroupIcon = group.icon;
        const groupKey = group.label || `group-${groupIndex}`;
        const isCollapsed = collapsedGroups[groupKey] ?? false;

        // For dynamic groups (task lists), use external expand state if provided
        const effectiveIsExpanded = group.isDynamic
          ? (isTaskListExpanded ?? group.isExpanded ?? false)
          : false;
        const effectiveOnExpandToggle = group.isDynamic
          ? (onTaskListExpandToggle ?? group.onExpandToggle)
          : undefined;

        return (
          <SidebarGroup
            key={groupKey}
            className={`${group.className ?? ""} ${group.isDynamic ? "flex-1 min-h-0 flex flex-col" : ""} relative`}
          >
            {group.label && (
              <div className="flex items-center shrink-0 px-2">
                {group.isDynamic ? (
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapse(groupKey)}
                    className="inline-flex items-center gap-1.5 py-1 rounded-md hover:bg-sidebar-accent transition-colors cursor-pointer"
                    title={isCollapsed ? "Expand" : "Collapse"}
                  >
                    {GroupIcon && <GroupIcon className="size-3 text-sidebar-foreground/50" />}
                    <span className="text-[11px] uppercase tracking-wider font-medium text-sidebar-foreground/50">
                      {group.label}
                    </span>
                    <ChevronRight
                      className={`size-3 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                    />
                  </button>
                ) : (
                  <SidebarGroupLabel className="flex-1 flex items-center gap-1.5 text-sidebar-foreground/50 text-[11px] uppercase tracking-wider font-medium h-6">
                    {GroupIcon && <GroupIcon className="size-3" />}
                    <span>{group.label}</span>
                  </SidebarGroupLabel>
                )}
              </div>
            )}
            {HeaderActionIcon && (
              <SidebarGroupAction
                title={group.headerActionTitle}
                onClick={() => onHeaderActionClick?.(group.label)}
                className="top-2"
              >
                <HeaderActionIcon className="size-4" />
                {group.headerActionTitle && (
                  <span className="sr-only">{group.headerActionTitle}</span>
                )}
              </SidebarGroupAction>
            )}
            {group.isDynamic ? (
              !isCollapsed && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <SidebarTaskList
                    tasks={group.items}
                    // SPALink signature doesn't exactly match, but is safe for our usage
                    LinkComponent={SPALink as any}
                    variant={group.taskListVariant ?? "dashboard"}
                    isExpanded={effectiveIsExpanded}
                    onExpandToggle={effectiveOnExpandToggle}
                    totalCount={group.totalCount}
                    defaultVisibleCount={group.defaultVisibleCount}
                  />
                </div>
              )
            ) : (
              <SidebarMenu>
                {group.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const itemKey = getNavItemKey(item, itemIndex);
                  // A folder is open when it (or one of its children) is the active
                  // route, or when manually expanded. Selecting a folder thus also
                  // expands it, and navigating away collapses it again.
                  const isActiveTree =
                    Boolean(item.isActive) ||
                    isPathActive(item.url) ||
                    (item.items?.some((subItem) => isPathActive(subItem.url)) ?? false);
                  const isOpen = isActiveTree || (openOverrides[itemKey] ?? false);

                  // If item has sub-items, render as Collapsible
                  if (item.items && item.items.length > 0) {
                    return (
                      <Collapsible
                        key={itemKey}
                        asChild
                        open={isOpen}
                        onOpenChange={(open) =>
                          setOpenOverrides((prev) => ({ ...prev, [itemKey]: open }))
                        }
                        className="group/collapsible"
                      >
                        <SidebarMenuItem>
                          {item.url ? (
                            // Navigable parent (e.g. a folder with a detail screen):
                            // the label links to its page; a separate chevron toggles.
                            <div
                              className={`flex min-w-0 items-center rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                                isPathActive(item.url)
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : ""
                              }`}
                            >
                              <SidebarMenuButton
                                asChild
                                className="min-w-0 flex-1 bg-transparent pr-1 hover:bg-transparent data-[active=true]:bg-transparent data-[active=true]:text-inherit"
                                isActive={isPathActive(item.url)}
                                tooltip={item.title}
                              >
                                <SPALink className="min-w-0" href={item.url}>
                                  {Icon && <Icon />}
                                  <span className="min-w-0 truncate group-data-[collapsible=icon]:hidden">
                                    {item.title}
                                  </span>
                                </SPALink>
                              </SidebarMenuButton>
                              <div className="flex shrink-0 items-center pr-1 group-data-[collapsible=icon]:hidden">
                                {item.onAddChild && (
                                  <button
                                    className="flex size-5 items-center justify-center rounded-md p-0 text-sidebar-foreground opacity-0 outline-none ring-sidebar-ring transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      item.onAddChild?.();
                                    }}
                                    title="New"
                                    type="button"
                                  >
                                    <Plus className="size-4 shrink-0" />
                                    <span className="sr-only">New</span>
                                  </button>
                                )}
                                <CollapsibleTrigger asChild>
                                  <button
                                    className="flex size-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[state=open]/collapsible:rotate-90"
                                    title="Toggle"
                                    type="button"
                                  >
                                    <ChevronRight className="size-4 shrink-0" />
                                    <span className="sr-only">Toggle</span>
                                  </button>
                                </CollapsibleTrigger>
                              </div>
                            </div>
                          ) : (
                            <CollapsibleTrigger asChild>
                              <SidebarMenuButton tooltip={item.title}>
                                {Icon && <Icon />}
                                <span className="group-data-[collapsible=icon]:hidden">
                                  {item.title}
                                </span>
                                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
                              </SidebarMenuButton>
                            </CollapsibleTrigger>
                          )}
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.items.map((subItem, subItemIndex) => {
                                const isSubItemActive = location === subItem.url;
                                const SubIcon = subItem.icon;
                                return (
                                  <SidebarMenuSubItem
                                    key={getNavItemKey(subItem, subItemIndex, `${itemKey}:sub`)}
                                  >
                                    <SidebarMenuSubButton asChild isActive={isSubItemActive}>
                                      {subItem.url.startsWith("http://") ||
                                      subItem.url.startsWith("https://") ? (
                                        // External link - use regular anchor tag
                                        <a
                                          href={subItem.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {SubIcon && <SubIcon />}
                                          <span>{subItem.title}</span>
                                          <ExternalLink className="ml-auto h-4 w-4" />
                                        </a>
                                      ) : (
                                        // Internal link - use SPA Link
                                        <SPALink href={subItem.url}>
                                          {SubIcon && <SubIcon />}
                                          <span>{subItem.title}</span>
                                        </SPALink>
                                      )}
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    );
                  }

                  // If item has no sub-items, render as simple link or action button
                  return (
                    <SidebarMenuItem key={itemKey}>
                      {item.onClick ? (
                        // Items with onClick trigger a callback instead of navigation
                        <SidebarMenuButton
                          tooltip={item.title}
                          onClick={() => item.onClick && onNavItemAction?.(item.onClick)}
                        >
                          {Icon && <Icon />}
                          <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                        </SidebarMenuButton>
                      ) : (
                        // Regular navigation items
                        <SidebarMenuButton
                          asChild
                          tooltip={item.title}
                          isActive={
                            location === item.url ||
                            (item.url !== "/" && location.startsWith(`${item.url}/`))
                          }
                          className="hover:bg-accent data-[active=true]:bg-accent"
                        >
                          {/* Check if URL is external (http:// or https://) */}
                          {item.url.startsWith("http://") || item.url.startsWith("https://") ? (
                            // External link - use regular anchor tag
                            <a href={item.url} target="_blank" rel="noopener noreferrer">
                              {Icon && <Icon />}
                              <span className="group-data-[collapsible=icon]:hidden">
                                {item.title}
                              </span>
                              <ExternalLink className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
                            </a>
                          ) : (
                            // Internal link - use SPA Link
                            <SPALink href={item.url as any}>
                              {Icon && <Icon />}
                              <span className="group-data-[collapsible=icon]:hidden">
                                {item.title}
                              </span>
                            </SPALink>
                          )}
                        </SidebarMenuButton>
                      )}
                      {item.badge !== undefined && item.badge !== null && (
                        <SidebarMenuBadge className="bg-primary/10 text-primary ring-1 ring-primary/20 group-data-[collapsible=icon]:hidden">
                          {item.badge}
                        </SidebarMenuBadge>
                      )}
                      {item.onDelete && item.id && (
                        <SidebarMenuAction
                          showOnHover
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (item.id) {
                              item.onDelete?.(item.id);
                            }
                          }}
                          title="Delete"
                          className="group-data-[collapsible=icon]:hidden"
                        >
                          <Trash2 />
                        </SidebarMenuAction>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroup>
        );
      })}
    </div>
  );
}

// Memoize component with custom comparison to prevent unnecessary re-renders
export const NavMain = memo(NavMainComponent, (prevProps, nextProps) => {
  // Compare items array length
  if (prevProps.items.length !== nextProps.items.length) {
    return false;
  }

  // Compare each item's key properties (shallow comparison)
  for (let i = 0; i < prevProps.items.length; i++) {
    const prevGroup = prevProps.items[i];
    const nextGroup = nextProps.items[i];

    if (prevGroup.label !== nextGroup.label || prevGroup.items.length !== nextGroup.items.length) {
      return false;
    }

    if (prevGroup.taskListVariant !== nextGroup.taskListVariant) {
      return false;
    }

    if (prevGroup.isExpanded !== nextGroup.isExpanded) {
      return false;
    }

    if (prevGroup.totalCount !== nextGroup.totalCount) {
      return false;
    }

    if (prevGroup.defaultVisibleCount !== nextGroup.defaultVisibleCount) {
      return false;
    }

    // Compare items within each group
    for (let j = 0; j < prevGroup.items.length; j++) {
      const prevItem = prevGroup.items[j];
      const nextItem = nextGroup.items[j];

      if (
        prevItem.url !== nextItem.url ||
        prevItem.title !== nextItem.title ||
        prevItem.badge !== nextItem.badge ||
        prevItem.status !== nextItem.status ||
        prevItem.spaceName !== nextItem.spaceName ||
        prevItem.createdAt !== nextItem.createdAt
      ) {
        return false;
      }
    }
  }

  // Compare callback function references
  if (prevProps.onHeaderActionClick !== nextProps.onHeaderActionClick) {
    return false;
  }

  if (prevProps.onNavItemAction !== nextProps.onNavItemAction) {
    return false;
  }

  if (prevProps.isTaskListExpanded !== nextProps.isTaskListExpanded) {
    return false;
  }

  if (prevProps.onTaskListExpandToggle !== nextProps.onTaskListExpandToggle) {
    return false;
  }

  return true;
});
