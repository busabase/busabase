"use client";

import { usePathname, useSearchParams } from "next/navigation";
import NProgress from "nprogress";
import { useCallback, useEffect } from "react";
import { configureNProgress } from "./nprogress-config";

/**
 * NProgressProvider
 *
 * Integrates NProgress with Next.js App Router navigation.
 * Automatically shows/hides the progress bar on route changes.
 *
 * Features:
 * - Auto-intercepts all internal link clicks to show progress
 * - Works with next/link, Fumadocs links, and any <a> tags
 * - No need to use special Link components
 *
 * Usage:
 * Place this component in a client layout that wraps your pages.
 * It will automatically track navigation using Next.js hooks.
 */
export function NProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Global click handler to intercept all internal link clicks
  const handleGlobalClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");

      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Skip if:
      // - Default prevented (handled elsewhere)
      // - External links (http://, https://, mailto:, tel:, etc.)
      // - Hash-only links (#section)
      // - target="_blank" links
      // - Download links
      // - Modified clicks (ctrl/cmd/shift/alt + click)
      if (
        e.defaultPrevented ||
        href.startsWith("http") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#") ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }

      // Parse the href to check if it's same-page navigation
      try {
        const url = new URL(href, window.location.origin);
        const currentPath =
          pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
        const targetPath = url.pathname + url.search;

        // Skip if navigating to the same page (only hash change)
        if (url.pathname === pathname && url.hash) {
          return;
        }

        // Skip if it's exactly the same URL
        if (targetPath === currentPath) {
          return;
        }
      } catch {
        // If URL parsing fails, proceed with showing progress
      }

      // Start progress for internal navigation
      NProgress.start();
    },
    [pathname, searchParams],
  );

  useEffect(() => {
    // Configure NProgress on mount
    configureNProgress();

    // Add global click listener in capture phase to catch events before they're handled
    document.addEventListener("click", handleGlobalClick, true);
    return () => document.removeEventListener("click", handleGlobalClick, true);
  }, [handleGlobalClick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: We need pathname and searchParams to trigger on route changes
  useEffect(() => {
    // When pathname or searchParams change, it means navigation completed
    // So we stop the progress bar
    NProgress.done();
  }, [pathname, searchParams]);

  return <>{children}</>;
}
