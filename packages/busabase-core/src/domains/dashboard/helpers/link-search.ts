"use client";

import { useSearch } from "wouter";

/**
 * Merge a page's query string into a same-app navigation `href`, so state
 * carried only in the URL (e.g. busabase-cloud's `?space=tnl_…` selecting
 * a connected Local ↔ Cloud Tunnel remote space) survives clicking into a
 * Change Request, a linked record, or a "back" link — none of which are full
 * page loads, but a bare `href={`/inbox/${id}`}` has no query-string
 * awareness of its own and would otherwise silently drop it, bouncing the
 * host app back to its default context.
 *
 * `href`'s own explicit query params (if any) win over `currentSearch`'s for
 * the same key; everything else from the current page is preserved as-is.
 * Plain function (no hook) so callers building several hrefs in a loop (e.g.
 * mapping linked-record chips) can call `useSearch()` once outside the loop
 * and reuse it here — hooks can't be called per-iteration.
 */
export function mergeSearchIntoHref(href: string, currentSearch: string): string {
  if (!currentSearch) return href;

  const [path, hrefQuery] = href.split("?");
  const merged = new URLSearchParams(currentSearch);
  if (hrefQuery) {
    for (const [key, value] of new URLSearchParams(hrefQuery)) {
      merged.set(key, value);
    }
  }
  const mergedQuery = merged.toString();
  return mergedQuery ? `${path}?${mergedQuery}` : path;
}

/** Hook form of {@link mergeSearchIntoHref} for a single href built at the top of a component. */
export function useHrefWithCurrentSearch(href: string): string {
  const currentSearch = useSearch();
  return mergeSearchIntoHref(href, currentSearch);
}
