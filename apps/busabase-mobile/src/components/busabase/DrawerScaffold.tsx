import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getNodeType, hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { selectPendingChangeRequests } from "busabase-core/dashboard/home";
import { usePathname, useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  House,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeScreen } from "~/components/native-screen";
import { fmt, useI18n } from "~/i18n";
import { useContextualNavDestination } from "~/lib/contextual-nav";
import { type DrawerDestination, isDrawerItemActive, isPathActive } from "~/lib/nav-destinations";
import {
  ancestorIdsOfActiveNode,
  expandNodes,
  toggleNodeExpanded,
  useExpandedNodeIds,
} from "~/lib/tree-expansion";
import { flattenNodesForCache, nodeToKnownNode } from "~/search/known-node-cache";
import { nodeIconForType } from "~/search/node-icons";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { CreateNodeModal } from "./CreateNodeModal";
import { NodeActionsSheet } from "./NodeActionsSheet";
import { SpaceSelector } from "./SpaceSelector";

interface DrawerScaffoldProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerAction?: ReactNode;
  footer?: ReactNode;
}

// Pinned nav, mirroring the web dashboard's resting sidebar: Home (the landing
// digest) + Search. Everything else moved into the Space Selector sheet, and at
// most ONE of those comes back as the contextual row below.
const pinnedItems = [
  { key: "home", href: "/drawer/home", icon: House },
  { key: "search", href: "/drawer/search", icon: Search },
] as const satisfies ReadonlyArray<DrawerDestination>;

const settingsItem = {
  key: "settings",
  href: "/drawer/settings",
  icon: Settings,
} as const satisfies DrawerDestination;

export function DrawerScaffold({
  title,
  subtitle,
  children,
  refreshing,
  onRefresh,
  headerAction,
  footer,
}: DrawerScaffoldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // The container the Create sheet should create INSIDE, or null for the space
  // root (the header's Create button). Mirrors web's `createParent` state.
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
  // The node whose "•••" sheet is showing, plus whether that row may offer
  // "New inside…". Favorites rows are flat (web strips their `onAddChild`), so
  // the flag travels with the node instead of being re-derived from its type.
  const [actionsTarget, setActionsTarget] = useState<{
    node: NodeVO;
    allowCreateChild: boolean;
  } | null>(null);
  // Which container rows are open. Module-level store, not component state:
  // this scaffold is remounted by every screen, so React state would collapse
  // the whole tree on every navigation. See `~/lib/tree-expansion`.
  const expandedIds = useExpandedNodeIds();
  // The single lingering row for the functional area last visited. Lives in a
  // module-level store because this scaffold is remounted by every screen.
  const contextualDestination = useContextualNavDestination(pathname);

  const nodesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions()
      : { queryKey: ["no-connection", "nodes"], queryFn: skipToken }),
    enabled: open && !!buda,
  });

  // The "N waiting for you" signal the web sidebar carries on its Home row.
  // Gated on `open` like the node tree — the drawer is the only place it shows.
  const changeRequestsQuery = useQuery({
    ...(buda
      ? buda.orpc.changeRequests.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "change-requests"], queryFn: skipToken }),
    enabled: open && !!buda,
  });
  const pendingCount = selectPendingChangeRequests(changeRequestsQuery.data ?? []).length;

  // Notion-style Favorites — the current actor's favorited nodes, in their own
  // query entry, invalidated after every toggle exactly like the web sidebar
  // (`dashboard-shell.tsx`). Gated on `open` like the tree above: the drawer is
  // the only surface that renders them.
  const favoritesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.listFavorites.queryOptions()
      : { queryKey: ["no-connection", "favorites"], queryFn: skipToken }),
    enabled: open && !!buda,
  });
  const favoriteNodes = favoritesQuery.data ?? [];
  const favoriteNodeIds = useMemo(
    () => new Set(favoriteNodes.map((node) => node.id)),
    [favoriteNodes],
  );

  // The space the connection is scoped to. Needed by two of the node actions —
  // Share builds the public `/dashboard/<spaceId>/…` URL from it, and Agent
  // prompts name it so the agent knows where to work. `auth.verify` is the one
  // endpoint that answers this in EVERY connection mode (the open-source server
  // returns its local space; cloud resolves the one the `x-busabase-space`
  // header selected), unlike the cloud-only `/api/v1/auth` the Space Selector
  // uses for its workspace list.
  const authQuery = useQuery({
    ...(buda
      ? buda.orpc.auth.verify.queryOptions()
      : { queryKey: ["no-connection", "auth"], queryFn: skipToken }),
    enabled: open && !!buda,
  });
  const spaceId = authQuery.data?.space.id ?? null;
  const spaceName = authQuery.data?.space.name ?? null;
  // The space's Open/Restricted content default, off the SAME auth.verify
  // response (no second request). The Permissions sheet needs it to describe a
  // node's effective access; a server that predates the field omits it, which
  // means `open` — the historical default.
  const spaceVisibilityMode = authQuery.data?.space.nodeVisibilityMode ?? null;

  // Plain invalidate-and-refetch, no optimistic cache write — same P0 tradeoff
  // the web sidebar makes: the Favorites list is small and this keeps the
  // handler honest about what the server actually stored.
  const toggleFavoriteMutation = useMutation({
    mutationFn: async (node: NodeVO) => {
      if (!buda) throw new Error(t.common.notConnected);
      return buda.client.nodes.toggleFavorite({ nodeId: node.id });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: buda?.orpc.nodes.listFavorites.key() });
    },
  });

  useEffect(() => {
    if (!nodeCache || !nodesQuery.data) return;
    void nodeCache.merge(flattenNodesForCache(nodesQuery.data));
  }, [nodeCache, nodesQuery.data]);

  // Unwrap the single root workspace folder so its contents show directly,
  // instead of a redundant "Local workspace" row (matches the web sidebar).
  // Memoised so the auto-expand effect below keys off the DATA changing, not
  // off every render producing a fresh array.
  const treeNodes = useMemo(() => {
    const roots = nodesQuery.data ?? [];
    return roots.length === 1 && hasCapability(roots[0].type, "container") && !roots[0].baseId
      ? roots[0].children
      : roots;
  }, [nodesQuery.data]);
  const workspaceNodeCount = countTreeNodes(treeNodes);

  // Reveal where you are: open every ancestor of the active node so the tree
  // shows your current location instead of making you re-drill each time. Only
  // ever ADDITIVE — it never closes a folder the user closed by hand, and it
  // no-ops (no state change, no re-render) once the chain is already open.
  useEffect(() => {
    expandNodes(ancestorIdsOfActiveNode(treeNodes, (node) => isNodeActive(node, pathname)));
  }, [treeNodes, pathname]);

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open navigation drawer"
      hitSlop={mobile.hitSlop}
      style={[styles.menuButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => setOpen(true)}
    >
      <Menu size={22} color={tokens.foreground} />
    </Pressable>
  );

  const navigate = (href: string) => {
    setOpen(false);
    router.replace(href as never);
  };

  const navigateNode = useCallback(
    (node: NodeVO) => {
      const destination = getMobileNodeDestination(node);
      if (destination.status === "unsupported") return;
      setActionsTarget(null);
      setOpen(false);
      void (async () => {
        await nodeCache?.merge([nodeToKnownNode(node)]);
        await nodeCache?.markVisited(node.id);
        router.push({ pathname: destination.pathname, params: destination.params } as never);
      })();
    },
    [nodeCache, router],
  );

  return (
    <>
      <NativeScreen
        title={title}
        subtitle={subtitle}
        refreshing={refreshing}
        onRefresh={onRefresh}
        headerLeading={headerLeading}
        headerAction={
          headerAction ? (
            <View style={styles.headerActions}>
              <SpaceSelector compact />
              {headerAction}
            </View>
          ) : (
            <SpaceSelector compact />
          )
        }
        footer={footer}
      >
        {children}
      </NativeScreen>

      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { backgroundColor: tokens.scrim }]}>
          <View
            style={[
              styles.drawer,
              {
                backgroundColor: tokens.surface,
                borderColor: tokens.border,
              },
            ]}
          >
            <View style={[styles.drawerHeader, { borderColor: tokens.border }]}>
              <View style={styles.drawerTitle}>
                <Text style={[typography.h2, { color: tokens.foreground }]}>Busabase</Text>
                <Text
                  numberOfLines={1}
                  style={[typography.small, { color: tokens.mutedForeground }]}
                >
                  Review workspace
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.nav.create}
                hitSlop={mobile.hitSlop}
                style={[styles.createButton, { backgroundColor: tokens.primary }]}
                onPress={() => {
                  setOpen(false);
                  setCreateParent(null);
                  setCreateOpen(true);
                }}
              >
                <Plus size={18} color={tokens.primaryForeground} />
                <Text
                  style={[
                    typography.small,
                    styles.createLabel,
                    { color: tokens.primaryForeground },
                  ]}
                >
                  {t.nav.create}
                </Text>
              </Pressable>
            </View>
            <View style={styles.spaceWrap}>
              <SpaceSelector />
            </View>

            <ScrollView
              contentContainerStyle={styles.drawerBody}
              style={styles.drawerScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.navGroup}>
                {pinnedItems.map((item) => (
                  <DrawerNavRow
                    key={item.href}
                    active={isDrawerItemActive(pathname, item)}
                    badge={item.key === "home" ? pendingCount : undefined}
                    icon={item.icon}
                    label={t.nav[item.key]}
                    onPress={() => navigate(item.href)}
                  />
                ))}
                {/* At most one — replaced, never stacked, so the drawer can't
                    regrow into the shortcut list this design replaced. */}
                {contextualDestination ? (
                  <DrawerNavRow
                    active={isDrawerItemActive(pathname, contextualDestination)}
                    badge={contextualDestination.key === "inbox" ? pendingCount : undefined}
                    icon={contextualDestination.icon}
                    label={t.nav[contextualDestination.key]}
                    onPress={() => navigate(contextualDestination.href)}
                  />
                ) : null}
              </View>

              {/* An empty Favorites section is exactly the clutter this feature
                  is meant to reduce, so it only exists once the actor has
                  favorited at least one (still-visible, non-archived) node —
                  same rule and same position as the web sidebar: after the
                  contextual row, before the Workspace tree. `listFavorites`
                  returns fully-resolved nodes, not a tree, so each row is flat
                  (depth 0, no children) exactly like web's
                  `toFlatFavoriteNavItem`. */}
              {favoriteNodes.length > 0 ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text
                      style={[
                        typography.caption,
                        styles.sectionLabel,
                        { color: tokens.mutedForeground },
                      ]}
                    >
                      {t.nav.favorites}
                    </Text>
                    <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                      {favoriteNodes.length}
                    </Text>
                  </View>
                  <View style={styles.navGroup}>
                    {favoriteNodes.map((node) => (
                      <NodeNavItem
                        key={`favorite-${node.id}`}
                        node={{ ...node, children: [] }}
                        pathname={pathname}
                        depth={0}
                        // Flat rows: no chevron, no "New inside…" — exactly
                        // what web's `toFlatFavoriteNavItem` strips off.
                        collapsible={false}
                        expandedIds={expandedIds}
                        onPress={navigateNode}
                        onToggleExpanded={toggleNodeExpanded}
                        onOpenActions={(target) =>
                          setActionsTarget({ node: target, allowCreateChild: false })
                        }
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text
                    style={[
                      typography.caption,
                      styles.sectionLabel,
                      { color: tokens.mutedForeground },
                    ]}
                  >
                    {t.nav.workspace}
                  </Text>
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                    {workspaceNodeCount}
                  </Text>
                </View>
                <View style={styles.navGroup}>
                  {nodesQuery.isLoading ? (
                    <Text
                      style={[
                        typography.small,
                        styles.sectionHint,
                        { color: tokens.mutedForeground },
                      ]}
                    >
                      {t.nav.workspaceLoading}
                    </Text>
                  ) : null}
                  {nodesQuery.error ? (
                    <Text
                      style={[typography.small, styles.sectionHint, { color: tokens.destructive }]}
                    >
                      {t.nav.workspaceError}
                    </Text>
                  ) : null}
                  {!nodesQuery.isLoading && !nodesQuery.error && treeNodes.length === 0 ? (
                    <Text
                      style={[
                        typography.small,
                        styles.sectionHint,
                        { color: tokens.mutedForeground },
                      ]}
                    >
                      {t.nav.workspaceEmpty}
                    </Text>
                  ) : null}
                  {treeNodes.map((node) => (
                    <NodeNavItem
                      key={node.id}
                      node={node}
                      pathname={pathname}
                      depth={0}
                      expandedIds={expandedIds}
                      onPress={navigateNode}
                      onToggleExpanded={toggleNodeExpanded}
                      onOpenActions={(target) =>
                        setActionsTarget({ node: target, allowCreateChild: true })
                      }
                    />
                  ))}
                </View>
              </View>
            </ScrollView>
            <View style={[styles.drawerFooter, { borderColor: tokens.border }]}>
              <DrawerNavRow
                active={isPathActive(pathname, settingsItem.href)}
                icon={settingsItem.icon}
                label={t.nav.settings}
                onPress={() => navigate(settingsItem.href)}
              />
            </View>
          </View>
          <Pressable
            accessibilityLabel="Close navigation drawer"
            accessibilityRole="button"
            style={styles.edgeDismiss}
            onPress={() => setOpen(false)}
          />
          {/* Rendered inside the drawer Modal (same as SpaceSelector's sheet)
              so the drawer stays put behind it — a node action shouldn't cost
              the user their place in the tree. `nodes` is the RAW tree, not
              the unwrapped `treeNodes`: the move picker needs the real root
              container as a destination. */}
          {actionsTarget ? (
            <NodeActionsSheet
              node={actionsTarget.node}
              nodes={nodesQuery.data ?? []}
              canOpen={nodeNavMeta(actionsTarget.node).tappable}
              isFavorite={favoriteNodeIds.has(actionsTarget.node.id)}
              spaceId={spaceId}
              spaceName={spaceName}
              spaceVisibilityMode={spaceVisibilityMode}
              onClose={() => setActionsTarget(null)}
              onOpenNode={navigateNode}
              onToggleFavorite={(node) => toggleFavoriteMutation.mutate(node)}
              onCreateChild={
                actionsTarget.allowCreateChild
                  ? (node) => {
                      // Same hand-off as the header's Create button — the
                      // Create sheet lives OUTSIDE the drawer Modal, so the
                      // drawer and this sheet both have to close first.
                      setActionsTarget(null);
                      setOpen(false);
                      setCreateParent({ id: node.id, name: node.name });
                      setCreateOpen(true);
                    }
                  : undefined
              }
            />
          ) : null}
        </View>
      </Modal>

      <CreateNodeModal
        visible={createOpen}
        parent={createParent}
        onClose={() => {
          setCreateOpen(false);
          setCreateParent(null);
        }}
        onCreated={(changeRequestId) => {
          setCreateOpen(false);
          setCreateParent(null);
          // Node creation is a change request; open it for review (the node appears after merge).
          router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  modal: { flex: 1, flexDirection: "row" },
  edgeDismiss: { flex: 1 },
  drawer: {
    width: mobile.drawerWidth,
    maxWidth: "82%",
    paddingTop: Platform.select({ ios: 58, android: 38, default: 48 }),
    borderRightWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      web: { boxShadow: "8px 0 24px rgba(0, 0, 0, 0.12)" },
      default: {
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 8, height: 0 },
        elevation: 12,
      },
    }),
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  drawerTitle: { flex: 1, gap: 1, minWidth: 0 },
  createButton: {
    minWidth: 88,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
  },
  createLabel: { flexShrink: 1 },
  spaceWrap: { paddingHorizontal: 18, paddingTop: 14 },
  drawerScroll: { flex: 1 },
  drawerBody: { gap: 18, paddingHorizontal: 10, paddingTop: 18, paddingBottom: 20 },
  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: Platform.select({ ios: 22, android: 14, default: 14 }),
  },
  navGroup: { gap: 2 },
  section: { gap: 7 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  sectionLabel: { textTransform: "uppercase" },
  sectionHint: { paddingHorizontal: 12, paddingVertical: 8 },
  navItem: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingRight: 12,
    paddingLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  activeMark: {
    width: 3,
    height: 22,
    borderRadius: radius.full,
  },
  navLabel: { flex: 1, minWidth: 0 },
  navBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  baseItem: { alignItems: "center", paddingVertical: 8 },
  baseText: { flex: 1, minWidth: 0 },
  // Fixed width shared by the chevron and its non-container spacer, so labels
  // line up whether or not a row can be expanded.
  nodeChevron: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  nodeActionsButton: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
});

function countTreeNodes(nodes: NodeVO[]): number {
  return nodes.reduce((count, node) => count + 1 + countTreeNodes(node.children), 0);
}

function DrawerNavRow({
  active,
  badge,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  /** Count of things waiting on the actor; hidden at 0, same as the web sidebar. */
  badge?: number;
  icon: DrawerDestination["icon"];
  label: string;
  onPress: () => void;
}) {
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.navItem, { backgroundColor: active ? tokens.primaryMuted : "transparent" }]}
      onPress={onPress}
    >
      <View
        style={[styles.activeMark, { backgroundColor: active ? tokens.primary : "transparent" }]}
      />
      <Icon size={20} color={active ? tokens.primary : tokens.mutedForeground} />
      <Text
        numberOfLines={1}
        style={[
          typography.bodyEm,
          styles.navLabel,
          { color: active ? tokens.foreground : tokens.mutedForeground },
        ]}
      >
        {label}
      </Text>
      {badge ? (
        <View style={[styles.navBadge, { backgroundColor: tokens.primaryMuted }]}>
          <Text style={[typography.caption, { color: tokens.foreground }]}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// Per-node-type icon, subtitle, and whether the row navigates somewhere — all
// driven by the node-type registry (tappable = the type has a detail screen).
function nodeNavMeta(node: NodeVO) {
  const definition = getNodeType(node.type);
  const label = definition?.label ?? node.type;
  const mobileUnsupported = node.type === "file";
  return {
    icon: nodeIconForType(node.type),
    subtitle: mobileUnsupported
      ? `${label} · Not viewable on mobile yet`
      : node.type === "base"
        ? `${label} · ${node.slug}`
        : label,
    tappable: hasCapability(node.type, "hasDetail") && !mobileUnsupported,
  };
}

function isNodeActive(node: NodeVO, pathname: string) {
  if (node.type === "base") {
    return isPathActive(pathname, `/base/${node.slug}`);
  }
  if (node.type === "skill") {
    return isPathActive(pathname, `/skill/${node.id}`);
  }
  if (node.type === "drive") {
    return isPathActive(pathname, `/drive/${node.id}`);
  }
  if (node.type === "airapp") {
    return isPathActive(pathname, `/airapp/${node.id}`);
  }
  if (node.type === "doc") {
    return isPathActive(pathname, `/doc/${node.id}`);
  }
  if (node.type === "folder") {
    return isPathActive(pathname, `/folder/${node.id}`);
  }
  return false;
}

function NodeNavItem({
  node,
  pathname,
  depth,
  expandedIds,
  collapsible = true,
  onPress,
  onToggleExpanded,
  onOpenActions,
}: {
  node: NodeVO;
  pathname: string;
  depth: number;
  /** The expansion snapshot, threaded down so the whole tree shares one read. */
  expandedIds: ReadonlySet<string>;
  /** False for the flat Favorites rows, which have no children to reveal. */
  collapsible?: boolean;
  onPress: (node: NodeVO) => void;
  onToggleExpanded: (nodeId: string) => void;
  /** Opens the per-node "•••" action sheet (rename / permissions / move). */
  onOpenActions: (node: NodeVO) => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const meta = nodeNavMeta(node);
  const active = isNodeActive(node, pathname);
  // Node types flagged `hidden` never appear in the tree, matching the web
  // sidebar (`buildNavItem` bails on the same capability). No type sets it
  // today, so this exists to keep the two platforms from silently diverging
  // the day one does.
  if (hasCapability(node.type, "hidden")) return null;
  const Icon = meta.icon;
  const showSubtitle = depth === 0 || active;
  // Every container gets a chevron, even an empty one — web renders the same
  // collapsible for any container row (`item.items` is `[]`, still truthy), so
  // the affordance doesn't blink in and out as a folder gains its first child.
  const isContainer = collapsible && hasCapability(node.type, "container");
  const expanded = isContainer && expandedIds.has(node.id);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <Pressable
        accessibilityRole={meta.tappable ? "button" : undefined}
        accessibilityLabel={meta.tappable ? `Open ${node.name}` : undefined}
        disabled={!meta.tappable}
        style={[
          styles.navItem,
          styles.baseItem,
          {
            backgroundColor: active ? tokens.primaryMuted : "transparent",
            paddingLeft: 8 + depth * 12,
          },
        ]}
        onPress={() => onPress(node)}
      >
        <View
          style={[styles.activeMark, { backgroundColor: active ? tokens.primary : "transparent" }]}
        />
        {/* Collapse toggle. Its own Pressable nested inside the row's, exactly
            like the "•••" below, so tapping the chevron only opens/closes while
            tapping the label still opens the node. Non-container rows render
            the same-width spacer so every label in the tree stays aligned. */}
        {isContainer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={fmt(expanded ? t.nodeActions.collapse : t.nodeActions.expand, {
              name: node.name,
            })}
            hitSlop={mobile.hitSlop}
            style={({ pressed }) => [styles.nodeChevron, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => onToggleExpanded(node.id)}
          >
            <ChevronIcon size={16} color={active ? tokens.primary : tokens.mutedForeground} />
          </Pressable>
        ) : (
          <View style={styles.nodeChevron} />
        )}
        <Icon size={18} color={active ? tokens.primary : tokens.mutedForeground} />
        <View style={styles.baseText}>
          <Text
            numberOfLines={1}
            style={[
              meta.tappable ? typography.bodyEm : typography.body,
              { color: active ? tokens.foreground : tokens.mutedForeground },
            ]}
          >
            {node.name}
          </Text>
          {showSubtitle ? (
            <Text numberOfLines={1} style={[typography.caption, { color: tokens.mutedForeground }]}>
              {meta.subtitle}
            </Text>
          ) : null}
        </View>
        {/* Persistent, not hover-revealed like web's "•••": there is no hover
            on touch, and a long-press would be undiscoverable. Its own
            Pressable nested inside the row's, so tapping the label still
            opens the node. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.nodeActions.more} — ${node.name}`}
          hitSlop={mobile.hitSlop}
          style={({ pressed }) => [styles.nodeActionsButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => onOpenActions(node)}
        >
          <MoreHorizontal size={18} color={tokens.mutedForeground} />
        </Pressable>
      </Pressable>
      {/* Collapsed by default, matching web: children only mount once the row
          is expanded, so opening the drawer no longer renders the entire
          workspace (156 rows on the demo space) up front. */}
      {expanded
        ? node.children.map((child) => (
            <NodeNavItem
              key={child.id}
              node={child}
              pathname={pathname}
              depth={depth + 1}
              expandedIds={expandedIds}
              onPress={onPress}
              onToggleExpanded={onToggleExpanded}
              onOpenActions={onOpenActions}
            />
          ))
        : null}
    </>
  );
}
