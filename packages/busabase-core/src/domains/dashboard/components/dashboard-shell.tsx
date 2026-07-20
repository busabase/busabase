"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { Toaster } from "kui/sonner";
import {
  Activity,
  FolderOpen,
  Github,
  Images,
  Inbox,
  Plus,
  Search,
  Shield,
  Star,
} from "lucide-react";
import type { NavDropPosition, NavItemAction, NavNodeDropParams } from "openlib/ui/dashboard";
import { DashboardLayout, type NavGroup, type NavItem, NavMain } from "openlib/ui/dashboard";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { coreMessagesByLocale } from "../../../i18n";
import { nodeIconForType } from "../helpers/node-icons";
import type { MoveNodePayload } from "../hooks/use-move-node";
import { NodePermissionsDialog } from "./node-permissions-button";

/** Stable, always-disabled query used in place of `orpc.nodes.listFavorites.queryOptions({})`
 * when a host omitted `orpc` — keeps the `useQuery` call unconditional (rules of
 * hooks) while never actually firing a request. */
const DISABLED_FAVORITES_QUERY = {
  queryKey: ["busabase-dashboard-shell", "favorites-disabled"],
  queryFn: async () => [] as NodeVO[],
  enabled: false,
};

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
  /**
   * Opens the "Install from GitHub" dialog — a sibling of the create entry
   * point, since installing a package is the other way content arrives in a
   * space. Omit to render no entry point at all: both install procedures are
   * gated on the space owner/admin role server-side (a package can carry skills
   * and AirApps, i.e. code this space's agents will execute), so a host that
   * knows the viewer is a plain member should leave this out rather than offer
   * a control that can only end in a FORBIDDEN.
   */
  onInstallClick?: () => void;
  /** Identity + presentation forwarded to the shared `DashboardLayout`. */
  chrome: BusabaseDashboardChrome;
  /**
   * oRPC query utils, needed only to power the sidebar "•••" → Permissions
   * entry (opens the shared `NodePermissionsDialog`). Omit to leave the sidebar
   * without a Permissions action — the node-detail toolbars carry their own
   * `NodePermissionsButton` regardless.
   */
  orpc?: BusabaseQueryUtils;
  /** Active UI locale for the sidebar nav labels (defaults to English). */
  locale?: string;
  /** Optional top-level destinations hidden by a host that exposes them elsewhere. */
  hiddenNavItems?: Array<"assets">;
  /**
   * Wires up sidebar drag-and-drop reordering/reparenting. Omit to leave the
   * tree read-only (no drag handles rendered). The host owns the actual
   * mutation (see `useMoveNode`); this shell only translates a drop into the
   * `{ nodeId, parentNodeId?, position? }` the `nodes.move` endpoint expects.
   */
  onMoveNode?: (payload: MoveNodePayload) => void;
  /**
   * Ids of nodes whose children are currently being lazy-fetched (see
   * `onExpandNode` below) — drives the folder's loading row. Omit/empty when
   * the host doesn't lazy-load (e.g. it fetched the whole tree up front).
   */
  loadingNodeIds?: Set<string>;
  /**
   * Fired when a depth-boundary folder (`node.hasChildren` but no loaded
   * `node.children`) is expanded for the first time. The host owns fetching
   * + caching that folder's children (e.g. via `nodes.list({ parentId,
   * depth })`) and merging the result back into the `nodes` tree passed in —
   * this shell only relays the signal. Omit for a host that always loads the
   * whole tree up front (nothing ever has `hasChildren` with empty
   * `children` in that case, so the affordance never appears).
   */
  onExpandNode?: (nodeId: string) => void;
  /**
   * Server-authoritative "is `nodeId` a descendant of `potentialAncestorId`"
   * check (walks the parentId chain via `nodes.isDescendant`), consulted
   * before COMMITTING a cross-branch drag-and-drop drop — the full tree may
   * not be loaded client-side (lazy-loaded folders), so the local
   * `isValidParentId` walk below is only a fast pre-check/live-drag-visual
   * cue, not the actual gate. Omit when the host always loads the whole tree
   * up front, in which case the local walk alone is already authoritative.
   */
  checkIsDescendant?: (params: { nodeId: string; potentialAncestorId: string }) => Promise<boolean>;
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
  onInstallClick,
  chrome,
  orpc,
  locale,
  hiddenNavItems = [],
  onMoveNode,
  loadingNodeIds,
  onExpandNode,
  checkIsDescendant,
}: BusabaseDashboardShellProps) {
  // The node targeted by the sidebar "•••" → Permissions action; drives the
  // one shared `NodePermissionsDialog` rendered below (only when a host wired
  // `orpc`). Same single-dialog-per-shell pattern as the node-detail toolbars.
  const [permissionsTarget, setPermissionsTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
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

  // Resolves the candidate new parent id for a drop at `position` on `target`
  // — `targetId` itself for "inside", `target`'s own parent for
  // "before"/"after" (a reorder reparents into the target's sibling level).
  // Shared by the local pre-check and the server gate below so both ask the
  // exact same question.
  const candidateParentIdFor = (targetId: string, position: NavDropPosition): string | null => {
    if (position === "inside") return targetId;
    return nodeIndex.get(targetId)?.parentId ?? null;
  };

  const handleNodeDrop = async ({ draggedId, targetId, position }: NavNodeDropParams) => {
    if (!onMoveNode) return;
    // Fast local pre-check (same as the live drag-over cue) — catches every
    // cycle detectable from whatever's currently loaded, and every non-cycle
    // rejection (e.g. dropping "inside" a non-container). Always run first
    // since it's free and covers the common case.
    if (!isDropAllowed(draggedId, targetId, position)) return;
    // Server-authoritative gate for the one thing the local check can't fully
    // rule out: `targetId`'s subtree may extend beyond what's loaded
    // client-side (lazy-loaded folders), so a candidate parent that's
    // actually a descendant of `draggedId` through an unloaded branch would
    // otherwise slip past `isValidParentId`'s local walk. Skipped when the
    // host doesn't supply `checkIsDescendant` (it always loads the whole
    // tree up front, so the local walk is already authoritative there).
    const candidateParentId = candidateParentIdFor(targetId, position);
    if (checkIsDescendant && candidateParentId !== null) {
      if (candidateParentId === draggedId) return;
      const candidateIsDescendantOfDragged = await checkIsDescendant({
        nodeId: candidateParentId,
        potentialAncestorId: draggedId,
      });
      if (candidateIsDescendantOfDragged) return;
    }
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

  // Notion-style Favorites: the current actor's favorited nodes, kept in their
  // own TanStack Query entry (invalidated after every toggle below) — never
  // wired when a host omitted `orpc` (same gate the Permissions action uses),
  // in which case `DISABLED_FAVORITES_QUERY` keeps the `useQuery` call itself
  // unconditional (rules of hooks) while never firing a request.
  const queryClient = useQueryClient();
  const favoritesQuery = useQuery(
    orpc ? orpc.nodes.listFavorites.queryOptions({}) : DISABLED_FAVORITES_QUERY,
  );
  const favoriteNodes = favoritesQuery.data ?? [];
  const favoriteNodeIds = useMemo(
    () => new Set(favoriteNodes.map((node) => node.id)),
    [favoriteNodes],
  );
  const toggleFavoriteMutation = useMutation(
    orpc
      ? orpc.nodes.toggleFavorite.mutationOptions()
      : { mutationFn: async () => Promise.reject(new Error("Favorites require orpc")) },
  );
  // Plain invalidate-and-refetch (no optimistic cache write): the Favorites
  // list is small and this keeps the toggle handler simple — P0 tradeoff, see
  // the sidebar-favorites spec's Roadmap for the optimistic-update follow-up.
  const handleToggleFavorite = useCallback(
    (node: NodeVO) => {
      if (!orpc) return;
      const wasFavorited = favoriteNodeIds.has(node.id);
      toggleFavoriteMutation.mutate(
        { nodeId: node.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: orpc.nodes.listFavorites.queryOptions({}).queryKey,
            });
            toast.success(messages.favorites.updated);
          },
          onError: () => {
            toast.error(
              wasFavorited ? messages.favorites.removeFailed : messages.favorites.addFailed,
            );
          },
        },
      );
    },
    [
      orpc,
      queryClient,
      favoriteNodeIds,
      toggleFavoriteMutation,
      messages.favorites.updated,
      messages.favorites.removeFailed,
      messages.favorites.addFailed,
    ],
  );

  // Single source of truth for "top-level after root-unwrap" — the exact
  // NavItem list rendered as the Bases tree's top level today. Hoisted into
  // its own memo (rather than an inline call) so it can be reused as-is by
  // the sidebar without recomputing per render.
  const baseNavItems = useMemo(
    () =>
      buildKnowledgeBaseItems(
        nodes,
        (node) => onCreateClick({ id: node.id, name: node.name }),
        {
          newLabel: nav.new,
          openLabel: messages.common.open,
          permissionsLabel: messages.permissions.title,
          favoriteAddLabel: messages.favorites.add,
          favoriteRemoveLabel: messages.favorites.remove,
        },
        loadingNodeIds,
        // Only offer the sidebar Permissions action when a host wired orpc — the
        // dialog can't do anything without it.
        orpc ? (node) => setPermissionsTarget({ id: node.id, name: node.name }) : undefined,
        // Same orpc gate for the Favorites toggle action — no persistence layer
        // to call without it.
        orpc ? { favoriteNodeIds, onToggle: handleToggleFavorite } : undefined,
      ),
    [
      nodes,
      onCreateClick,
      nav.new,
      messages.common.open,
      messages.permissions.title,
      messages.favorites.add,
      messages.favorites.remove,
      loadingNodeIds,
      orpc,
      favoriteNodeIds,
      handleToggleFavorite,
    ],
  );

  // Favorites nav group: a FLAT list of the actor's favorited nodes (already
  // fully resolved `NodeVO`s from `nodes.listFavorites`, not a tree to walk),
  // built via the same `buildNavItem` every Bases-tree row uses — see
  // `buildFavoriteItems` below for why each result is flattened to a plain,
  // non-expandable row. Only ever rendered non-empty (see `scrollNav` below),
  // mirroring the existing `scrollShortcutItems.length > 0` pattern.
  const favoriteNavItems = useMemo(
    () =>
      buildFavoriteItems(
        favoriteNodes,
        {
          openLabel: messages.common.open,
          permissionsLabel: messages.permissions.title,
          favoriteAddLabel: messages.favorites.add,
          favoriteRemoveLabel: messages.favorites.remove,
        },
        orpc ? (node) => setPermissionsTarget({ id: node.id, name: node.name }) : undefined,
        orpc ? { favoriteNodeIds, onToggle: handleToggleFavorite } : undefined,
      ),
    [
      favoriteNodes,
      messages.common.open,
      messages.permissions.title,
      messages.favorites.add,
      messages.favorites.remove,
      orpc,
      favoriteNodeIds,
      handleToggleFavorite,
    ],
  );

  const scrollShortcutItems: NavItem[] = [
    { title: nav.activity, url: "/activity", icon: Activity },
    ...(hiddenNavItemSet.has("assets")
      ? []
      : [{ title: assetsLabel, url: "/assets", icon: Images }]),
    // Sits with the other sidebar shortcuts rather than competing with the
    // Bases group's "+": creating an item and installing a package are siblings,
    // but only one of them is the everyday action. Rendered only when the host
    // wired a handler (see `onInstallClick` — it is the admin gate).
    ...(onInstallClick
      ? [{ title: nav.installFromGithub, url: "", icon: Github, onClick: "install-from-github" }]
      : []),
  ];
  // Pinned nav (fixed at the top, never scrolls): Inbox + Search only —
  // everything else (Activity, Favorites, Bases) scrolls underneath, same
  // convention as apps/buda's own locked-header sidebar.
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
      ],
    },
  ];

  // Scrollable nav (everything below the pinned header): optional shortcuts +
  // Favorites (only when non-empty) + Bases tree.
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
    // An empty Favorites section is exactly the clutter this feature is meant
    // to reduce — only rendered once the actor has favorited at least one
    // (still-visible, non-archived) node.
    ...(favoriteNavItems.length > 0
      ? [
          {
            label: nav.favorites,
            items: favoriteNavItems,
            className: "group-data-[collapsible=icon]:hidden",
          },
        ]
      : []),
    {
      label: basesLabel,
      items: baseNavItems,
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
    if (action === "install-from-github") {
      onInstallClick?.();
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
              onExpand={onExpandNode ? (item) => item.id && onExpandNode(item.id) : undefined}
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
      {orpc && permissionsTarget && (
        <NodePermissionsDialog
          nodeId={permissionsTarget.id}
          nodeName={permissionsTarget.name}
          onOpenChange={(next) => {
            if (!next) setPermissionsTarget(null);
          }}
          open
          orpc={orpc}
        />
      )}
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

interface NavItemLabels {
  newLabel: string;
  openLabel: string;
  permissionsLabel: string;
  favoriteAddLabel: string;
  favoriteRemoveLabel: string;
}

/**
 * Wires the sidebar "•••" → "Add to Favorites"/"Remove from Favorites" toggle
 * (label reflects current state) into `buildNavItem` — omit to leave the
 * action off entirely (no host wired `orpc`, same gate the Permissions action
 * uses, since there's no persistence layer to call without it).
 */
interface FavoriteActionContext {
  favoriteNodeIds: Set<string>;
  onToggle: (node: NodeVO) => void;
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
 *
 * `node.hasChildren`/`node.children` carry through to `NavItem.hasChildren`
 * regardless of depth: a node sitting at a `nodes.list` depth boundary has
 * `children: []` but `hasChildren: true`, so it still renders as an
 * expandable folder (NavMain) with an `onExpand` affordance instead of
 * silently looking like an empty leaf. `loadingNodeIds` (host-supplied,
 * populated while a lazy per-folder fetch is in flight) drives the row's
 * loading state for exactly that case.
 */
function buildNavItem(
  node: NodeVO,
  onCreateChild: (node: NodeVO) => void,
  labels: NavItemLabels,
  loadingNodeIds?: Set<string>,
  onOpenPermissions?: (node: NodeVO) => void,
  favoriteContext?: FavoriteActionContext,
): NavItem[] {
  if (hasCapability(node.type, "hidden")) return [];
  const icon = nodeIconForType(node.type);
  // The "•••" Permissions action, shared by container and leaf rows so every
  // node type surfaced in the sidebar can be managed in place (matches buda's
  // per-agent Permissions menu entry). Only present when the host wired orpc.
  const permissionsAction: NavItemAction | null = onOpenPermissions
    ? {
        title: labels.permissionsLabel,
        icon: Shield,
        onSelect: () => onOpenPermissions(node),
      }
    : null;
  // The "•••" Favorites toggle — same shared mechanism, one click, same menu
  // as Open/Permissions (see apps/busabase/content/spec/sidebar-favorites.md).
  // Label reflects the node's CURRENT membership in `favoriteNodeIds`, so a
  // freshly-favorited row immediately reads "Remove from Favorites" the next
  // time this menu opens (driven by the `nodes.listFavorites` query, refetched
  // after every toggle).
  const favoriteAction: NavItemAction | null = favoriteContext
    ? {
        title: favoriteContext.favoriteNodeIds.has(node.id)
          ? labels.favoriteRemoveLabel
          : labels.favoriteAddLabel,
        icon: Star,
        onSelect: () => favoriteContext.onToggle(node),
      }
    : null;
  if (hasCapability(node.type, "container")) {
    const url = nodeHref(node) ?? "";
    return [
      {
        title: node.name,
        url,
        icon,
        id: node.id,
        items: buildNavChildren(
          node,
          onCreateChild,
          labels,
          loadingNodeIds,
          onOpenPermissions,
          favoriteContext,
        ),
        hasChildren: node.hasChildren ?? node.children.length > 0,
        isLoadingChildren: loadingNodeIds?.has(node.id) ?? false,
        onAddChild: () => onCreateChild(node),
        addChildTitle: labels.newLabel,
        actions: [
          ...(url ? [{ title: labels.openLabel, url, icon: FolderOpen }] : []),
          ...(permissionsAction ? [permissionsAction] : []),
          ...(favoriteAction ? [favoriteAction] : []),
        ],
      },
    ];
  }
  const url = nodeHref(node);
  const leafActions = [
    ...(permissionsAction ? [permissionsAction] : []),
    ...(favoriteAction ? [favoriteAction] : []),
  ];
  return url
    ? [
        {
          title: node.name,
          url,
          icon,
          id: node.id,
          actions: leafActions.length > 0 ? leafActions : undefined,
        },
      ]
    : [];
}

// Recursively build every child of `node` as a NavItem — a container child
// becomes its own nested collapsible folder (via `buildNavItem`'s recursive
// call back into this function for ITS children), a detail-bearing child
// becomes a plain leaf row, at any depth. `node.children` is `[]` for a node
// sitting exactly at a `nodes.list` depth boundary (see `buildNavItem`), so
// this naturally returns `[]` there too — the boundary's `hasChildren: true`
// is what keeps it rendering as an (empty, expandable) folder rather than
// collapsing into a leaf.
function buildNavChildren(
  node: NodeVO,
  onCreateChild: (node: NodeVO) => void,
  labels: NavItemLabels,
  loadingNodeIds?: Set<string>,
  onOpenPermissions?: (node: NodeVO) => void,
  favoriteContext?: FavoriteActionContext,
): NavItem[] {
  return node.children.flatMap((child) =>
    buildNavItem(child, onCreateChild, labels, loadingNodeIds, onOpenPermissions, favoriteContext),
  );
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
  labels: NavItemLabels,
  loadingNodeIds?: Set<string>,
  onOpenPermissions?: (node: NodeVO) => void,
  favoriteContext?: FavoriteActionContext,
): NavItem[] {
  const top =
    nodes.length === 1 && hasCapability(nodes[0].type, "container") && !nodes[0].baseId
      ? nodes[0].children
      : nodes;

  return top.flatMap((node) =>
    buildNavItem(node, onCreateChild, labels, loadingNodeIds, onOpenPermissions, favoriteContext),
  );
}

// A favorited node's own NavItem stripped of every container-only field
// (`items`/`hasChildren`/`isLoadingChildren`/`onAddChild`/`addChildTitle`) —
// every node type the sidebar renders has its own detail-page url (see
// `nodeHref`), so this never loses navigability, only the (here meaningless,
// since a favorited NodeVO carries no live `children`) folder chrome a
// container-type favorite would otherwise render.
function toFlatFavoriteNavItem(item: NavItem): NavItem {
  const {
    items: _items,
    hasChildren: _hasChildren,
    isLoadingChildren: _isLoadingChildren,
    onAddChild: _onAddChild,
    addChildTitle: _addChildTitle,
    ...rest
  } = item;
  return rest;
}

/**
 * Build the Favorites nav group from a FLAT list of already-resolved
 * `NodeVO`s (`nodes.listFavorites`'s result) — NOT a tree to walk, unlike
 * `buildKnowledgeBaseItems` above. Reuses `buildNavItem` (same
 * title/icon/actions treatment every Bases-tree row gets, including the
 * Favorites toggle itself so "Remove from Favorites" is available right from
 * this group too) against each node with no `onCreateChild` affordance (a
 * Favorites shortcut row never offers "add child here"), then flattens away
 * any container-only fields the underlying node type might otherwise render.
 */
function buildFavoriteItems(
  favoriteNodes: NodeVO[],
  labels: Pick<
    NavItemLabels,
    "openLabel" | "permissionsLabel" | "favoriteAddLabel" | "favoriteRemoveLabel"
  >,
  onOpenPermissions?: (node: NodeVO) => void,
  favoriteContext?: FavoriteActionContext,
): NavItem[] {
  // `newLabel` (the "+ New" child-create affordance) never surfaces here — a
  // Favorites shortcut row has no `onAddChild` — so an empty string is safe.
  const itemLabels: NavItemLabels = { newLabel: "", ...labels };
  return favoriteNodes.flatMap((node) =>
    buildNavItem(
      node,
      () => undefined,
      itemLabels,
      undefined,
      onOpenPermissions,
      favoriteContext,
    ).map(toFlatFavoriteNavItem),
  );
}
