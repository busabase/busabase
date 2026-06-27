"use client";

import { useMemo, useRef } from "react";
import { resolveDemoMode } from "../demo";
import type { NavGroup, NavItem } from "../types";

export interface UseSPANavigationOptions {
  /** Whether in demo mode - appends the active ?demo value to URLs */
  isDemo?: boolean;
  /** Dynamic items to inject into groups marked with isDynamic */
  dynamicItems?: NavItem[];
  /** Base path to strip from URLs (e.g., "/systemadmin") - for SPA routing */
  basePath?: string;
  /** Total count of dynamic items (for "See All" display) */
  totalCount?: number;
  /** Default visible count before expansion */
  defaultVisibleCount?: number;
}

/**
 * Hook to build navigation with demo mode URL handling and dynamic items injection
 */
export function useSPANavigation(
  baseNav: NavGroup[],
  options: UseSPANavigationOptions = {},
): NavGroup[] {
  const { isDemo = false, dynamicItems = [], basePath, totalCount, defaultVisibleCount } = options;

  // Use ref to store previous result and avoid unnecessary re-renders
  const prevResultRef = useRef<NavGroup[]>([]);
  const prevBaseNavRef = useRef<NavGroup[]>([]);
  const prevIsDemoRef = useRef<boolean>(isDemo);
  const prevDynamicItemsRef = useRef<NavItem[]>(dynamicItems);
  const prevTotalCountRef = useRef<number | undefined>(totalCount);
  const prevDefaultVisibleCountRef = useRef<number | undefined>(defaultVisibleCount);

  return useMemo(() => {
    // Check if inputs have meaningfully changed
    const baseNavChanged = !shallowEqualNavGroups(baseNav, prevBaseNavRef.current);
    const isDemoChanged = isDemo !== prevIsDemoRef.current;
    const dynamicItemsChanged = !shallowEqualNavItems(dynamicItems, prevDynamicItemsRef.current);
    const totalCountChanged = totalCount !== prevTotalCountRef.current;
    const defaultVisibleCountChanged = defaultVisibleCount !== prevDefaultVisibleCountRef.current;

    // If nothing changed, return previous result to maintain referential equality
    if (
      !baseNavChanged &&
      !isDemoChanged &&
      !dynamicItemsChanged &&
      !totalCountChanged &&
      !defaultVisibleCountChanged &&
      prevResultRef.current.length > 0
    ) {
      return prevResultRef.current;
    }

    // Update refs
    prevBaseNavRef.current = baseNav;
    prevIsDemoRef.current = isDemo;
    prevDynamicItemsRef.current = dynamicItems;
    prevTotalCountRef.current = totalCount;
    prevDefaultVisibleCountRef.current = defaultVisibleCount;

    // Helper to transform item URLs
    const transformItemUrl = (item: NavItem): NavItem => {
      let url = item.url;

      // Strip basePath if provided (for SPA routing)
      if (basePath && url.startsWith(basePath)) {
        url = url.slice(basePath.length) || "/";
      }

      // Append demo param if in demo mode
      if (isDemo) {
        url = appendDemoParam(url);
      }

      return { ...item, url };
    };

    const result = baseNav.map((group) => {
      // Inject dynamic items for groups marked with isDynamic
      // Also transform their URLs with basePath and demo mode
      if (group.isDynamic) {
        return {
          ...group,
          items: dynamicItems.map(transformItemUrl),
          totalCount: totalCount ?? dynamicItems.length,
          defaultVisibleCount,
        };
      }

      // Transform URLs based on basePath and demo mode
      return {
        ...group,
        items: group.items.map(transformItemUrl),
      };
    });

    prevResultRef.current = result;
    return result;
  }, [baseNav, isDemo, dynamicItems, basePath, totalCount, defaultVisibleCount]);
}

/**
 * Append the active demo query param to URL.
 */
function appendDemoParam(url: string): string {
  const demo = resolveDemoMode().useCase ?? "1";
  if (/[?&]demo=/.test(url)) return url;
  if (url.includes("?")) {
    return `${url}&demo=${demo}`;
  }
  return `${url}?demo=${demo}`;
}

/**
 * Shallow comparison for NavGroup arrays
 */
function shallowEqualNavGroups(a: NavGroup[], b: NavGroup[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const groupA = a[i];
    const groupB = b[i];

    if (
      groupA.label !== groupB.label ||
      groupA.isDynamic !== groupB.isDynamic ||
      groupA.taskListVariant !== groupB.taskListVariant ||
      groupA.className !== groupB.className ||
      groupA.headerActionTitle !== groupB.headerActionTitle ||
      !shallowEqualNavItems(groupA.items, groupB.items)
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Shallow comparison for NavItem arrays
 */
function shallowEqualNavItems(a: NavItem[], b: NavItem[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const itemA = a[i];
    const itemB = b[i];

    if (
      itemA.title !== itemB.title ||
      itemA.url !== itemB.url ||
      itemA.isActive !== itemB.isActive ||
      itemA.badge !== itemB.badge ||
      itemA.id !== itemB.id ||
      itemA.status !== itemB.status ||
      itemA.spaceName !== itemB.spaceName ||
      itemA.createdAt !== itemB.createdAt
    ) {
      return false;
    }
  }

  return true;
}
