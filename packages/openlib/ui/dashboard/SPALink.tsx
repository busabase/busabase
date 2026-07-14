"use client";

import type { LinkProps } from "wouter";
import { useSearch, Link as WouterLink } from "wouter";
import { useAddDemoParam } from "./demo-client";

/**
 * Merge the current page's query string into a same-app navigation `href`, so
 * any state carried only in the URL (a host app's active-workspace selector,
 * a filter, `?demo`/`?lang`, ...) survives an in-app click instead of being
 * silently dropped by a bare `href={`/inbox/${id}`}` — every `SPALink` click
 * is effectively a same-page transition, not a real navigation away from
 * whatever context the URL was carrying. `href`'s own explicit query params
 * (if any) win over the current page's for the same key; everything else
 * from the current page is preserved as-is.
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

/**
 * SPALink - Wouter Link with Demo Mode integration
 *
 * A custom Link component for Wouter that:
 * - Preserves the current page's query string across in-app navigation (see
 *   `mergeSearchIntoHref` above) — this is the ONE place every dashboard link
 *   (sidebar nav tree, breadcrumbs, in-content links, and anything built on
 *   top of it) funnels through, so fixing it here covers call sites that
 *   build a raw href string well before it ever reaches a `<Link>`.
 * - Automatically appends the active `?demo` param in demo mode, preserving its
 *   value (`?demo=1`, or a named use-case like `?demo=blog`) — layered on top,
 *   after the search-string merge above.
 * - NProgress is handled globally by NProgressProvider
 *
 * Use this instead of wouter's Link in dashboard/SPA components.
 *
 * @example
 * ```tsx
 * // On /dashboard?space=abc, this will navigate to /tasks/123?space=abc
 * // (plus ?demo=1 on top of that, in demo mode)
 * <SPALink href="/tasks/123">View Task</SPALink>
 * ```
 */
export function SPALink({ href, ...props }: LinkProps & { href: string }) {
  const addDemoParam = useAddDemoParam();
  const currentSearch = useSearch();
  const hrefWithSearch = mergeSearchIntoHref(href, currentSearch);

  return <WouterLink href={addDemoParam(hrefWithSearch)} {...props} />;
}
