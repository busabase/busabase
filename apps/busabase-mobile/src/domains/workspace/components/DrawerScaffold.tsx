import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { NODE_TREE_PREFETCH_DEPTH } from "busabase-core/dashboard/node-tree-depth";
import { useLazyNodeChildren } from "busabase-core/dashboard/use-lazy-node-children";
import { usePathname, useRouter } from "expo-router";
import { Menu } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  type StyleProp,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeScreen } from "~/components/native-screen";
import { InstallFromGithubSheet } from "~/domains/install/components/InstallFromGithubSheet";
import { usePendingChangeRequests } from "~/domains/review/hooks/use-pending-change-requests";
import { useI18n } from "~/i18n";
import { mobile } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useContextualNavDestination } from "../hooks/use-contextual-nav-destination";
import { useExpandedNodeIds } from "../hooks/use-expanded-node-ids";
import { useKnownNodeCache } from "../hooks/use-known-node-cache";
import {
  flattenNodesForCache,
  nodeToKnownNode,
  type OpenableNode,
} from "../utils/known-node-cache";
import { getMobileNodeDestination, parseMobileNodeRoute } from "../utils/node-navigation";
import { getAppNavigationLayout } from "../utils/responsive-layout";
import { ancestorIdsOfActiveNode, expandNodes, unloadedExpandedIds } from "../utils/tree-expansion";
import { CreateNodeModal } from "./CreateNodeModal";
import { DrawerNavigationPanel } from "./DrawerNavigationPanel";
import { isNodeActive, nodeNavMeta } from "./DrawerNavigationRows";
import { drawerScaffoldStyles as styles } from "./drawer-scaffold-styles";
import { NodeActionsSheet } from "./NodeActionsSheet";

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
  contentWidth?: "full" | "readable";
}

const EMPTY_NODES: NodeVO[] = [];

interface ActionsTarget {
  node: NodeVO;
  allowCreateChild: boolean;
}

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
  contentWidth = "full",
}: DrawerScaffoldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string; name: string } | null>(null);
  const [actionsTarget, setActionsTarget] = useState<ActionsTarget | null>(null);
  /**
   * Owned here, not in the SpaceSelector that triggers it.
   *
   * On a compact window the drawer is a `Modal`, and opening install dismisses
   * it — which unmounts everything under it. A sheet rendered inside the drawer
   * therefore disappeared in the same tick it was opened, and the "Install from
   * GitHub" button did nothing at all on a phone (it worked on a tablet, where
   * the sidebar is persistent and never unmounts). Rendering it out here, as a
   * sibling of the drawer Modal, is what makes it survive.
   */
  const [installOpen, setInstallOpen] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const navigationLayout = getAppNavigationLayout(windowWidth, windowHeight);
  const sidebarVisible = open || navigationLayout.persistentSidebar;
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();
  const queryClient = useQueryClient();

  // These stores live at module level in their utilities because the scaffold
  // remounts on every route. Reading them here preserves expansion and context.
  const expandedIds = useExpandedNodeIds();
  const contextualDestination = useContextualNavDestination(pathname);

  // Root + two levels, like the web sidebar; a deeper folder loads when it is
  // opened. This used to be the whole tree (1.3MB for 3,400 nodes) every time
  // the drawer opened. A server that predates `depth` ignores it and returns
  // the whole tree, which the code below handles the same way.
  const nodesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions({
          input: { parentId: null, depth: NODE_TREE_PREFETCH_DEPTH },
        })
      : { queryKey: ["no-connection", "nodes"], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda,
  });
  const {
    nodes: loadedTree,
    loadingNodeIds,
    onExpandNode,
  } = useLazyNodeChildren({
    orpc: buda?.orpc ?? null,
    baseNodes: nodesQuery.data ?? EMPTY_NODES,
  });
  // Expansion outlives this scaffold (it remounts on every route); loaded
  // children do not. Fetch every expanded folder the tree is missing, which is
  // also how a reveal below opens a path level by level. Cached reads return at
  // once.
  useEffect(() => {
    for (const nodeId of unloadedExpandedIds(loadedTree, expandedIds)) onExpandNode(nodeId);
  }, [loadedTree, expandedIds, onExpandNode]);

  // The folders above the open node, from the server: a deep node is not in
  // the loaded tree, so the local reveal below cannot find it. A server without
  // `nodes.ancestors` (before 2026-08-28) fails this quietly and keeps the
  // local reveal.
  const activeRoute = useMemo(() => parseMobileNodeRoute(pathname), [pathname]);
  const ancestorsQuery = useQuery({
    ...(buda && activeRoute
      ? buda.orpc.nodes.ancestors.queryOptions({
          input: { nodeId: activeRoute.ref, type: activeRoute.type },
        })
      : { queryKey: ["no-connection", "node-ancestors", pathname], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda && !!activeRoute,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  useEffect(() => {
    if (ancestorsQuery.data) expandNodes(ancestorsQuery.data.ancestorIds);
  }, [ancestorsQuery.data]);

  // Counted by the server, not by whatever fit in a page. This used to fetch
  // with an empty input — the default `limit: 50` — and count the rows that came
  // back, so the badge froze at 50 in any space with more than 50 open requests.
  const pending = usePendingChangeRequests({ enabled: sidebarVisible });
  // A capped count is not rendered at all: a badge is read as a total, and "50"
  // against a real 116 is worse than no badge.
  const pendingCount = pending.capped ? undefined : pending.count;

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

  const authQuery = useQuery({
    ...(buda
      ? buda.orpc.auth.verify.queryOptions()
      : { queryKey: ["no-connection", "auth"], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda,
  });
  const spaceId = authQuery.data?.space.id ?? null;
  const spaceName = authQuery.data?.space.name ?? null;
  const spaceVisibilityMode = authQuery.data?.space.nodeVisibilityMode ?? null;

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
    if (!nodeCache || loadedTree.length === 0) return;
    void nodeCache.merge(flattenNodesForCache(loadedTree));
  }, [nodeCache, loadedTree]);

  const treeNodes = useMemo(() => {
    const roots = loadedTree;
    return roots.length === 1 && hasCapability(roots[0].type, "container") && !roots[0].baseId
      ? roots[0].children
      : roots;
  }, [loadedTree]);

  useEffect(() => {
    expandNodes(ancestorIdsOfActiveNode(treeNodes, (node) => isNodeActive(node, pathname)));
  }, [treeNodes, pathname]);

  useEffect(() => {
    if (navigationLayout.persistentSidebar) setOpen(false);
  }, [navigationLayout.persistentSidebar]);

  const navigate = (href: string) => {
    setOpen(false);
    router.replace(href as never);
  };

  const navigateNode = useCallback(
    (node: OpenableNode) => {
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

  const openCreate = (parent: { id: string; name: string } | null) => {
    setActionsTarget(null);
    setOpen(false);
    setCreateParent(parent);
    setCreateOpen(true);
  };

  const nodeActionsSheet = actionsTarget ? (
    <NodeActionsSheet
      node={actionsTarget.node}
      nodes={loadedTree}
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
          ? (node) => openCreate({ id: node.id, name: node.name })
          : undefined
      }
    />
  ) : null;

  const drawerPanel = (
    <DrawerNavigationPanel
      persistentSidebar={navigationLayout.persistentSidebar}
      sidebarWidth={navigationLayout.sidebarWidth}
      insets={insets}
      pathname={pathname}
      t={t}
      pendingCount={pendingCount}
      contextualDestination={contextualDestination}
      favoriteNodes={favoriteNodes}
      treeNodes={treeNodes}
      nodesLoading={nodesQuery.isLoading}
      nodesError={!!nodesQuery.error}
      expandedIds={expandedIds}
      loadingNodeIds={loadingNodeIds}
      onDismiss={() => setOpen(false)}
      onRequestInstall={() => setInstallOpen(true)}
      onNavigate={navigate}
      onNavigateNode={navigateNode}
      onOpenActions={(node, allowCreateChild) => setActionsTarget({ node, allowCreateChild })}
      onCreateRoot={() => openCreate(null)}
    />
  );

  const defaultHeaderLeading = (
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
              (navigationLayout.persistentSidebar ? undefined : defaultHeaderLeading)
            }
            headerAction={headerAction}
            footer={footer}
            contentContainerStyle={contentContainerStyle}
            bodyContainerStyle={contentWidth === "readable" ? styles.readableContent : undefined}
            footerContentContainerStyle={
              contentWidth === "readable" ? styles.readableContent : undefined
            }
          >
            {children}
          </NativeScreen>
        </View>
      </View>

      <InstallFromGithubSheet
        visible={installOpen}
        onClose={() => setInstallOpen(false)}
        onReviewChangeRequests={() => {
          setInstallOpen(false);
          router.replace("/drawer/inbox");
        }}
      />

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
          router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } });
        }}
      />
    </>
  );
}
