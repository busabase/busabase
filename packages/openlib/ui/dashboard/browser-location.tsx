"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { Router } from "wouter";
import { navigate } from "wouter/use-browser-location";

type PopstateInterceptor = (event: PopStateEvent) => void;
let popstateInterception: { current: PopstateInterceptor | null } = { current: null };
if (typeof window !== "undefined") {
  const key = Symbol.for("openlib.browser-location.popstate-interceptor");
  const registry = window as unknown as Record<symbol, typeof popstateInterception | undefined>;
  const existing = registry[key];
  if (existing) {
    popstateInterception = existing;
  } else {
    registry[key] = popstateInterception;
    // Install before location subscribers can unmount a view during traversal.
    window.addEventListener("popstate", (event) => popstateInterception.current?.(event));
  }
}

/** Register the active view's interceptor before browser-location subscribers. */
export function registerPopstateInterceptor(interceptor: PopstateInterceptor): () => void {
  popstateInterception.current = interceptor;
  return () => {
    if (popstateInterception.current === interceptor) popstateInterception.current = null;
  };
}

/**
 * wouter's browser location hooks, safe to run under the Next.js App Router.
 *
 * wouter dispatches history events synchronously. Next's HistoryUpdater writes
 * both pushState and replaceState from useInsertionEffect, and other callers
 * can navigate during a commit without Next's __NA marker. Notifying React in
 * either case schedules an update inside an insertion effect.
 *
 * Keep the URL/history writes synchronous, but notify location subscribers in
 * a microtask after the current commit. Coalesce events within that turn.
 * Cache the accepted URL: an earlier router can render during popstate before
 * the interceptor has rejected traversal, so render must not read location yet.
 */
const events = ["popstate", "pushState", "replaceState", "hashchange"] as const;
const locationSnapshot = {
  pathname: typeof window !== "undefined" ? window.location.pathname : "/",
  search: typeof window !== "undefined" ? window.location.search : "",
};

if (typeof window !== "undefined") {
  // Observe writes even without subscribers. The earlier interceptor can stop
  // a rejected popstate before it changes this snapshot or notifies any hook.
  const updateSnapshot = () => {
    locationSnapshot.pathname = location.pathname;
    locationSnapshot.search = location.search;
  };
  for (const event of events) window.addEventListener(event, updateSnapshot);
}

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

const currentPathname = () => locationSnapshot.pathname;
const currentSearch = () => locationSnapshot.search;

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
