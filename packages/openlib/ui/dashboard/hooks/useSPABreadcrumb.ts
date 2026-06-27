"use client";

import { useEffect, useState } from "react";

export interface BreadcrumbState {
  title: string;
  parent: string | null;
  /** Optional intermediate breadcrumb with a link, shown between parent and title */
  intermediate?: { label: string; href: string } | null;
}

/** Route config for breadcrumb matching (subset of full RouteConfig) */
export interface BreadcrumbRouteConfig {
  path: string;
  breadcrumb: string;
  title?: string;
}

export interface UseSPABreadcrumbOptions {
  /** Root breadcrumb label, e.g., "Dashboard", "Agent" */
  root?: string;
  /** Function to determine parent breadcrumb based on location */
  getParent?: (location: string) => string | null;
  /** Function to determine intermediate breadcrumb link based on location */
  getIntermediate?: (location: string) => { label: string; href: string } | null;
  /** Dynamic title fetcher for routes like /tasks/:id */
  dynamicTitle?: string;
  /** Max length for title truncation */
  maxTitleLength?: number;
}

/**
 * Hook to manage SPA breadcrumb state based on current route
 */
export function useSPABreadcrumb(
  location: string,
  routes: BreadcrumbRouteConfig[],
  options: UseSPABreadcrumbOptions = {},
) {
  const { root = null, getParent, getIntermediate, dynamicTitle, maxTitleLength = 40 } = options;

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbState>({
    title: "Overview",
    parent: root,
    intermediate: null,
  });

  useEffect(() => {
    // Find matching route config — pick the most specific match
    const currentRoute = routes
      .filter((route) => {
        if (route.path === "/") return location === "/" || location === "";
        if (route.path.includes(":")) {
          // Convert pattern to regex: replace :param with a segment matcher
          const pattern = route.path.replace(/:[^/]+/g, "[^/]+");
          const regex = new RegExp(`^${pattern}$`);
          return regex.test(location);
        }
        return location.startsWith(route.path);
      })
      // Prefer the route with the most path segments (most specific)
      .sort((a, b) => b.path.split("/").length - a.path.split("/").length)[0];

    if (currentRoute) {
      // Use dynamic title if provided (e.g., from API fetch)
      const title = dynamicTitle || currentRoute.breadcrumb || "Overview";
      const truncatedTitle =
        title && title.length > maxTitleLength ? `${title.slice(0, maxTitleLength)}...` : title;

      const parent = getParent ? getParent(location) : root;
      const intermediate = getIntermediate ? getIntermediate(location) : null;
      setBreadcrumb((prev) => {
        if (
          prev.title === truncatedTitle &&
          prev.parent === parent &&
          prev.intermediate?.href === intermediate?.href
        )
          return prev;
        return { title: truncatedTitle, parent, intermediate };
      });
    } else {
      setBreadcrumb((prev) => {
        if (prev.title === "Overview" && prev.parent === root && !prev.intermediate) return prev;
        return { title: "Overview", parent: root, intermediate: null };
      });
    }
  }, [location, routes, root, getParent, getIntermediate, dynamicTitle, maxTitleLength]);

  return breadcrumb;
}
