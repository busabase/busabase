import type { LucideIcon } from "lucide-react";
import { Activity, Inbox, Table2 } from "lucide-react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

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

export const getSecondarySidebarNav = (
  LL: TranslationFunctions,
): Record<string, SecondaryNavConfig> => {
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
