"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { Router } from "wouter";
import { navigate } from "wouter/use-browser-location";

/**
 * wouter's browser location hooks, safe to run under the Next.js App Router.
 *
 * wouter patches `history.pushState`/`replaceState` to dispatch a same-named
 * event synchronously, and its hooks notify React from that event. The App
 * Router writes its own bookkeeping with `history.replaceState` from inside a
 * `useInsertionEffect` (on every back/forward navigation), so each component
 * subscribed to the location scheduled a React update during an insertion
 * effect: "useInsertionEffect must not schedule updates", logged once per
 * subscriber (about a hundred per Back in the Busabase dashboard) and shown as
 * an Issue in the Next dev overlay.
 *
 * Those writes keep the URL as it is, and the navigation they follow was
 * already announced by `popstate`, so they are delivered a microtask later,
 * after the commit. Every other event (popstate, pushState, any other
 * replaceState, hashchange) is delivered synchronously, as wouter does.
 */

const events = ["popstate", "pushState", "replaceState", "hashchange"] as const;

/** Next.js marks the history entries it writes with `__NA` (see its HistoryUpdater). */
const isNextRouterBookkeeping = (event: Event) => {
  if (event.type !== "replaceState") return false;
  const state = (event as Event & { arguments?: unknown[] }).arguments?.[0];
  return Boolean(state && typeof state === "object" && "__NA" in state);
};

const subscribeToLocationUpdates = (callback: () => void) => {
  let active = true;
  const onEvent = (event: Event) => {
    if (!isNextRouterBookkeeping(event)) {
      callback();
      return;
    }
    queueMicrotask(() => {
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
