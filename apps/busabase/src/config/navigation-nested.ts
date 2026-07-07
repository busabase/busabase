import type { LucideIcon } from "lucide-react";
import { Activity, Inbox, Table2 } from "lucide-react";

export interface SecondaryNavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
}

export interface SecondaryNavConfig {
  type: "menu";
  label?: string;
  items: SecondaryNavItem[];
  showHeaderAction?: boolean;
}

export const getSecondarySidebarNav = (): Record<string, SecondaryNavConfig> => ({
  Review: {
    type: "menu",
    label: "Review",
    items: [
      { title: "Inbox", url: "/inbox", icon: Inbox },
      { title: "Activity", url: "/activity", icon: Activity },
    ],
  },
  Base: {
    type: "menu",
    label: "Base",
    items: [{ title: "Blog Posts", url: "/base/blog", icon: Table2 }],
  },
});
