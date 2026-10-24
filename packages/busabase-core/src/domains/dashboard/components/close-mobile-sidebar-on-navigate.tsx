"use client";

import { useSidebar } from "kui/sidebar";
import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * On a phone the sidebar is a drawer laid over the page, so picking a node in it
 * should reveal that node: close the drawer when the route's path changes.
 *
 * Keyed on the path only, so a filter or view-state change in the query string
 * leaves an open drawer alone. On desktop the drawer state is unused and closing
 * it is a no-op. Render it anywhere under both a `SidebarProvider` and the
 * wouter `Router` the sidebar's links navigate through.
 */
export function CloseMobileSidebarOnNavigate() {
  const [location] = useLocation();
  const { setOpenMobile } = useSidebar();
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes on every path change
  useEffect(() => {
    setOpenMobile(false);
  }, [location, setOpenMobile]);
  return null;
}
