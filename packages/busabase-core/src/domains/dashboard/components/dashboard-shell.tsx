"use client";

import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { Toaster } from "kui/sonner";
import { Activity, FolderOpen, Images, Inbox, Plus, Search } from "lucide-react";
import type { NavDropPosition, NavNodeDropParams } from "openlib/ui/dashboard";
import { DashboardLayout, type NavGroup, type NavItem, NavMain } from "openlib/ui/dashboard";
import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import { coreMessagesByLocale } from "../../../i18n";
import { nodeIconForType } from "../helpers/node-icons";
import type { MoveNodePayload } from "../hooks/use-move-node";

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
  | "hideSidebarTrigger"
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
  /**
   * Wires up sidebar drag-and-drop reordering/reparenting. Omit to leave the
   * tree read-only (no drag handles rendered). The host owns the actual
   * mutation (see `useMoveNode`); this shell only translates a drop into the
   * `{ nodeId, parentNodeId?, position? }` the `nodes.move` endpoint expects.
   */
  onMoveNode?: (payload: MoveNodePayload) => void;
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
  onMoveNode,
}: BusabaseDashboardShellProps) {
  // Flat id → NodeVO index over the REAL tree (not the display-flattened
  // NavItem tree) so drag-and-drop can check a drop target's actual type and
  // walk its true ancestor chain, regardless of how the sidebar visually
  // nests/unwraps folders.
  const nodeIndex = useMemo(() => {
    const map = new Map<string, NodeVO>();
    const visit = (list: NodeVO[]) => {
      for (const node of list) {
        map.set(node.id, node);
        if (node.children.length > 0) visit(node.children);
      }
    };
    visit(nodes);
    return map;
  }, [nodes]);

  // A node may only become the child of `parentId` if that parent isn't the
  // node itself or one of its own descendants (would orphan the subtree in a
  // cycle). `parentId === null` means the space root, which is always valid.
  // Mirrors the server-side guard in `mergeNodeMove`.
  const isValidParentId = (draggedId: string, parentId: string | null): boolean => {
    if (parentId === null) return true;
    if (parentId === draggedId) return false;
    let cursor: NodeVO | undefined = nodeIndex.get(parentId);
    while (cursor) {
      if (cursor.id === draggedId) return false;
      cursor = cursor.parentId ? nodeIndex.get(cursor.parentId) : undefined;
    }
    return true;
  };

  // Shared by both the live drag-over indicator (NavMain's `isDropAllowed`
  // prop) and the final drop handler below, for EVERY drop position — not
  // just "inside". A "before"/"after" drop reparents the dragged node into
  // the target's OWN parent, which is just as capable of creating a cycle
  // (drag an ancestor folder to sit as a sibling inside one of its own
  // descendants) as dropping directly "inside" a descendant is. The one
  // "inside"-only extra rule: the target itself must actually be a container.
  const isDropAllowed = (
    draggedId: string,
    targetId: string,
    position: NavDropPosition,
  ): boolean => {
    const target = nodeIndex.get(targetId);
    if (!target) return false;
    if (position === "inside") {
      return hasCapability(target.type, "container") && isValidParentId(draggedId, targetId);
    }
    return isValidParentId(draggedId, target.parentId ?? null);
  };

  const handleNodeDrop = ({ draggedId, targetId, position }: NavNodeDropParams) => {
    if (!onMoveNode) return;
    if (!isDropAllowed(draggedId, targetId, position)) return;
    if (position === "inside") {
      const target = nodeIndex.get(targetId);
      onMoveNode({
        nodeId: draggedId,
        parentNodeId: targetId,
        position: target?.children.length ?? 0,
      });
      return;
    }
    const target = nodeIndex.get(targetId);
    if (!target) return;
    onMoveNode({
      nodeId: draggedId,
      parentNodeId: target.parentId ?? undefined,
      position: position === "before" ? target.position : target.position + 1,
    });
  };

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
              onNodeDrop={onMoveNode ? handleNodeDrop : undefined}
              isDropAllowed={onMoveNode ? isDropAllowed : undefined}
            />
          </div>
        }
        onHeaderActionClick={handleHeaderActionClick}
        onNavItemAction={handleNavItemAction}
        headerClassName="!h-0 !min-h-0 overflow-hidden border-0"
        hideSidebarTrigger
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

/**
 * Build the NavItem(s) for a single node — a collapsible folder row (with its
 * own recursively-built `items`) if the node is a container, otherwise a plain
 * clickable leaf row if it has a detail screen, otherwise nothing. Applied at
 * EVERY depth (both at the top of `buildKnowledgeBaseItems` and recursively
 * via `buildNavChildren`), so a folder nested arbitrarily deep gets the exact
 * same chevron/add-child/actions treatment as a top-level one — the sidebar
 * (NavMain) renders `NavItem.items` recursively, so nothing here needs to
 * flatten nested folders away anymore.
 */
function buildNavItem(
  node: NodeVO,
  onCreateChild: (node: NodeVO) => void,
  labels: { newLabel: string; openLabel: string },
): NavItem[] {
  if (hasCapability(node.type, "hidden")) return [];
  const icon = nodeIconForType(node.type);
  if (hasCapability(node.type, "container")) {
    const url = nodeHref(node) ?? "";
    return [
      {
        title: node.name,
        url,
        icon,
        id: node.id,
        items: buildNavChildren(node, onCreateChild, labels),
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
  return url ? [{ title: node.name, url, icon, id: node.id }] : [];
}

// Recursively build every child of `node` as a NavItem — a container child
// becomes its own nested collapsible folder (via `buildNavItem`'s recursive
// call back into this function for ITS children), a detail-bearing child
// becomes a plain leaf row, at any depth.
function buildNavChildren(
  node: NodeVO,
  onCreateChild: (node: NodeVO) => void,
  labels: { newLabel: string; openLabel: string },
): NavItem[] {
  return node.children.flatMap((child) => buildNavItem(child, onCreateChild, labels));
}

/**
 * Build the Bases nav from the node tree, preserving structure. Container types
 * become collapsible parents (detail-bearing descendants nested underneath, at
 * any depth); other detail types are clickable rows. A single root container
 * is unwrapped.
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

  return top.flatMap((node) => buildNavItem(node, onCreateChild, labels));
}
