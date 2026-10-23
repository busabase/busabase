"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { Router } from "wouter";
import { navigate } from "wouter/use-browser-location";

/**
 * wouter's browser location hooks, safe to run under the Next.js App Router.
 *
 * wouter dispatches history events synchronously. Next's HistoryUpdater writes
 * both pushState and replaceState from useInsertionEffect, and other callers
 * can navigate during a commit without Next's __NA marker. Notifying React in
 * either case schedules an update inside an insertion effect.
 *
 * Keep the URL/history writes synchronous, but notify location subscribers in
 * a microtask after the current commit. Coalesce events within that turn; hooks
 * read the latest URL, including query-only and back/forward navigation.
 */
const events = ["popstate", "pushState", "replaceState", "hashchange"] as const;

const subscribeToLocationUpdates = (callback: () => void) => {
  let active = true;
  let queued = false;
  const onEvent = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) callback();
    });
  };
  for (const event of events) addEventListener(event, onEvent);
  return () => {
    active = false;
    for (const event of events) removeEventListener(event, onEvent);
  };
};

const currentPathname = () => location.pathname;
const currentSearch = () => location.search;

/** Drop-in for `useSearch` from `wouter/use-browser-location`; pass it as `<Router searchHook>`. */
export const useNextSafeSearch = ({ ssrSearch }: { ssrSearch?: string } = {}) =>
  useSyncExternalStore(
    subscribeToLocationUpdates,
    currentSearch,
    ssrSearch != null ? () => ssrSearch : currentSearch,
  );

/** Drop-in for `useBrowserLocation` from `wouter/use-browser-location`; pass it as `<Router hook>`. */
export const useNextSafeBrowserLocation = ({ ssrPath }: { ssrPath?: string } = {}) =>
  [
    useSyncExternalStore(
      subscribeToLocationUpdates,
      currentPathname,
      ssrPath != null ? () => ssrPath : currentPathname,
    ),
    navigate,
  ] as [string, typeof navigate];

/**
 * wouter's default router (no base, the browser location), on the safe hooks.
 * For components a shell renders outside its dashboard `<Router>`, such as the
 * payment-success dialog, which otherwise fall back to wouter's own hooks.
 */
export function NextSafeBrowserRouter({ children }: { children: ReactNode }) {
  return (
    <Router hook={useNextSafeBrowserLocation} searchHook={useNextSafeSearch}>
      {children}
    </Router>
  );
}
