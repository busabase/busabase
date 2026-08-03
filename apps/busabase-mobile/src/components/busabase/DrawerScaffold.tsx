import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasCapability } from "busabase-contract/domains";
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
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeScreen } from "~/components/native-screen";
import { fmt, useI18n } from "~/i18n";
import { useContextualNavDestination } from "~/lib/contextual-nav";
import { type DrawerDestination, isDrawerItemActive, isPathActive } from "~/lib/nav-destinations";
import { getAppNavigationLayout } from "~/lib/responsive-layout";
import {
  ancestorIdsOfActiveNode,
  expandNodes,
  toggleNodeExpanded,
  useExpandedNodeIds,
} from "~/lib/tree-expansion";
import { flattenNodesForCache, nodeToKnownNode } from "~/search/known-node-cache";
import { nodeIconForType } from "~/search/node-icons";
import { getMobileNodeDestination, isMobileNodePathActive } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { CreateNodeModal } from "./CreateNodeModal";
import { NodeActionsSheet } from "./NodeActionsSheet";
import { SpaceSelector } from "./SpaceSelector";

interface DrawerScaffoldProps {
  title: string;
  titleNumberOfLines?: 1 | 2;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerLeading?: ReactNode;
  headerAction?: ReactNode;
  footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

// Pinned nav, mirroring the web dashboard's resting sidebar: Home (the landing
// digest) + Search. Everything else moved into the Space Selector menu, and at
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
  titleNumberOfLines,
  subtitle,
  children,
  refreshing,
  onRefresh,
  headerLeading: customHeaderLeading,
  headerAction,
  footer,
  contentContainerStyle,
}: DrawerScaffoldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const navigationLayout = getAppNavigationLayout(windowWidth, windowHeight);
  const sidebarVisible = open || navigationLayout.persistentSidebar;
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();
  const queryClient = useQueryClient();
  // The container the Create sheet should create INSIDE, or null for the space
  // root (the Workspace group's Create action). Mirrors web's `createParent` state.
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
    enabled: sidebarVisible && !!buda,
  });

  // The "N waiting for you" signal the web sidebar carries on its Home row.
  // Gated on sidebar visibility like the node tree — compact screens do not
  // fetch sidebar-only data until the user opens the drawer.
  const changeRequestsQuery = useQuery({
    ...(buda
      ? buda.orpc.changeRequests.list.queryOptions({
          input: {},
          select: (page) => page.changeRequests,
        })
      : { queryKey: ["no-connection", "change-requests"], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda,
  });
  const pendingCount = selectPendingChangeRequests(changeRequestsQuery.data ?? []).length;

  // Notion-style Favorites — the current actor's favorited nodes, in their own
  // query entry, invalidated after every toggle exactly like the web sidebar
  // (`dashboard-shell.tsx`). Gated like the tree above: compact screens do not
  // fetch favorites until the user opens the drawer.
  const favoritesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.listFavorites.queryOptions()
      : { queryKey: ["no-connection", "favorites"], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda,
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
    enabled: sidebarVisible && !!buda,
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
  // Reveal where you are: open every ancestor of the active node so the tree
  // shows your current location instead of making you re-drill each time. Only
  // ever ADDITIVE — it never closes a folder the user closed by hand, and it
  // no-ops (no state change, no re-render) once the chain is already open.
  useEffect(() => {
    expandNodes(ancestorIdsOfActiveNode(treeNodes, (node) => isNodeActive(node, pathname)));
  }, [treeNodes, pathname]);

  useEffect(() => {
    if (navigationLayout.persistentSidebar) setOpen(false);
  }, [navigationLayout.persistentSidebar]);

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

  const nodeActionsSheet = actionsTarget ? (
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
              setActionsTarget(null);
              setOpen(false);
              setCreateParent({ id: node.id, name: node.name });
              setCreateOpen(true);
            }
          : undefined
      }
    />
  ) : null;

  const drawerPanel = (
    <View
      style={[
        styles.drawer,
        navigationLayout.persistentSidebar ? null : styles.compactDrawer,
        {
          width: navigationLayout.persistentSidebar
            ? navigationLayout.sidebarWidth
            : mobile.drawerWidth,
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
          paddingTop: Platform.select({
            web: navigationLayout.persistentSidebar ? 0 : mobile.headerHeight,
            default: insets.top,
          }),
          paddingBottom: Platform.select({ web: 0, default: insets.bottom }),
        },
      ]}
    >
      <View style={[styles.spaceWrap, { borderColor: tokens.border }]}>
        <SpaceSelector presentation="popover" onDismissContainer={() => setOpen(false)} />
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
                style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
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
              style={[typography.caption, styles.sectionLabel, { color: tokens.mutedForeground }]}
            >
              {t.nav.workspace}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.nav.create}
              hitSlop={mobile.hitSlop}
              style={({ pressed }) => [
                styles.workspaceCreateButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
              onPress={() => {
                setOpen(false);
                setCreateParent(null);
                setCreateOpen(true);
              }}
            >
              <Plus size={16} color={tokens.mutedForeground} />
            </Pressable>
          </View>
          <View style={styles.navGroup}>
            {nodesQuery.isLoading ? (
              <Text
                style={[typography.small, styles.sectionHint, { color: tokens.mutedForeground }]}
              >
                {t.nav.workspaceLoading}
              </Text>
            ) : null}
            {nodesQuery.error ? (
              <Text style={[typography.small, styles.sectionHint, { color: tokens.destructive }]}>
                {t.nav.workspaceError}
              </Text>
            ) : null}
            {!nodesQuery.isLoading && !nodesQuery.error && treeNodes.length === 0 ? (
              <Text
                style={[typography.small, styles.sectionHint, { color: tokens.mutedForeground }]}
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
  );

  return (
    <>
      <View style={styles.scaffold}>
        {navigationLayout.persistentSidebar ? drawerPanel : null}
        <View style={styles.contentPane}>
          <NativeScreen
            title={title}
            titleNumberOfLines={titleNumberOfLines}
            subtitle={subtitle}
            refreshing={refreshing}
            onRefresh={onRefresh}
            headerLeading={
              customHeaderLeading ??
              (navigationLayout.persistentSidebar ? undefined : headerLeading)
            }
            headerAction={headerAction}
            footer={footer}
            contentContainerStyle={contentContainerStyle}
          >
            {children}
          </NativeScreen>
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={open && !navigationLayout.persistentSidebar}
        onRequestClose={() => setOpen(false)}
      >
        <View style={[styles.modal, { backgroundColor: tokens.scrim }]}>
          {drawerPanel}
          <Pressable
            accessibilityLabel="Close navigation drawer"
            accessibilityRole="button"
            style={styles.edgeDismiss}
            onPress={() => setOpen(false)}
          />
          {/* Keep phone actions in the drawer portal so the drawer stays behind
              the sheet. Tablet actions render beside the persistent shell. */}
          {navigationLayout.persistentSidebar ? null : nodeActionsSheet}
        </View>
      </Modal>

      {navigationLayout.persistentSidebar ? nodeActionsSheet : null}

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
  scaffold: { flex: 1, flexDirection: "row" },
  contentPane: { flex: 1, minWidth: 0 },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modal: { flex: 1, flexDirection: "row" },
  edgeDismiss: { flex: 1 },
  drawer: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  compactDrawer: { maxWidth: "82%" },
  spaceWrap: {
    zIndex: 20,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  drawerScroll: { flex: 1 },
  drawerBody: { gap: 18, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 20 },
  drawerFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: Platform.select({ web: spacing[4], default: spacing[2] }),
  },
  navGroup: { gap: 2 },
  section: { gap: 7 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  workspaceCreateButton: {
    width: 28,
    height: 28,
    marginVertical: -6,
    alignItems: "center",
    justifyContent: "center",
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
  nodeMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
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
});

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

// Per-node-type icon and whether the row navigates somewhere.
function nodeNavMeta(node: NodeVO) {
  return {
    icon: nodeIconForType(node.type),
    tappable: hasCapability(node.type, "hasDetail"),
  };
}

const isNodeActive = (node: NodeVO, pathname: string) => isMobileNodePathActive(node, pathname);

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
  // Every container gets a chevron, even an empty one — web renders the same
  // collapsible for any container row (`item.items` is `[]`, still truthy), so
  // the affordance doesn't blink in and out as a folder gains its first child.
  const isContainer = collapsible && hasCapability(node.type, "container");
  const expanded = isContainer && expandedIds.has(node.id);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <View
        style={[
          styles.navItem,
          styles.baseItem,
          {
            backgroundColor: active ? tokens.primaryMuted : "transparent",
            paddingLeft: 8 + depth * 12,
          },
        ]}
      >
        <View
          style={[styles.activeMark, { backgroundColor: active ? tokens.primary : "transparent" }]}
        />
        {/* Independent sibling targets avoid nested buttons on React Native Web. */}
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
        {meta.tappable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${node.name}`}
            style={({ pressed }) => [styles.nodeMain, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => onPress(node)}
          >
            <Icon size={18} color={active ? tokens.primary : tokens.mutedForeground} />
            <Text
              numberOfLines={1}
              style={[
                typography.bodyEm,
                styles.baseText,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {node.name}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.nodeMain}>
            <Icon size={18} color={active ? tokens.primary : tokens.mutedForeground} />
            <Text
              numberOfLines={1}
              style={[
                typography.body,
                styles.baseText,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {node.name}
            </Text>
          </View>
        )}
        {/* Persistent because touch has no hover affordance. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.nodeActions.more} — ${node.name}`}
          hitSlop={mobile.hitSlop}
          style={({ pressed }) => [styles.nodeActionsButton, { opacity: pressed ? 0.6 : 1 }]}
          onPress={() => onOpenActions(node)}
        >
          <MoreHorizontal size={18} color={tokens.mutedForeground} />
        </Pressable>
      </View>
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
