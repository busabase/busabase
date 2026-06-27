"use client";

import { useEffect, useState } from "react";
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
