import type { LucideIcon } from "lucide-react";
import { Activity, Inbox, Table2 } from "lucide-react";
import { getBusabaseAppLL } from "~/lib/i18n";

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

export const getSecondarySidebarNav = (locale?: string): Record<string, SecondaryNavConfig> => {
  const LL = getBusabaseAppLL(locale);

  return {
    Review: {
      type: "menu",
      label: LL.navigation.review(),
      items: [
        { title: LL.navigation.inbox(), url: "/inbox", icon: Inbox },
        { title: LL.navigation.activity(), url: "/activity", icon: Activity },
      ],
    },
    Base: {
      type: "menu",
      label: LL.navigation.base(),
      items: [{ title: LL.navigation.blogPosts(), url: "/base/blog", icon: Table2 }],
    },
  };
};
