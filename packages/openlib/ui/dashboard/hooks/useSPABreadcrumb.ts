"use client";

import { useEffect, useState } from "react";

/** One segment of an ordered breadcrumb trail. `href: null` is the current page. */
export interface BreadcrumbCrumb {
  label: string;
  href: string | null;
}

export interface BreadcrumbState {
  title: string;
  parent: string | null;
  /**
   * Optional intermediate breadcrumb with a link, shown between parent and title.
   * Fallback for non-node routes (Search, Home) that only need one extra segment.
   * Node routes set `crumbs` instead, which can hold the full folder path.
   */
  intermediate?: { label: string; href: string } | null;
  /**
   * Full ordered trail, root first. When this is non-empty, renderers show it
   * and ignore `parent` / `intermediate`. Left null for routes that still only
   * know a parent and a title.
   */
  crumbs?: BreadcrumbCrumb[] | null;
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
  /**
   * Full trail for this location (ancestor folders, then the open node).
   * Return null to keep the parent / intermediate fallback.
   */
  getCrumbs?: (location: string) => BreadcrumbCrumb[] | null;
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
  const {
    root = null,
    getParent,
    getIntermediate,
    getCrumbs,
    dynamicTitle,
    maxTitleLength = 40,
  } = options;

  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbState>({
    title: "Overview",
    parent: root,
    intermediate: null,
    crumbs: null,
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
      const routeTitle = dynamicTitle || currentRoute.breadcrumb || "Overview";
      const supplied = getCrumbs ? getCrumbs(location) : null;
      const crumbs = supplied && supplied.length > 0 ? supplied : null;
      // Crumbs keep their full labels; the renderer truncates visually and
      // puts the uncut name on `title`. The parent/intermediate fallback still
      // cuts a single long title, which is all that shape can show.
      const title = crumbs
        ? (crumbs[crumbs.length - 1]?.label ?? routeTitle)
        : routeTitle && routeTitle.length > maxTitleLength
          ? `${routeTitle.slice(0, maxTitleLength)}...`
          : routeTitle;

      const parent = getParent ? getParent(location) : root;
      const intermediate = crumbs ? null : (getIntermediate?.(location) ?? null);
      setBreadcrumb((prev) => {
        if (
          prev.title === title &&
          prev.parent === parent &&
          prev.intermediate?.href === intermediate?.href &&
          sameCrumbs(prev.crumbs, crumbs)
        )
          return prev;
        return { title, parent, intermediate, crumbs };
      });
    } else {
      setBreadcrumb((prev) => {
        if (prev.title === "Overview" && prev.parent === root && !prev.intermediate && !prev.crumbs)
          return prev;
        return { title: "Overview", parent: root, intermediate: null, crumbs: null };
      });
    }
  }, [location, routes, root, getParent, getIntermediate, getCrumbs, dynamicTitle, maxTitleLength]);

  return breadcrumb;
}

const sameCrumbs = (
  left: BreadcrumbCrumb[] | null | undefined,
  right: BreadcrumbCrumb[] | null,
): boolean => {
  if (!left && !right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (crumb, index) => crumb.label === right[index]?.label && crumb.href === right[index]?.href,
  );
};
