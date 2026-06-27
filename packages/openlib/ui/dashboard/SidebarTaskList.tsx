"use client";

/**
 * Sidebar Task List Component
 * Displays recent agent tasks with metadata (space name and time)
 * Similar design to AgentTaskList but optimized for sidebar navigation
 *
 * Supports expandable mode:
 * - Default: shows limited tasks based on available height
 * - Expanded: shows all tasks with internal scroll, "See All" fixed at bottom
 */

import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { formatRelativeTime } from "../../utils/time";
import { TaskStatusIcon } from "./TaskStatusIcon";
import type { NavItem } from "./types";

interface BaseSidebarTaskListProps {
  /**
   * Tasks to display with metadata
   */
  tasks: NavItem[];
  /**
   * Link component wrapper - allows each app to use their own routing
   * e.g., Next.js Link, React Router Link, or SPALink
   */
  LinkComponent: ComponentType<{
    href: string;
    className?: string;
    children: ReactNode;
  }>;
  /**
   * Empty state message
   */
  emptyMessage?: string;
  /**
   * BCP 47 locale tag used to format relative times. Pass the app's current
   * i18n locale (e.g. `useI18nContext().locale`) so timestamps honor the user's
   * in-app language preference instead of the system/browser locale.
   */
  locale?: string;
}

interface SidebarTaskListProps extends BaseSidebarTaskListProps {
  /**
   * Match AgentTaskList variants.
   * - dashboard: show time only
   * - agent-manager: show space + time
   */
  variant: "dashboard" | "agent-manager";
  /**
   * Whether the list is expanded (showing all tasks with scroll)
   */
  isExpanded?: boolean;
  /**
   * Callback when expand/collapse is toggled
   */
  onExpandToggle?: () => void;
  /**
   * Total count of tasks (used to determine if "See All" should show)
   */
  totalCount?: number;
  /**
   * Default visible count before expansion (auto-calculated if not provided)
   */
  defaultVisibleCount?: number;
}

// Approximate height of a single task item in pixels (with metadata)
const TASK_ITEM_HEIGHT = 52;
// Height of the "See All" button area
const SEE_ALL_BUTTON_HEIGHT = 44;
// Minimum tasks to show
const MIN_VISIBLE_TASKS = 3;
// Maximum tasks to show before requiring "See All"
const MAX_VISIBLE_TASKS = 10;

// Use useLayoutEffect on client, useEffect on server
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function SidebarTaskList({
  tasks,
  LinkComponent,
  emptyMessage = "No recent tasks",
  variant,
  isExpanded = false,
  onExpandToggle,
  totalCount,
  defaultVisibleCount,
  locale,
}: SidebarTaskListProps) {
  const [location] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [calculatedVisibleCount, setCalculatedVisibleCount] = useState(defaultVisibleCount ?? 5);
  const [isCalculated, setIsCalculated] = useState(false);

  // Calculate how many tasks can fit based on container height
  const calculateVisibleCount = useCallback(() => {
    if (defaultVisibleCount !== undefined) {
      setCalculatedVisibleCount(defaultVisibleCount);
      setIsCalculated(true);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    // Find the sidebar content element (has data-sidebar="content" attribute)
    const sidebarContent = container.closest('[data-sidebar="content"]');
    if (!sidebarContent) {
      // Fallback: use parent's parent (SidebarGroup -> NavMain wrapper -> SidebarContent)
      const parentGroup = container.closest('[data-sidebar="group"]');
      if (!parentGroup?.parentElement?.parentElement) return;

      const contentElement = parentGroup.parentElement.parentElement;
      const contentHeight = contentElement.clientHeight;

      // Get the height of the first nav group (static menu items)
      const firstGroup = contentElement.querySelector('[data-sidebar="group"]');
      const firstGroupHeight = firstGroup ? firstGroup.getBoundingClientRect().height : 0;

      // Get the height of the "Recent Tasks" label
      const labelHeight = 32; // Approximate height of the label row

      // Available height for task list
      const availableHeight =
        contentHeight - firstGroupHeight - labelHeight - SEE_ALL_BUTTON_HEIGHT - 16;
      const count = Math.min(
        MAX_VISIBLE_TASKS,
        Math.max(MIN_VISIBLE_TASKS, Math.floor(availableHeight / TASK_ITEM_HEIGHT)),
      );

      setCalculatedVisibleCount(count);
      setIsCalculated(true);
      return;
    }

    const contentHeight = sidebarContent.clientHeight;

    // Get the height of the first nav group (static menu items like Agents, Scheduled Tasks, Spaces)
    const allGroups = sidebarContent.querySelectorAll('[data-sidebar="group"]');
    let staticGroupsHeight = 0;

    // Sum up heights of all non-dynamic groups (groups before this one)
    for (const group of allGroups) {
      if (group.contains(container)) break; // Stop when we reach the current group
      staticGroupsHeight += group.getBoundingClientRect().height;
    }

    // Get the height of the "Recent Tasks" label
    const labelHeight = 32; // Approximate height of the label row

    // Available height for task list = content height - static groups - label - see all button - padding
    const availableHeight =
      contentHeight - staticGroupsHeight - labelHeight - SEE_ALL_BUTTON_HEIGHT - 16;
    const count = Math.min(
      MAX_VISIBLE_TASKS,
      Math.max(MIN_VISIBLE_TASKS, Math.floor(availableHeight / TASK_ITEM_HEIGHT)),
    );

    setCalculatedVisibleCount(count);
    setIsCalculated(true);
  }, [defaultVisibleCount]);

  // Calculate on mount and resize
  useIsomorphicLayoutEffect(() => {
    // Try to calculate immediately
    calculateVisibleCount();

    // Also schedule multiple retries to handle async rendering
    const timers = [
      setTimeout(calculateVisibleCount, 0),
      setTimeout(calculateVisibleCount, 100),
      setTimeout(calculateVisibleCount, 300),
    ];

    const handleResize = () => {
      calculateVisibleCount();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", handleResize);
    };
  }, [calculateVisibleCount]);

  // Recalculate when container ref becomes available
  useEffect(() => {
    if (containerRef.current && !isCalculated) {
      calculateVisibleCount();
    }
  }, [isCalculated, calculateVisibleCount]);

  if (tasks.length === 0) {
    return (
      <div className="px-2 py-4 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const effectiveTotalCount = totalCount ?? tasks.length;
  const hasMore = effectiveTotalCount > calculatedVisibleCount;
  const visibleTasks = isExpanded ? tasks : tasks.slice(0, calculatedVisibleCount);

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Task list - scrollable when expanded */}
      <div
        className={
          isExpanded
            ? "flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent"
            : "flex-1"
        }
      >
        <SidebarMenu>
          {visibleTasks.map((task) => {
            // Skip "see-all" item as we render our own button
            if (task.id === "see-all") return null;

            const isActive = location === task.url;

            // Generate metadata text based on variant
            let metadataText = "";
            if (variant === "agent-manager") {
              const spacePart = task.spaceName || "";
              const timePart = task.createdAt ? formatRelativeTime(task.createdAt, locale) : "";
              metadataText =
                spacePart && timePart ? `${spacePart} • ${timePart}` : spacePart || timePart;
            } else if (variant === "dashboard") {
              metadataText = task.createdAt ? formatRelativeTime(task.createdAt, locale) : "";
            }

            return (
              <SidebarMenuItem key={task.id || task.url}>
                <SidebarMenuButton
                  asChild
                  tooltip={task.title}
                  isActive={isActive}
                  className={metadataText ? "py-2 h-auto" : undefined}
                >
                  <LinkComponent href={task.url}>
                    <div className="flex items-start gap-2 w-full">
                      <div className="pt-0.5 shrink-0">
                        <TaskStatusIcon status={task.status} />
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0 w-full">
                        <span className="font-medium truncate">{task.title}</span>
                        {metadataText && (
                          <span className="text-xs text-muted-foreground truncate">
                            {metadataText}
                          </span>
                        )}
                      </div>
                    </div>
                  </LinkComponent>
                </SidebarMenuButton>

                {/* Delete action for tasks */}
                {task.onDelete && task.id && (
                  <SidebarMenuAction
                    showOnHover
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (task.id) {
                        task.onDelete?.(task.id);
                      }
                    }}
                    title="Delete task"
                  >
                    <Trash2 className="h-4 w-4" />
                  </SidebarMenuAction>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </div>

      {/* Fixed "See All" / "Show Less" button */}
      {hasMore && onExpandToggle && (
        <div className="shrink-0 border-t border-sidebar-border bg-sidebar pt-1">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onExpandToggle}
                className="text-muted-foreground hover:text-foreground"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    <span>Show Less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    <span>See All ({effectiveTotalCount})</span>
                  </>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      )}
    </div>
  );
}
