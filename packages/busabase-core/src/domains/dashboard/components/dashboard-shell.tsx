"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { isEmbeddableNodeType } from "busabase-contract/contract/embed-link-schemas";
import type { SharedNodeVO } from "busabase-contract/contract/schemas";
import { hasCapability, publicAccessOf } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "kui/sidebar";
import { Skeleton } from "kui/skeleton";
import { Toaster } from "kui/sonner";
import {
  Activity,
  Archive,
  Bot,
  FolderOpen,
  FolderTree,
  Globe,
  House,
  Images,
  Inbox,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Settings,
  Shapes,
  Shield,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import type { NavDropPosition, NavItemAction, NavNodeDropParams } from "openlib/ui/dashboard";
import { DashboardLayout, type NavGroup, type NavItem, NavMain } from "openlib/ui/dashboard";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { CoreI18nProvider, coreMessagesByLocale } from "../../../i18n";
import { AirAppEngineAvailabilityProvider } from "../../airapp/components/engine-availability-context";
import type { AirAppRunnerKind } from "../../airapp/components/runners/types";
import {
  createKnownNodeCache,
  type KnownNode,
  knownNodeCacheScope,
} from "../helpers/known-node-cache";
import { nodeIconGlyph, resolveNodeIcon } from "../helpers/node-icons";
import {
  DEFAULT_WORKSPACE_FILTER,
  nodeTypesForWorkspaceFilter,
  readStoredWorkspaceFilter,
  WORKSPACE_FILTERS,
  type WorkspaceFilterKey,
  writeStoredWorkspaceFilter,
} from "../helpers/sidebar-workspace-filter";
import type { MoveNodePayload } from "../hooks/use-move-node";
import { DashboardOrpcProvider } from "../orpc-context";
import { parseNodeDetailRoute } from "../utils/node-route";
import { getSidebarTopLevelNodes } from "../utils/sidebar-node-tree";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { NodeDeleteDialog } from "./file-tree-browser";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import { NodeMoveDialog } from "./node-move-dialog";
import { NodeSettingsDialog, type NodeSettingsTab } from "./node-settings-dialog";
import { NodeSettingsPermissionsSlotContext } from "./node-settings-permissions-slot";
import { NodeShareDialog } from "./node-share-button";
import { SidebarWorkspaceFilterMenu } from "./sidebar-workspace-filter-menu";
import { useWorkspacePermissionLevel } from "./split-submit-button";
import "./busabase-sidebar-nav.css";

/** Stable, always-disabled query used in place of `orpc.nodes.listFavorites.queryOptions({})`
 * when a host omitted `orpc` — keeps the `useQuery` call unconditional (rules of
 * hooks) while never actually firing a request. */
const DISABLED_FAVORITES_QUERY = {
  queryKey: ["busabase-dashboard-shell", "favorites-disabled"],
  queryFn: async () => [] as NodeVO[],
  enabled: false,
};

/** Same always-disabled stand-in, for `orpc.nodes.ancestors` (see above). */
const DISABLED_ANCESTORS_QUERY = {
  queryKey: ["busabase-dashboard-shell", "ancestors-disabled"],
  queryFn: async () => ({ ancestorIds: [] as string[] }),
  enabled: false,
};

/**
 * Same always-disabled stand-in, for the sidebar's `orpc.nodes.list({ types })`
 * filter. Swapped in whenever the active filter is NOT a type query (the
 * workspace tree, or Recent), so looking at the tree never quietly fetches the
 * Apps list behind it.
 */
const DISABLED_NODE_TYPE_LIST_QUERY = {
  queryKey: ["busabase-dashboard-shell", "node-type-list-disabled"],
  queryFn: async () => [] as NodeVO[],
  enabled: false,
};

/**
 * Same always-disabled stand-in, for the sidebar's `orpc.nodes.share.list`
 * ("Shared") filter. Swapped in outside that one mode, and also whenever this
 * viewer may not read the listing at all — the endpoint is `workspace("manage")`,
 * and firing a request that can only 403 is not a way to find that out.
 */
const DISABLED_SHARED_LIST_QUERY = {
  queryKey: ["busabase-dashboard-shell", "shared-list-disabled"],
  queryFn: async () => [] as SharedNodeVO[],
  enabled: false,
};

/**
 * Does this error mean "you are not allowed", as opposed to "it broke"?
 *
 * Duck-typed rather than `instanceof ORPCError`: the value TanStack Query hands
 * back has crossed the oRPC client boundary, and every host in this repo throws
 * `ORPCError("FORBIDDEN")` (see busabase-cloud's `openapi/router.ts`) which
 * arrives carrying `code`, while a plain HTTP failure carries `status`. Both
 * spellings are accepted so a transport change cannot silently turn "denied"
 * into "broken", which would leave a dead menu entry behind.
 */
const isPermissionDeniedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === "FORBIDDEN" || code === "UNAUTHORIZED" || status === 403 || status === 401;
};

/**
 * How many rows "Recent" shows. The known-node cache holds up to 1000 entries
 * (see `known-node-cache.ts`), which is a search index, not a sidebar section —
 * past roughly a screenful the list stops being "where was I" and becomes
 * another thing to scroll past, inside a sidebar that already has a tree below
 * it.
 */
const MAX_RECENT_SIDEBAR_ITEMS = 30;

const WORKSPACE_SKELETON_ROWS = [
  { id: "workspace-node-skeleton-1", width: "w-3/5" },
  { id: "workspace-node-skeleton-2", width: "w-1/2" },
  { id: "workspace-node-skeleton-3", width: "w-2/3" },
  { id: "workspace-node-skeleton-4", width: "w-5/12" },
  { id: "workspace-node-skeleton-5", width: "w-7/12" },
] as const;

const isCoreLocale = (locale: string | undefined): locale is keyof typeof coreMessagesByLocale =>
  locale !== undefined && locale in coreMessagesByLocale;

/**
 * Top-level destinations that no longer sit permanently in the sidebar — hosts
 * expose them in the Space Selector menu instead, so the resting sidebar is
 * just Home + Search + the node tree.
 *
 * Entering one of these surfaces it as a SINGLE contextual sidebar row (never
 * the whole set), which then *lingers* as "the last functional area you were
 * in" — so the round trip "review an inbox item → go check a Base → back to
 * Inbox" costs one click instead of another trip through the menu.
 */
type ContextualNavKey =
  | "inbox"
  | "activity"
  | "archived"
  | "assets"
  | "shared"
  | "agents"
  | "apps"
  | "templates";

/** Maps a wouter location onto its contextual destination, or null for everything else. */
const contextualNavKeyForPath = (location: string): ContextualNavKey | null => {
  const path = location.split("?")[0] ?? location;
  if (path === "/inbox" || path.startsWith("/inbox/")) return "inbox";
  if (path === "/activity") return "activity";
  if (path === "/archived") return "archived";
  if (path === "/assets" || path.startsWith("/assets/")) return "assets";
  if (path === "/shared") return "shared";
  if (path === "/agents" || path.startsWith("/agents/")) return "agents";
  if (path === "/apps" || path.startsWith("/apps/")) return "apps";
  if (path === "/templates" || path.startsWith("/templates/")) return "templates";
  return null;
};

/**
 * Where the lingering row survives a reload. Session-scoped (per tab) because
 * it represents "what I'm working through right now", not a durable preference —
 * a brand-new tab correctly starts back at the resting Home + Search sidebar.
 *
 * Component state alone is NOT enough: the shell remounts on every hard
 * navigation (reload, opening a link in a new tab, an SSR-rendered deep link),
 * which would drop the row exactly when someone reloads mid-review.
 */
const CONTEXTUAL_NAV_STORAGE_KEY = "busabase.dashboard.lastContextualNav.v1";

const isContextualNavKey = (value: string | null): value is ContextualNavKey =>
  value === "inbox" ||
  value === "activity" ||
  value === "archived" ||
  value === "assets" ||
  value === "shared" ||
  value === "agents" ||
  value === "apps" ||
  value === "templates";

const readStoredContextualNavKey = (): ContextualNavKey | null => {
  try {
    const stored = window.sessionStorage.getItem(CONTEXTUAL_NAV_STORAGE_KEY);
    return isContextualNavKey(stored) ? stored : null;
  } catch {
    // Private mode / storage disabled — the row just falls back to session-only.
    return null;
  }
};

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

// Re-exported so a host's shell adapter can type its own forwarding prop without
// reaching past the package's exports map into `agent-install-panel`.
export type { AgentIntegrationTarget };

interface BusabaseDashboardShellProps {
  children: ReactNode;
  nodes: NodeVO[];
  activeChangeRequestCount?: number;
  onSearchClick: () => void;
  onCreateClick: (parent?: { id: string; name: string }) => void;
  /** Identity + presentation forwarded to the shared `DashboardLayout`. */
  chrome: BusabaseDashboardChrome;
  /**
   * oRPC query utils, needed to power the sidebar "•••" → Settings/Rename/
   * Permissions entries (all open the shared `NodeSettingsDialog`, differing
   * only in tab and focused field). Omit to leave the sidebar
   * without those actions — the node-detail topbars reach the same dialog
   * through their own `NodeActionsMenu` regardless.
   */
  orpc?: BusabaseQueryUtils;
  /** Active UI locale for the sidebar nav labels (defaults to English). */
  locale?: string;
  /** Server-resolved engines, also needed by settings opened from the sidebar shell. */
  availableAirAppEngines?: AirAppRunnerKind[];
  /**
   * Wires up sidebar drag-and-drop reordering/reparenting AND the sidebar
   * "•••" → "Move to…" dialog (see `NodeMoveDialog`) — both funnel through
   * this one callback. Omit to leave the tree read-only (no drag handles, no
   * Move action rendered). The host owns the actual mutation (see
   * `useMoveNode`, normally `moveNodeMutation.mutate`); this shell only
   * translates a drop/dialog selection into the `{ nodeId, parentNodeId?,
   * position? }` the `nodes.move` endpoint expects. The optional second
   * argument mirrors `useMutation`'s `mutate(variables, options)` — pass it
   * straight through (`(payload, options) => moveNodeMutation.mutate(payload,
   * options)`) so the explicit "Move to…" dialog gets a real success/error
   * callback; drag-and-drop ignores it (its own optimistic update + the
   * hook's built-in error toast are feedback enough).
   */
  onMoveNode?: (
    payload: MoveNodePayload,
    options?: { onSuccess?: () => void; onError?: () => void },
  ) => void;
  /**
   * Ids of nodes whose children are currently being lazy-fetched (see
   * `onExpandNode` below) — drives the folder's loading row. Omit/empty when
   * the host doesn't lazy-load (e.g. it fetched the whole tree up front).
   */
  loadingNodeIds?: Set<string>;
  /**
   * True only while the host is fetching the initial node tree. Keeps the real
   * Workspace group in place and fills it with row-shaped placeholders, rather
   * than leaving a blank section or drawing a second sidebar inside the page.
   */
  nodesLoading?: boolean;
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
  /**
   * Which edition/space the sidebar's Agent-prompts dialog should tell an agent
   * to connect to — the same value the host already passes `BusabaseDashboard`.
   *
   * Needed as a prop because the shell is chrome AROUND the dashboard, so it
   * sits outside the `AgentIntegrationProvider` mounted there. Omit it and the
   * sidebar row's prompts would be the one place that copies out a prompt with
   * no connection check.
   */
  agentIntegration?: AgentIntegrationTarget;
  /**
   * Which workspace the client-side known-node cache is scoped to — the SAME
   * value the host passes `BusabaseDashboard`. The sidebar's "Recent" filter
   * reads that cache, and the dashboard is what writes it.
   *
   * Needed as a prop for the same reason `agentIntegration` is: this shell is
   * chrome AROUND `BusabaseDashboard`, so it cannot read the dashboard's
   * context. Get it wrong and nothing errors — "Recent" simply stays empty
   * forever, because it is reading a different scope than the one being
   * written.
   */
  cacheSpaceKey?: string;
  /**
   * The viewer half of that same cache scope (see `cacheSpaceKey`). Omit it on
   * a single-tenant host that omits it for `BusabaseDashboard` too — both
   * resolve to the same `"anonymous"` suffix, which is what keeps the two
   * scopes identical.
   */
  currentUserId?: string | null;
  /**
   * Whether THIS viewer may manage workspace-level sharing — the gate on the
   * "Shared" filter and the `/shared` audit page, both of which sit behind the
   * manage-level `nodes.share.list`.
   *
   * A prop for the same reason `agentIntegration` and `cacheSpaceKey` are: the
   * shell is chrome AROUND `BusabaseDashboard`, so the permission context the
   * dashboard mounts does not reach up here, and the hook below resolves to its
   * `"manage"` default for everyone. The cloud already computes this exact
   * boolean (`usePermissions().canManage`) to gate the `/shared` menu entry — so
   * passing it keeps ONE capability behind ONE gate instead of two that can
   * disagree. Omit it on a single-owner host (open source), where manage is the
   * correct answer for the only user there is.
   */
  canManageShares?: boolean;
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
  orpc,
  locale,
  availableAirAppEngines,
  onMoveNode,
  loadingNodeIds,
  nodesLoading = false,
  onExpandNode,
  checkIsDescendant,
  agentIntegration,
  cacheSpaceKey = "local",
  currentUserId,
  canManageShares: canManageSharesProp,
}: BusabaseDashboardShellProps) {
  // The node targeted by the sidebar "•••" → Settings/Rename/Permissions
  // actions; drives the one shared `NodeSettingsDialog` rendered below (only
  // when a host wired `orpc`). Rename and Permissions used to be two separate
  // dialogs (`NodeRenameDialog`/`NodePermissionsDialog`) with their own
  // target state each — now they're tabs of the same dialog, so one target
  // (carrying which tab to land on, and whether to focus the name field)
  // replaces all three. Neither Settings nor Rename is ever set for a Base
  // node — `buildNavItem` omits both actions for those.
  const [location] = useLocation();
  // What this viewer may do in this space. The "Shared" filter and the
  // `/shared` audit row both read `nodes.share.list`, which is
  // `workspace("manage")` — see `PROCEDURE_PERMISSION_POLICY`.
  //
  // Three sources, in descending order of authority.
  //
  // 1. `canManageShares` from the host, when given. This shell is the chrome
  //    AROUND `BusabaseDashboard`, so the permission context the dashboard
  //    mounts does not reach up here — the host is the only thing that knows.
  //    The cloud passes the same `usePermissions().canManage` it already uses
  //    to gate the `/shared` menu entry, so one capability has one gate.
  // 2. Otherwise the context hook, which outside that provider resolves to its
  //    `"manage"` default — correct for the single-owner open-source install,
  //    where the only user there is may do everything.
  // 3. And regardless of either, the server's own "no" (see
  //    `sharedFilterDenied` below) still withdraws the option. Defense in
  //    depth, not the primary gate: a host that forgets to pass the prop
  //    degrades to one rejected request rather than to a dead menu entry.
  const permissionLevel = useWorkspacePermissionLevel();
  const canManageShares = canManageSharesProp ?? hasApiKeyLevel(permissionLevel, "manage");
  const [settingsTarget, setSettingsTarget] = useState<{
    id: string;
    name: string;
    slug: string;
    type: string;
    tab: NodeSettingsTab;
    /** Carried explicitly rather than derived from `tab`: the Settings and
     *  Rename actions open the SAME General tab and differ only here — Rename
     *  lands with the name selected, Settings lands neutral. See
     *  `node-actions-menu.tsx`'s header for the full "why both exist". */
    focusField?: "name";
  } | null>(null);
  // Permissions is a cloud-only surface — see `node-settings-permissions-slot.tsx`.
  // The sidebar Permissions action is only offered when a host injected a panel.
  const hasPermissionsPanel = useContext(NodeSettingsPermissionsSlotContext) !== null;
  // The node targeted by the sidebar "•••" → "Move to…" action; drives the
  // `NodeMoveDialog` rendered below (only when a host wired `onMoveNode`).
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null);
  // The node targeted by the sidebar "•••" → "Agent prompts" action. Unlike
  // Move/Rename/Permissions this needs no mutation and no host wiring — the
  // dialog only reads the node-type registry and copies text — so it is offered
  // unconditionally on every node type.
  // No `metadata` here any more: the custom prompts it used to carry are their
  // own column now, fetched by the dialog when it opens. Keeping them on the
  // sidebar row was "free" only in the sense that the list already paid for it —
  // on every load, for every node, whether or not anyone opened this dialog.
  const [promptsTarget, setPromptsTarget] = useState<{
    id: string;
    name: string;
    type: string;
  } | null>(null);
  // The node targeted by the sidebar "•••" → "Share" / "Delete" actions. Both
  // carry more of the node than the other targets do: Share needs the slug to
  // build the public URL and the type to label the dialog, Delete needs the
  // type for its confirm copy and the child count so a folder warns about the
  // subtree it will archive along with it.
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    name: string;
    slug: string;
    type: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    type: string;
    childCount: number;
    /** The node's own route, captured at click time so the dialog can tell
     *  whether deleting it strands the user on a now-dead page. */
    href: string | null;
  } | null>(null);
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
  const navMainLabels = {
    dragToReorder: messages.shell.dragToReorder,
    new: nav.new,
    delete: messages.nodeDetail.delete,
    more: messages.shell.more,
    toggle: messages.shell.toggle,
    expand: messages.shell.expand,
    collapse: messages.shell.collapse,
  };
  // The "Workspace" group label doubles as the header-action key, so reuse one value.
  const workspaceLabel = nav.workspace;
  const assetsLabel = nav.assets;

  // Which functional area the contextual sidebar row points at. Seeded from the
  // current location only — reading sessionStorage during render would diverge
  // from the server's HTML and break hydration, so the restore happens in the
  // mount effect below instead. (`location` is declared once at the top of the
  // component, shared with the node-action dialogs.)
  const activeContextualKey = contextualNavKeyForPath(location);
  const [lastContextualKey, setLastContextualKey] = useState<ContextualNavKey | null>(
    activeContextualKey,
  );
  // Restore after a hard navigation (reload / new tab / SSR deep link), which
  // remounts the shell and would otherwise drop the row mid-review. Skipped when
  // the current route already supplies a key — that one is newer than storage.
  useEffect(() => {
    if (activeContextualKey) return;
    const stored = readStoredContextualNavKey();
    if (stored) setLastContextualKey(stored);
  }, [activeContextualKey]);
  useEffect(() => {
    if (!activeContextualKey) return;
    setLastContextualKey(activeContextualKey);
    try {
      window.sessionStorage.setItem(CONTEXTUAL_NAV_STORAGE_KEY, activeContextualKey);
    } catch {
      // Storage unavailable — the in-memory state above still carries the row.
    }
  }, [activeContextualKey]);

  // Which view the Workspace group is currently showing — the node tree
  // (default), or one of the flat lists that REPLACE it. Seeded with the
  // default rather than read from storage: this component server-renders, and
  // a storage read during init would produce HTML the server never emitted.
  // Restored in the mount effect below instead — the exact same shape as
  // `lastContextualKey` above, for the exact same reason.
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilterKey>("workspace");
  // Set once the server has actually refused `nodes.share.list` for this
  // viewer. See `DISABLED_SHARED_LIST_QUERY` / `isPermissionDeniedError`: on a
  // host that has not yet stated a permission level above this shell, a real
  // 403 is the only honest evidence available, so the option is offered, tried
  // once, and then withdrawn for the session rather than left as a dead entry.
  const [sharedFilterDenied, setSharedFilterDenied] = useState(false);
  // "Shared" is the one filter that can be unavailable: its endpoint is
  // manage-level, so a viewer/member has nothing behind it. Hidden rather than
  // disabled — a greyed row that explains nothing is worse than a menu that
  // only offers what this person can actually do.
  const canUseSharedFilter = canManageShares && !sharedFilterDenied;
  useEffect(() => {
    setWorkspaceFilter(readStoredWorkspaceFilter());
  }, []);
  const handleWorkspaceFilterChange = useCallback((next: WorkspaceFilterKey) => {
    setWorkspaceFilter(next);
    writeStoredWorkspaceFilter(next);
  }, []);

  // The known-node cache backing the "Recent" filter. Scoped through the shared
  // `knownNodeCacheScope` formula so this shell and the `BusabaseDashboard` it
  // wraps (which is what WRITES the cache) can never end up on two scopes.
  const nodeCache = useMemo(
    () => createKnownNodeCache(knownNodeCacheScope(cacheSpaceKey, currentUserId)),
    [cacheSpaceKey, currentUserId],
  );
  // `getServerSnapshot` is the same function as the client one on purpose: the
  // cache degrades to "empty" without `localStorage` (see `known-node-cache.ts`),
  // so on the server it returns an empty snapshot rather than throwing, and the
  // first client render matches it.
  const nodeCacheSnapshot = useSyncExternalStore(
    nodeCache.subscribe,
    nodeCache.getSnapshot,
    nodeCache.getSnapshot,
  );

  // Notion-style Favorites: the current actor's favorited nodes, kept in their
  // own TanStack Query entry (invalidated after every toggle below) — never
  // wired when a host omitted `orpc` (same gate the Permissions action uses),
  // in which case `DISABLED_FAVORITES_QUERY` keeps the `useQuery` call itself
  // unconditional (rules of hooks) while never firing a request.
  const queryClient = useQueryClient();
  // The node the current route points at — the sidebar's own reading of the
  // location, independent of whichever detail view is rendered.
  const activeNodeRef = useMemo(() => parseNodeDetailRoute(location), [location]);

  // Which folders sit on the path to that node. The sidebar cannot work this
  // out from its own tree: the tree is depth-bounded and lazily expanded, so
  // on a cold load (refresh / bookmark / shared link / "recently visited"
  // jump) none of the ancestors have been fetched, and an ancestor that has
  // not been fetched cannot be recognised as one. Asking the server once
  // breaks that deadlock — NavMain opens each id it gets back, each expansion
  // loads the next level, and the chain unrolls down to the active row.
  const ancestorsQuery = useQuery(
    orpc && activeNodeRef
      ? {
          ...orpc.nodes.ancestors.queryOptions({
            input: { nodeId: activeNodeRef.slug, type: activeNodeRef.type },
          }),
          // A node's ancestry only changes when the node is MOVED, which
          // invalidates the whole `nodes` family anyway — so this never needs
          // a time-based refetch of its own.
          staleTime: Number.POSITIVE_INFINITY,
        }
      : DISABLED_ANCESTORS_QUERY,
  );
  const activeAncestorIds = useMemo(
    () => new Set(ancestorsQuery.data?.ancestorIds ?? []),
    [ancestorsQuery.data],
  );

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
  // Everything `buildNavItem` needs, assembled once and threaded through the
  // whole recursive build as a single object. This used to be nine positional
  // parameters forwarded by hand at four call sites — and a forgotten forward
  // is invisible to TypeScript (every callback is optional), which is exactly
  // how the Agent-prompts menu item silently failed to render on Bases-tree
  // rows. One object means a new action is added in one place and cannot be
  // dropped in transit.
  const navItemContext = useMemo<NavItemContext>(
    () => ({
      onCreateChild: (node) => onCreateClick({ id: node.id, name: node.name }),
      labels: {
        newLabel: nav.new,
        openLabel: messages.common.open,
        permissionsLabel: messages.permissions.title,
        settingsLabel: messages.nodeSettings.menuLabel,
        renameLabel: messages.rename.title,
        favoriteAddLabel: messages.favorites.add,
        favoriteRemoveLabel: messages.favorites.remove,
        moveLabel: messages.move.menuLabel,
        agentPromptsLabel: messages.agentPrompts.title,
        shareLabel: messages.share.title,
        sharedMarkerLabel: messages.share.sharedMarker,
        deleteLabel: messages.nodeDetail.delete,
      },
      loadingNodeIds,
      // Only offer the sidebar Permissions action when a host wired orpc AND
      // injected a permissions panel (cloud-only) — the dialog can't do
      // anything without either.
      onOpenPermissions:
        orpc && hasPermissionsPanel
          ? (node) =>
              setSettingsTarget({
                id: node.id,
                name: node.name,
                slug: node.slug,
                type: node.type,
                tab: "permissions",
              })
          : undefined,
      // Same orpc gate for the Favorites toggle action — no persistence layer
      // to call without it.
      favoriteContext: orpc ? { favoriteNodeIds, onToggle: handleToggleFavorite } : undefined,
      // Same orpc gate for the Settings action — `buildNavItem` further
      // excludes Base nodes regardless (they reach this dialog through the
      // Design tab's "Base Info" → Edit button instead).
      onOpenSettings: orpc
        ? (node) =>
            setSettingsTarget({
              id: node.id,
              name: node.name,
              slug: node.slug,
              type: node.type,
              tab: "general",
            })
        : undefined,
      // Rename is the same dialog and the same tab as Settings above — the
      // only difference is `focusField`, which lands the caret in the name
      // field. Kept as its own entry because renaming is the high-frequency
      // action and shouldn't cost an extra click into a settings surface.
      onOpenRename: orpc
        ? (node) =>
            setSettingsTarget({
              id: node.id,
              name: node.name,
              slug: node.slug,
              type: node.type,
              tab: "general",
              focusField: "name",
            })
        : undefined,
      // Only offer "Move to…" when a host wired `onMoveNode` — the dialog
      // can't do anything without a mutation to call.
      onOpenMove: onMoveNode
        ? (node) => setMoveTarget({ id: node.id, name: node.name })
        : undefined,
      onOpenAgentPrompts: (node) =>
        setPromptsTarget({
          id: node.id,
          name: node.name,
          type: node.type,
        }),
      // Share and Delete carry the same orpc gate as Permissions/Rename: both
      // dialogs are pure mutation surfaces (a public link toggle, a node_delete
      // change request) with nothing to call without a wired client.
      onOpenShare: orpc
        ? (node) =>
            setShareTarget({ id: node.id, name: node.name, slug: node.slug, type: node.type })
        : undefined,
      onOpenDelete: orpc
        ? (node) =>
            setDeleteTarget({
              id: node.id,
              name: node.name,
              type: node.type,
              childCount: node.children.length,
              href: nodeHref(node),
            })
        : undefined,
    }),
    [
      onCreateClick,
      nav.new,
      messages.common.open,
      messages.permissions.title,
      messages.nodeSettings.menuLabel,
      messages.rename.title,
      messages.favorites.add,
      messages.favorites.remove,
      messages.move.menuLabel,
      messages.agentPrompts.title,
      messages.share.title,
      messages.share.sharedMarker,
      messages.nodeDetail.delete,
      loadingNodeIds,
      orpc,
      hasPermissionsPanel,
      favoriteNodeIds,
      handleToggleFavorite,
      onMoveNode,
    ],
  );

  // Single source of truth for "top-level after root-unwrap" — the exact
  // NavItem list rendered as the Bases tree's top level today. Hoisted into
  // its own memo (rather than an inline call) so it can be reused as-is by
  // the sidebar without recomputing per render.
  const baseNavItems = useMemo(
    () => buildKnowledgeBaseItems(nodes, navItemContext),
    [nodes, navItemContext],
  );

  // The `nodes.list({ types })` narrowing for the active filter, or null when
  // the filter isn't a server type query at all. Drives both the query below
  // and "is this a flat mode" everywhere else in this component.
  //
  // Memoized because it returns a fresh array literal per call, and it is a
  // dependency of `typeFilterNavItems` below — unmemoized, that `useMemo` would
  // see a new identity on every render and rebuild a `NavItem` (actions array,
  // closures and all) for every app in the space each time the shell re-renders
  // for an unrelated reason, which is exactly the work the memo exists to skip.
  const workspaceFilterTypes = useMemo(
    () => nodeTypesForWorkspaceFilter(workspaceFilter),
    [workspaceFilter],
  );
  // Flat, ACL-filtered summaries for the Apps / Skills filters. Deliberately
  // swapped for the always-disabled stand-in outside those two modes — the
  // sidebar must not fetch the Apps list while someone is looking at the tree.
  const typeFilterQuery = useQuery(
    orpc && workspaceFilterTypes
      ? orpc.nodes.list.queryOptions({ input: { types: workspaceFilterTypes } })
      : DISABLED_NODE_TYPE_LIST_QUERY,
  );

  // Apps / Skills rows. `nodes.list({ types })` returns full `NodeVO`s (the
  // contract's own `nodeSchema`, just with `children: []` and
  // `hasChildren: false`), so these go through the SAME `buildNavItem` every
  // tree row does and keep their "•••" menu — then get flattened, exactly like
  // Favorites, because a flat list has no subtree to expand into.
  //
  // Sorted by name: the server orders by `position`, which is a tree-ordering
  // concept and reads as random once the tree is gone. Locale-aware so CJK
  // names don't sort by code point.
  const typeFilterNavItems = useMemo(() => {
    if (!workspaceFilterTypes) return [];
    const rows = [...(typeFilterQuery.data ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, locale),
    );
    return rows.flatMap((node) =>
      buildNavItem(node, { ...navItemContext, onCreateChild: () => undefined }).map(toFlatNavItem),
    );
  }, [workspaceFilterTypes, typeFilterQuery.data, navItemContext, locale]);

  // "Shared" rows: every node in the space carrying its OWN live public share.
  // A dedicated endpoint rather than a `nodes.list({ types })` narrowing,
  // because "published" is not a node type — and NOT `NodeVO.shared` either,
  // which `listNodeSummaries` deliberately leaves unset on type-filtered
  // listings (it passes no 5th argument to `toNodeVO`, so the key is absent,
  // which is "unresolved", not "false").
  //
  // Same always-disabled stand-in discipline as the type filters: looking at
  // the tree must not fetch this list behind it.
  const sharedListQuery = useQuery(
    orpc && workspaceFilter === "shared" && canUseSharedFilter
      ? orpc.nodes.share.list.queryOptions({ input: {} })
      : DISABLED_SHARED_LIST_QUERY,
  );
  // Latch the server's "no" for the rest of the session. Without the latch the
  // entry would reappear the moment the failed query is swapped back out for
  // the disabled stand-in (different query key, so no cached error), and a
  // viewer could click it again, and again.
  useEffect(() => {
    if (isPermissionDeniedError(sharedListQuery.error)) setSharedFilterDenied(true);
  }, [sharedListQuery.error]);

  // Rows for the "Shared" filter. A dedicated builder, for the same reason
  // `buildRecentNavItems` is one: a `SharedNodeVO` is not a `NodeVO`. It has no
  // `children`, no `parentId`, no `settings` — all of which `buildNavItem`
  // reads to decide the "•••" menu and the folder chrome — so synthesizing one
  // would mean inventing answers. These rows navigate, and carry the marker
  // that is the whole reason they are here.
  //
  // Order is the server's: newest grant first, the order a manager scans.
  const sharedNavItems = useMemo(
    () =>
      workspaceFilter === "shared"
        ? buildSharedNavItems(sharedListQuery.data ?? [], messages.share.sharedMarker)
        : [],
    [workspaceFilter, sharedListQuery.data, messages.share.sharedMarker],
  );

  // "Recent" rows, newest-first — `snapshot.visited` is ALREADY sorted by
  // `lastVisitedAt` DESC, so this must not re-sort it (unlike the type filters
  // above, where name order is the only sensible one).
  const recentNavItems = useMemo(
    () =>
      workspaceFilter === "recent"
        ? buildRecentNavItems(nodeCacheSnapshot.visited.slice(0, MAX_RECENT_SIDEBAR_ITEMS))
        : [],
    [workspaceFilter, nodeCacheSnapshot.visited],
  );

  // Favorites nav group: a FLAT list of the actor's favorited nodes (already
  // fully resolved `NodeVO`s from `nodes.listFavorites`, not a tree to walk),
  // built via the same `buildNavItem` every Bases-tree row uses — see
  // `buildFavoriteItems` below for why each result is flattened to a plain,
  // non-expandable row. Only ever rendered non-empty (see `scrollNav` below),
  // mirroring the existing `scrollShortcutItems.length > 0` pattern.
  const favoriteNavItems = useMemo(
    () => buildFavoriteItems(favoriteNodes, navItemContext),
    [favoriteNodes, navItemContext],
  );

  // The one transient row for the functional area last visited (see
  // `contextualNavKeyForPath`) — at most ONE, so the sidebar never regrows into
  // the shortcut list this design replaced. Only Inbox carries a count; the
  // others have no equivalent "needs you" number.
  const contextualNavItem: NavItem | null = useMemo(() => {
    switch (lastContextualKey) {
      case "inbox":
        return {
          title: nav.inbox,
          url: "/inbox",
          icon: Inbox,
          badge: activeChangeRequestCount || undefined,
        };
      case "activity":
        return { title: nav.activity, url: "/activity", icon: Activity };
      case "archived":
        return { title: nav.archive, url: "/archived", icon: Archive };
      case "assets":
        return { title: assetsLabel, url: "/assets", icon: Images };
      case "shared":
        // Gated like the filter above it: `/shared` is a manage-level audit
        // screen, so the lingering row is not offered to someone who would
        // only land on its insufficient-permission state.
        return canUseSharedFilter ? { title: nav.shared, url: "/shared", icon: Globe } : null;
      case "agents":
        return { title: nav.agents, url: "/agents", icon: Bot };
      case "apps":
        return { title: nav.apps, url: "/apps", icon: LayoutGrid };
      case "templates":
        return { title: nav.templates, url: "/templates", icon: Shapes };
      default:
        return null;
    }
  }, [
    lastContextualKey,
    nav.inbox,
    nav.activity,
    nav.archive,
    nav.shared,
    nav.agents,
    nav.apps,
    nav.templates,
    assetsLabel,
    activeChangeRequestCount,
    canUseSharedFilter,
  ]);

  // Pinned nav (fixed at the top, never scrolls): Home + Search only. Home is
  // the landing page and carries the aggregate "needs your attention" badge;
  // Inbox/Activity/Archive/Assets moved into the Space Selector menu so the
  // resting sidebar stays at two rows plus the node tree.
  const pinnedNav: NavGroup[] = [
    {
      label: "",
      // Trim the group's bottom padding (p-2 → pb-1 = 4px) so the gap between
      // the pinned Search row and the first scroll item equals the 4px gap
      // between menu items — the split must be invisible.
      className: "pb-1",
      items: [
        {
          title: nav.home,
          url: "/home",
          icon: House,
          badge: activeChangeRequestCount || undefined,
        },
        { title: nav.search, url: "", icon: Search, onClick: "search" },
      ],
    },
  ];

  // Scrollable nav (everything below the pinned header): the contextual row (when
  // any) + Favorites (only when non-empty) + Workspace node tree.
  const scrollNavBeforeWorkspace: NavGroup[] = [
    ...(contextualNavItem
      ? [
          {
            label: "",
            // Flush top (pt-0) so the row sits 4px under the pinned Search row, while
            // keeping the default bottom padding (pb-2) so the gap down to the Workspace
            // section header is unchanged.
            className: "pt-0",
            items: [contextualNavItem],
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
  ];
  const filterLabels = useMemo(
    () => ({
      trigger: messages.sidebarFilter.trigger,
      options: {
        workspace: messages.sidebarFilter.workspace,
        recent: messages.sidebarFilter.recent,
        shared: messages.sidebarFilter.shared,
        airapp: messages.sidebarFilter.airapp,
        skill: messages.sidebarFilter.skill,
      },
    }),
    [messages.sidebarFilter],
  );
  const availableFilters = useMemo(
    () =>
      canUseSharedFilter ? WORKSPACE_FILTERS : WORKSPACE_FILTERS.filter((key) => key !== "shared"),
    [canUseSharedFilter],
  );
  // A stored (or just-denied) "shared" must not strand someone on a section
  // with no rows and no entry in the menu to get back out of.
  useEffect(() => {
    if (workspaceFilter === "shared" && !canUseSharedFilter) {
      setWorkspaceFilter(DEFAULT_WORKSPACE_FILTER);
      writeStoredWorkspaceFilter(DEFAULT_WORKSPACE_FILTER);
    }
  }, [workspaceFilter, canUseSharedFilter]);
  const workspaceFilterMenu = (
    <SidebarWorkspaceFilterMenu
      filters={availableFilters}
      labels={filterLabels}
      onChange={handleWorkspaceFilterChange}
      value={workspaceFilter}
    />
  );
  // Which rows the group renders right now. Only `workspace` reads the tree;
  // the other three REPLACE it with a flat list.
  const workspaceGroupItems =
    workspaceFilter === "workspace"
      ? baseNavItems
      : workspaceFilter === "recent"
        ? recentNavItems
        : workspaceFilter === "shared"
          ? sharedNavItems
          : typeFilterNavItems;
  // Show the existing row skeleton rather than an empty group in BOTH loading
  // cases — the host's initial tree fetch, and a type filter's own query —
  // so switching to "Apps" doesn't flash an empty section first.
  //
  // Three cases now, not two: `workspaceFilterTypes === null` used to mean
  // "tree or Recent", and Recent is the only one of those that never loads.
  // "Shared" is a third thing — `null` types, but a real query of its own.
  const showWorkspaceSkeleton = workspaceFilterTypes
    ? typeFilterQuery.isPending && typeFilterQuery.fetchStatus !== "idle"
    : workspaceFilter === "shared"
      ? sharedListQuery.isPending && sharedListQuery.fetchStatus !== "idle"
      : workspaceFilter === "workspace" && nodesLoading;
  // A filter that genuinely resolved to nothing. Kept distinct from "still
  // loading" above: "Nothing here yet" is an answer, and showing it while the
  // answer is still in flight would be a lie that corrects itself.
  const showWorkspaceEmpty =
    workspaceFilter !== "workspace" && !showWorkspaceSkeleton && workspaceGroupItems.length === 0;
  const workspaceNavGroup: NavGroup = {
    // Still the plain string: it remains this group's React key AND the
    // argument `onHeaderActionClick` matches on, so the `+` action keeps
    // working no matter what the dropdown is showing.
    label: workspaceLabel,
    labelSlot: workspaceFilterMenu,
    items: workspaceGroupItems,
    headerAction: Plus,
    headerActionTitle: nav.new,
    className: "group-data-[collapsible=icon]:hidden",
    // The canonical node tree, and the ONLY group whose rows may be dragged.
    // Favorites above renders the very same node ids (see `buildFavoriteItems`);
    // letting it register them too gave one dnd-kit id two DOM rows, which lit
    // the drop indicator on both at once.
    //
    // Off in every FILTERED mode, for an additional and different reason: a
    // flat list carries no parent/sibling context, so a drop would compute a
    // `{ parentNodeId, position }` from whichever row happened to be rendered
    // next to it — silently reparenting or reordering something the user never
    // pointed at. There is no correct answer to "where did you drop it" when
    // the structure isn't on screen, so the gesture is simply not offered.
    draggable: workspaceFilter === "workspace",
  };
  const scrollNav: NavGroup[] = [...scrollNavBeforeWorkspace, workspaceNavGroup];

  const handleHeaderActionClick = (groupLabel: string) => {
    if (groupLabel === workspaceLabel) {
      onCreateClick();
    }
  };
  const handleNavItemAction = (action: string) => {
    if (action === "search") {
      onSearchClick();
    }
  };

  // `locale` only fed `messages`/`nav` above (this shell's own labels) — every
  // dialog below (Permissions, Rename, Move, Share, Delete, Agent prompts)
  // reads `useCoreI18n()` instead, and without re-establishing the provider
  // here they'd silently read the default English context. `<BusabaseDashboard>`
  // (index.tsx) sets up its OWN `CoreI18nProvider`, but this shell is the
  // sibling chrome that wraps its `children` (see `dashboard-view.tsx`'s
  // "sits outside the CoreI18nProvider that lives inside it" note for the same
  // shape of bug on `InstallFromGithubModal`) — a nested provider here is
  // harmless since a descendant `<BusabaseDashboard>` overrides it anyway.
  return (
    <CoreI18nProvider locale={locale}>
      <div data-busabase-dashboard-layout className="h-full min-h-0">
        <Toaster position="top-right" />
        <DashboardLayout
          {...chrome}
          className="h-full min-h-0"
          defaultOpen
          navMain={pinnedNav}
          navMainLabels={navMainLabels}
          mobileSidebarLabels={{
            title: messages.shell.mobileSidebarTitle,
            description: messages.shell.mobileSidebarDescription,
          }}
          resizeSidebarLabel={messages.shell.resizeSidebar}
          sidebarExtra={
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden group-data-[collapsible=icon]:overflow-hidden"
              data-busabase-sidebar-nav
            >
              <NavMain
                items={showWorkspaceSkeleton ? scrollNavBeforeWorkspace : scrollNav}
                labels={navMainLabels}
                onHeaderActionClick={handleHeaderActionClick}
                onNavItemAction={handleNavItemAction}
                onNodeDrop={onMoveNode ? handleNodeDrop : undefined}
                isDropAllowed={onMoveNode ? isDropAllowed : undefined}
                onExpand={onExpandNode ? (item) => item.id && onExpandNode(item.id) : undefined}
                activeAncestorIds={activeAncestorIds}
              />
              {showWorkspaceSkeleton ? (
                <SidebarGroup
                  aria-busy="true"
                  className="relative group-data-[collapsible=icon]:hidden"
                  data-workspace-nodes-loading="true"
                >
                  <div className="flex shrink-0 items-center px-2">
                    <SidebarGroupLabel className="flex h-6 flex-1 items-center text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                      {/* This skeleton stands in for the whole group while it
                          loads, label included — so it renders the SAME filter
                          control, not a dead copy of the word "Workspace".
                          Otherwise the dropdown would vanish and reappear on
                          every switch into Apps/Skills, which is exactly when
                          someone is most likely to want to switch again. */}
                      {workspaceFilterMenu}
                    </SidebarGroupLabel>
                  </div>
                  <SidebarGroupAction
                    className="top-2"
                    onClick={() => onCreateClick()}
                    title={nav.new}
                  >
                    <Plus className="size-4" />
                    <span className="sr-only">{nav.new}</span>
                  </SidebarGroupAction>
                  <SidebarMenu aria-hidden="true" className="gap-1">
                    {WORKSPACE_SKELETON_ROWS.map((row) => (
                      <SidebarMenuItem data-workspace-node-skeleton-row key={row.id}>
                        <div className="flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2">
                          <Skeleton className="size-4 shrink-0 rounded" />
                          <Skeleton className={`h-3.5 ${row.width}`} />
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              ) : null}
              {showWorkspaceEmpty ? (
                // A plain muted line rather than a `NavItem`: `NavItem` has no
                // disabled/non-interactive variant, and every row it renders is
                // a link. Faking one with an empty `url` would put a clickable,
                // focusable dead row in the tab order. The Workspace group is
                // always last in `scrollNav`, so rendering this straight after
                // `<NavMain>` lands it exactly where the missing rows would be.
                <div
                  className="px-4 py-1 text-sidebar-foreground/50 text-xs"
                  data-workspace-filter-empty="true"
                >
                  {messages.sidebarFilter.empty}
                </div>
              ) : null}
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
        {orpc && settingsTarget && (
          <AirAppEngineAvailabilityProvider engines={availableAirAppEngines}>
            <NodeSettingsDialog
              focusField={settingsTarget.focusField}
              initialTab={settingsTarget.tab}
              nodeId={settingsTarget.id}
              nodeName={settingsTarget.name}
              nodeSlug={settingsTarget.slug}
              nodeType={settingsTarget.type}
              onOpenChange={(next) => {
                if (!next) setSettingsTarget(null);
              }}
              open
              orpc={orpc}
            />
          </AirAppEngineAvailabilityProvider>
        )}
        {promptsTarget && (
          // The shell is chrome AROUND the dashboard, so this dialog sits
          // outside the `DashboardOrpcProvider` that `BusabaseDashboard` mounts
          // over its own children — it needs its own, or the sidebar row's
          // prompts dialog would be the one place with no Ask Agent button.
          <DashboardOrpcProvider orpc={orpc}>
            <NodeAgentPromptsDialog
              agentIntegration={agentIntegration}
              orpc={orpc ?? null}
              nodeId={promptsTarget.id}
              nodeName={promptsTarget.name}
              nodeType={promptsTarget.type}
              onOpenChange={(next) => {
                if (!next) setPromptsTarget(null);
              }}
              open
            />
          </DashboardOrpcProvider>
        )}
        {orpc && shareTarget && (
          <NodeShareDialog
            nodeId={shareTarget.id}
            nodeName={shareTarget.name}
            nodeSlug={shareTarget.slug}
            nodeType={shareTarget.type}
            onOpenChange={(next) => {
              if (!next) setShareTarget(null);
            }}
            open
            orpc={orpc}
          />
        )}
        {orpc && deleteTarget && (
          <NodeDeleteDialog
            childCount={deleteTarget.childCount}
            /* Only bounce to the workbench root when the node being deleted is
             the one currently open — otherwise the route you're on is about to
             404. Deleting some OTHER node from the sidebar must leave you
             exactly where you were; a detail page's own "•••" menu always
             qualifies for the redirect and keeps the default. */
            navigateHome={Boolean(
              deleteTarget.href &&
                (location === deleteTarget.href || location.startsWith(`${deleteTarget.href}/`)),
            )}
            nodeId={deleteTarget.id}
            nodeName={deleteTarget.name}
            nodeType={deleteTarget.type}
            onOpenChange={(next) => {
              if (!next) setDeleteTarget(null);
            }}
            open
            orpc={orpc}
          />
        )}
        {onMoveNode && moveTarget && (
          <NodeMoveDialog
            node={moveTarget}
            nodes={nodes}
            onMoveNode={onMoveNode}
            onOpenChange={(next) => {
              if (!next) setMoveTarget(null);
            }}
            open
          />
        )}
      </div>
    </CoreI18nProvider>
  );
}

// Resolve a node's dashboard URL (null if it has no detail screen).
// Base nodes carry their own slug — no need to cross-reference the bases list.
//
// Takes the two fields it actually reads rather than a whole `NodeVO`, so the
// flat listings that are NOT NodeVOs (the "Shared" filter's `SharedNodeVO`)
// resolve their route through this one function instead of re-spelling the
// Base special case somewhere it could drift.
function nodeHref(node: { type: string; slug: string }): string | null {
  if (node.type === "base") {
    return node.slug ? `/base/${node.slug}` : null;
  }
  return hasCapability(node.type, "hasDetail") ? `/${node.type}/${node.slug}` : null;
}

interface NavItemLabels {
  newLabel: string;
  openLabel: string;
  permissionsLabel: string;
  settingsLabel: string;
  renameLabel: string;
  favoriteAddLabel: string;
  favoriteRemoveLabel: string;
  moveLabel: string;
  agentPromptsLabel: string;
  shareLabel: string;
  /** Tooltip on the always-visible "this node is published" sidebar marker. */
  sharedMarkerLabel: string;
  deleteLabel: string;
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
 * Everything the recursive nav build needs, in one object. Passed unchanged
 * from `buildKnowledgeBaseItems`/`buildFavoriteItems` down through
 * `buildNavItem` → `buildNavChildren` → `buildNavItem` … at every depth, so
 * adding an action means touching `buildNavItem` alone. The previous shape —
 * nine optional positional parameters re-listed at each forwarding site — made
 * a dropped forward both easy to write and impossible for TypeScript to catch
 * (a missing optional argument is just `undefined`); that is precisely how the
 * Agent-prompts item ended up absent from Bases-tree rows while present
 * everywhere else.
 *
 * Every `onOpen*` is optional and its absence removes that item from the menu —
 * a host that never wired `orpc`/`onMoveNode` has no mutation to run, so the
 * action would be dead UI.
 */
interface NavItemContext {
  onCreateChild: (node: NodeVO) => void;
  labels: NavItemLabels;
  loadingNodeIds?: Set<string>;
  onOpenPermissions?: (node: NodeVO) => void;
  favoriteContext?: FavoriteActionContext;
  onOpenSettings?: (node: NodeVO) => void;
  onOpenRename?: (node: NodeVO) => void;
  onOpenMove?: (node: NodeVO) => void;
  onOpenAgentPrompts?: (node: NodeVO) => void;
  onOpenShare?: (node: NodeVO) => void;
  onOpenDelete?: (node: NodeVO) => void;
}

interface NodeMenuActions {
  /** Only containers expose Open inside the context menu. */
  openAction?: NavItemAction | null;
  agentPromptsAction?: NavItemAction | null;
  managementActions: Array<NavItemAction | null>;
  deleteAction?: NavItemAction | null;
}

/**
 * Keeps the agent-facing action at the top of every node menu without losing
 * the familiar Open-first convention for containers. Management actions form
 * a separate group below it, while Delete remains independently fenced off at
 * the end by its own `separatorBefore` flag.
 *
 * Exported for the focused ordering tests; this is not part of the package's
 * public exports map.
 */
export function buildNodeMenuActions({
  openAction,
  agentPromptsAction,
  managementActions,
  deleteAction,
}: NodeMenuActions): NavItemAction[] {
  const visibleManagementActions = managementActions.filter(
    (action): action is NavItemAction => action !== null,
  );

  if (agentPromptsAction && visibleManagementActions.length > 0) {
    visibleManagementActions[0] = {
      ...visibleManagementActions[0],
      separatorBefore: true,
    };
  }

  return [
    ...(openAction ? [openAction] : []),
    ...(agentPromptsAction ? [agentPromptsAction] : []),
    ...visibleManagementActions,
    ...(deleteAction ? [deleteAction] : []),
  ];
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
function buildNavItem(node: NodeVO, ctx: NavItemContext): NavItem[] {
  const {
    onCreateChild,
    labels,
    loadingNodeIds,
    onOpenPermissions,
    favoriteContext,
    onOpenSettings,
    onOpenRename,
    onOpenMove,
    onOpenAgentPrompts,
    onOpenShare,
    onOpenDelete,
  } = ctx;
  if (hasCapability(node.type, "hidden")) return [];
  const icon = nodeIconGlyph(resolveNodeIcon(node));
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
  // The "•••" Settings action — opens `NodeSettingsDialog` on its General
  // tab (icon / name / description), with Info and Permissions one click away
  // in the same dialog. Same Base exception as Rename below: a Base reaches
  // this dialog from its Design tab's "Base Info" → Edit button instead.
  const settingsAction: NavItemAction | null =
    onOpenSettings && node.type !== "base"
      ? {
          title: labels.settingsLabel,
          icon: Settings,
          onSelect: () => onOpenSettings(node),
        }
      : null;
  // The "•••" Rename action — same shared mechanism as Permissions/Favorite,
  // and the same dialog as Settings above, only with the name field focused.
  // Base nodes keep their own independent rename path (Design Tab), so the
  // host never wires `onOpenRename` for them (see `submitRenameBase`); guard
  // here too so a future host mistake can't double up on the "base" type.
  const renameAction: NavItemAction | null =
    onOpenRename && node.type !== "base"
      ? {
          title: labels.renameLabel,
          icon: Pencil,
          onSelect: () => onOpenRename(node),
        }
      : null;
  // The "•••" Favorites toggle — same shared mechanism, one click, same menu
  // as Open/Permissions.
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
  // The "•••" "Move to…" action — opens `NodeMoveDialog` for this node.
  // Offered on every node type (unlike Rename's Base exception), since
  // `nodes.move` is a generic node-reparenting endpoint. Only present when
  // the host wired `onMoveNode` (no dialog without a mutation to call).
  const moveAction: NavItemAction | null = onOpenMove
    ? {
        title: labels.moveLabel,
        icon: FolderTree,
        onSelect: () => onOpenMove(node),
      }
    : null;
  // The "•••" "Agent prompts" action — opens the copy-paste prompt dialog for
  // this node. Offered on every node type and needs no host mutation (the
  // dialog only reads the registry and writes to the clipboard), so unlike the
  // others it has no capability/`orpc` gate beyond the callback being wired.
  const agentPromptsAction: NavItemAction | null = onOpenAgentPrompts
    ? {
        title: labels.agentPromptsLabel,
        icon: Sparkles,
        onSelect: () => onOpenAgentPrompts(node),
      }
    : null;
  // The "•••" Share action — offered when EITHER half of the Share dialog has
  // something to offer: a public link (types whose registry definition opts
  // into a working anonymous detail route) or an embed link (AirApp / Drive /
  // Skill qualify for this one and only this one). Same predicate as
  // `NodeActionsMenu`'s `canShare`; the dialog re-checks both itself.
  const shareAction: NavItemAction | null =
    onOpenShare &&
    node.slug &&
    (publicAccessOf(node.type) !== "no" || isEmbeddableNodeType(node.type))
      ? {
          title: labels.shareLabel,
          icon: Globe,
          onSelect: () => onOpenShare(node),
        }
      : null;
  // The "•••" Delete action — archives to Trash (recoverable) after a confirm
  // dialog. Rendered last, in destructive red, behind a separator, so it can't
  // be hit by muscle memory aimed at the item above it.
  const deleteAction: NavItemAction | null = onOpenDelete
    ? {
        title: labels.deleteLabel,
        icon: Trash2,
        onSelect: () => onOpenDelete(node),
        variant: "destructive",
        separatorBefore: true,
      }
    : null;
  // The always-visible "this node has its own live public link" marker (see
  // `NodeVO.shared`). Deliberately NOT a hover action: an admin scanning the
  // tree should be able to see WHICH nodes are published without opening every
  // "•••" → Share dialog, which was the only way to find out before. A node
  // that is merely reachable because an ANCESTOR is shared carries no marker —
  // `shared` is the node's own share row, not the inherited scope.
  const sharedMarker = node.shared
    ? { statusIcon: Globe, statusIconTitle: labels.sharedMarkerLabel }
    : {};
  if (hasCapability(node.type, "container")) {
    const url = nodeHref(node) ?? "";
    return [
      {
        title: node.name,
        url,
        icon,
        id: node.id,
        ...sharedMarker,
        items: buildNavChildren(node, ctx),
        hasChildren: node.hasChildren ?? node.children.length > 0,
        isLoadingChildren: loadingNodeIds?.has(node.id) ?? false,
        onAddChild: () => onCreateChild(node),
        addChildTitle: labels.newLabel,
        actions: buildNodeMenuActions({
          openAction: url ? { title: labels.openLabel, url, icon: FolderOpen } : null,
          agentPromptsAction,
          managementActions: [
            settingsAction,
            renameAction,
            permissionsAction,
            favoriteAction,
            moveAction,
            shareAction,
          ],
          deleteAction,
        }),
      },
    ];
  }
  const url = nodeHref(node);
  const leafActions = buildNodeMenuActions({
    agentPromptsAction,
    managementActions: [
      settingsAction,
      renameAction,
      permissionsAction,
      favoriteAction,
      moveAction,
      shareAction,
    ],
    deleteAction,
  });
  return url
    ? [
        {
          title: node.name,
          url,
          icon,
          id: node.id,
          ...sharedMarker,
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
function buildNavChildren(node: NodeVO, ctx: NavItemContext): NavItem[] {
  return node.children.flatMap((child) => buildNavItem(child, ctx));
}

/**
 * Build the Bases nav from the node tree, preserving structure. Container types
 * become collapsible parents (detail-bearing descendants nested underneath, at
 * any depth); other detail types are clickable rows. The system workspace root
 * is unwrapped without dropping ACL-promoted nodes that may sit beside it.
 */
function buildKnowledgeBaseItems(nodes: NodeVO[], ctx: NavItemContext): NavItem[] {
  return getSidebarTopLevelNodes(nodes).flatMap((node) => buildNavItem(node, ctx));
}

// A node's own NavItem stripped of every container-only field
// (`items`/`hasChildren`/`isLoadingChildren`/`onAddChild`/`addChildTitle`) —
// every node type the sidebar renders has its own detail-page url (see
// `nodeHref`), so this never loses navigability, only the (here meaningless,
// since these NodeVOs carry no live `children`) folder chrome a container-type
// row would otherwise render.
//
// Used by every FLAT group: Favorites, and the Apps/Skills workspace filters.
function toFlatNavItem(item: NavItem): NavItem {
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
function buildFavoriteItems(favoriteNodes: NodeVO[], ctx: NavItemContext): NavItem[] {
  // A Favorites shortcut row never offers "add child here" (it has no
  // `onAddChild`), so the create callback and its `newLabel` are both stubbed
  // out rather than threaded through — everything else is the Bases tree's
  // exact context, which is what keeps the two menus identical.
  return favoriteNodes.flatMap((node) =>
    buildNavItem(node, { ...ctx, onCreateChild: () => undefined }).map(toFlatNavItem),
  );
}

/**
 * Build the sidebar's "Shared" rows from `nodes.share.list`.
 *
 * A dedicated builder rather than `buildNavItem`, for the same reason
 * `buildRecentNavItems` below is one: a `SharedNodeVO` is not a `NodeVO`. It
 * deliberately carries only what an audit row needs (identity + the grant
 * facts) and has no `children`, `parentId`, `description` or `settings` — all
 * of which `buildNavItem` reads to build the "•••" menu and the folder chrome.
 * Faking them would mean inventing answers (a Delete action reporting zero
 * children for a folder that has twenty).
 *
 * The marker is the point of the group, so unlike Recent these rows DO carry
 * one — and it is the same globe, with the same label, the tree already shows
 * (`share.sharedMarker`), because it means exactly the same thing here: this
 * node has its own live public link. Every row in this list is shared, so the
 * marker is not distinguishing rows from each other; it is what ties the list
 * back to the marks scattered through the tree, so the two never read as two
 * different features.
 */
function buildSharedNavItems(sharedNodes: SharedNodeVO[], sharedMarkerLabel: string): NavItem[] {
  return sharedNodes.flatMap((node) => {
    const url = nodeHref(node);
    return url
      ? [
          {
            title: node.name,
            url,
            icon: nodeIconGlyph(resolveNodeIcon(node)),
            id: node.nodeId,
            statusIcon: Globe,
            statusIconTitle: sharedMarkerLabel,
          },
        ]
      : [];
  });
}

/**
 * Build the sidebar's "Recent" rows from the client-side known-node cache.
 *
 * A DEDICATED builder rather than `buildNavItem`, because a `KnownNode` is not
 * a `NodeVO` and the difference is not cosmetic: the cache stores only
 * `id`/`type`/`name`/`slug`/`path`/`icon`/`lastVisitedAt`. It has no
 * `children`, no `parentId`, no `shared`, no `description`, no `settings` — all
 * of which `buildNavItem` reads to decide the "•••" menu, the published marker
 * and the folder chrome. Synthesizing them would mean inventing answers (a
 * "not shared" marker for a node that IS shared; a Delete action reporting a
 * child count of zero for a folder that has twenty), so these rows are plain
 * navigation links and nothing more. The tree, or the node's own page, is
 * where those actions live.
 *
 * Order is the caller's: `snapshot.visited` is already newest-first.
 */
function buildRecentNavItems(recentNodes: KnownNode[]): NavItem[] {
  return recentNodes.map((node) => ({
    title: node.name,
    // The cache stores the node's route path at write time (`nodeRoutePath`),
    // so there is nothing to re-derive here.
    url: node.path,
    icon: nodeIconGlyph(resolveNodeIcon(node)),
    id: node.id,
  }));
}
