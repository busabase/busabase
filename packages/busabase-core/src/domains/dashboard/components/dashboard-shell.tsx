"use client";

import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { Toaster } from "kui/sonner";
import { Activity, FolderOpen, Images, Inbox, type LucideIcon, Plus, Search } from "lucide-react";
import { DashboardLayout, type NavGroup, type NavItem, NavMain } from "openlib/ui/dashboard";
import type { ComponentProps, ReactNode } from "react";
import { coreMessagesByLocale } from "../../../i18n";
import { nodeIconForType } from "../helpers/node-icons";

const isCoreLocale = (locale: string | undefined): locale is keyof typeof coreMessagesByLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

type DashboardLayoutProps = ComponentProps<typeof DashboardLayout>;

/**
 * Host-supplied identity + presentation for the workbench shell — the ONLY thing
 * that differs between the single-tenant open-source app (local stubs,
 * `hideUserMenu`, custom `sidebarHeader`) and the cloud (real session, Space
 * Selector, User menu). Everything else (the node-tree nav, the create/search
 * actions, the layout structure) is shared here.
 */
export type BusabaseDashboardChrome = Omit<
  DashboardLayoutProps,
  | "children"
  | "navMain"
  | "onHeaderActionClick"
  | "onNavItemAction"
  | "className"
  | "headerClassName"
  | "pageClassName"
  | "sidebarClassName"
  | "defaultOpen"
>;

interface BusabaseDashboardShellProps {
  children: ReactNode;
  nodes: NodeVO[];
  activeChangeRequestCount: number;
  onSearchClick: () => void;
  onCreateClick: (parent?: { id: string; name: string }) => void;
  /** Identity + presentation forwarded to the shared `DashboardLayout`. */
  chrome: BusabaseDashboardChrome;
  /** Active UI locale for the sidebar nav labels (defaults to English). */
  locale?: string;
  /** Optional top-level destinations hidden by a host that exposes them elsewhere. */
  hiddenNavItems?: Array<"assets">;
  /** Optional top-level destinations pinned with Inbox/Search by a host. */
  pinnedNavItems?: Array<"activity">;
}

/**
 * The Busabase workbench chrome (sidebar node tree + header), shared by every host.
 * Builds the nav from the space's node tree and renders sharelib's
 * `DashboardLayout`; the host passes its `chrome` (real session in the cloud,
 * local stubs in the open-source app).
 */
export function BusabaseDashboardShell({
  children,
  nodes,
  activeChangeRequestCount,
  onSearchClick,
  onCreateClick,
  chrome,
  locale,
  hiddenNavItems = [],
  pinnedNavItems = [],
}: BusabaseDashboardShellProps) {
  const messages = isCoreLocale(locale) ? coreMessagesByLocale[locale] : coreMessagesByLocale.en;
  const nav = messages.nav;
  // The "Bases" group label doubles as the header-action key, so reuse one value.
  const basesLabel = nav.bases;
  const assetsLabel = nav.assets;
  const hiddenNavItemSet = new Set(hiddenNavItems);
  const pinnedNavItemSet = new Set(pinnedNavItems);
  const scrollShortcutItems: NavItem[] = [
    ...(pinnedNavItemSet.has("activity")
      ? []
      : [{ title: nav.activity, url: "/activity", icon: Activity }]),
    ...(hiddenNavItemSet.has("assets")
      ? []
      : [{ title: assetsLabel, url: "/assets", icon: Images }]),
  ];
  // Pinned nav (fixed at the top, never scrolls): Inbox + Search + optional host shortcuts.
  const pinnedNav: NavGroup[] = [
    {
      label: "",
      // Trim the group's bottom padding (p-2 → pb-1 = 4px) so the gap between
      // the pinned Search row and the first scroll item (Activity) equals the
      // 4px gap between menu items — originally these were consecutive rows, so
      // the split must be invisible.
      className: "pb-1",
      items: [
        {
          title: nav.inbox,
          url: "/inbox",
          icon: Inbox,
          badge: activeChangeRequestCount || undefined,
        },
        { title: nav.search, url: "", icon: Search, onClick: "search" },
        ...(pinnedNavItemSet.has("activity")
          ? [{ title: nav.activity, url: "/activity", icon: Activity }]
          : []),
      ],
    },
  ];

  // Scrollable nav (everything below the pinned header): optional shortcuts + Bases tree.
  const scrollNav: NavGroup[] = [
    ...(scrollShortcutItems.length > 0
      ? [
          {
            label: "",
            // Flush top (pt-0) so Activity sits 4px under the pinned Search row, while
            // keeping the default bottom padding (pb-2) so the gap down to the Bases
            // section header is unchanged.
            className: "pt-0",
            items: scrollShortcutItems,
          },
        ]
      : []),
    {
      label: basesLabel,
      items: buildKnowledgeBaseItems(
        nodes,
        (node) => onCreateClick({ id: node.id, name: node.name }),
        { newLabel: nav.new, openLabel: messages.common.open },
      ),
      headerAction: Plus,
      headerActionTitle: nav.new,
      className: "group-data-[collapsible=icon]:hidden",
    },
  ];

  const handleHeaderActionClick = (groupLabel: string) => {
    if (groupLabel === basesLabel) {
      onCreateClick();
    }
  };
  const handleNavItemAction = (action: string) => {
    if (action === "search") {
      onSearchClick();
    }
  };

  return (
    <div data-busabase-dashboard-layout className="h-full min-h-0">
      <Toaster position="top-right" />
      <DashboardLayout
        {...chrome}
        className="h-full min-h-0"
        defaultOpen
        navMain={pinnedNav}
        sidebarExtra={
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden group-data-[collapsible=icon]:overflow-hidden">
            <NavMain
              items={scrollNav}
              onHeaderActionClick={handleHeaderActionClick}
              onNavItemAction={handleNavItemAction}
            />
          </div>
        }
        onHeaderActionClick={handleHeaderActionClick}
        onNavItemAction={handleNavItemAction}
        headerClassName="!h-0 !min-h-0 overflow-hidden border-0"
        pageClassName="gap-0 p-0"
        sidebarClassName="h-full"
      >
        {children}
      </DashboardLayout>
    </div>
  );
}

// Resolve a node's dashboard URL (null if it has no detail screen).
// Base nodes carry their own slug — no need to cross-reference the bases list.
function nodeHref(node: NodeVO): string | null {
  if (node.type === "base") {
    return node.slug ? `/base/${node.slug}` : null;
  }
  return hasCapability(node.type, "hasDetail") ? `/${node.type}/${node.slug}` : null;
}

// Collect every navigable leaf (a node with a detail screen) under a node as flat
// sub-items (the sidebar nests one level).
function collectNavLeaves(node: NodeVO): { title: string; url: string; icon: LucideIcon }[] {
  return node.children.flatMap((child) => {
    if (hasCapability(child.type, "hidden")) return [];
    const url = nodeHref(child);
    return [
      ...(url ? [{ title: child.name, url, icon: nodeIconForType(child.type) }] : []),
      ...collectNavLeaves(child),
    ];
  });
}

/**
 * Build the Bases nav from the node tree, preserving structure. Container types
 * become collapsible parents (detail-bearing descendants nested underneath);
 * other detail types are clickable rows. A single root container is unwrapped.
 */
function buildKnowledgeBaseItems(
  nodes: NodeVO[],
  onCreateChild: (node: NodeVO) => void,
  labels: { newLabel: string; openLabel: string },
): NavItem[] {
  const top =
    nodes.length === 1 && hasCapability(nodes[0].type, "container") && !nodes[0].baseId
      ? nodes[0].children
      : nodes;

  return top.flatMap((node): NavItem[] => {
    if (hasCapability(node.type, "hidden")) return [];
    const icon = nodeIconForType(node.type);
    if (hasCapability(node.type, "container")) {
      const url = nodeHref(node) ?? "";
      return [
        {
          title: node.name,
          url,
          icon,
          items: collectNavLeaves(node),
          onAddChild: () => onCreateChild(node),
          addChildTitle: labels.newLabel,
          actions: url
            ? [
                {
                  title: labels.openLabel,
                  url,
                  icon: FolderOpen,
                },
              ]
            : [],
        },
      ];
    }
    const url = nodeHref(node);
    return url ? [{ title: node.name, url, icon }] : [];
  });
}
