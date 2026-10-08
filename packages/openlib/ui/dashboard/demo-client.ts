"use client";

import { useCallback, useEffect, useState } from "react";
import { useBrowserLocation } from "wouter/use-browser-location";
import { addDemoParam, resolveDemoMode } from "./demo";

/**
 * Whether the page is in demo mode. Resolved AFTER mount (starts `false`) to avoid
 * SSR/client hydration mismatches.
 */
export function useDemoMode(): boolean {
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => {
    setIsDemo(resolveDemoMode().useCase !== null);
  }, []);
  return isDemo;
}

/**
 * A URL transformer that appends the active `?demo` (and `?lang`) so the demo
 * survives SPA navigation. Identity until mounted / outside demo mode.
 */
export function useAddDemoParam(): (url: string) => string {
  return useDemoMode() ? addDemoParam : (url) => url;
}

/**
 * wouter location hook for every dashboard `<Router hook={...}>`.
 *
 * Demo mode is detected client-side from the `?demo=1` query param (the oRPC
 * client injects `x-demo-mode` from it on every call). wouter's default
 * navigate drops the query string, so any in-app navigation would silently
 * exit demo mode — backend calls then hit the real router and 401. This
 * location hook re-appends the active demo params (`addDemoParam`: `?demo`, plus
 * `?lang` for a zh-CN demo) to every SPA navigation so demo survives clicking
 * around. Non-demo users are unaffected (`addDemoParam` is a no-op outside demo
 * mode), and the banner's "Exit demo mode" link is a plain `<a href>` (full
 * reload) that bypasses this hook.
 */
export const useDemoPreservingLocation: typeof useBrowserLocation = (options) => {
  const [path, navigate] = useBrowserLocation(options);
  const demoNavigate = useCallback<typeof navigate>(
    (to, navOptions) =>
      navigate(
        typeof to === "string" && typeof window !== "undefined" ? addDemoParam(to) : to,
        navOptions,
      ),
    [navigate],
  );
  return [path, demoNavigate];
};
