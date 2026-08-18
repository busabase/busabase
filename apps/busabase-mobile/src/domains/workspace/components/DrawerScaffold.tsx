import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { selectPendingChangeRequests } from "busabase-core/dashboard/home";
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
import { useI18n } from "~/i18n";
import { mobile } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useContextualNavDestination } from "../hooks/use-contextual-nav-destination";
import { useExpandedNodeIds } from "../hooks/use-expanded-node-ids";
import { useKnownNodeCache } from "../hooks/use-known-node-cache";
import { flattenNodesForCache, nodeToKnownNode } from "../utils/known-node-cache";
import { getMobileNodeDestination } from "../utils/node-navigation";
import { getAppNavigationLayout } from "../utils/responsive-layout";
import { ancestorIdsOfActiveNode, expandNodes } from "../utils/tree-expansion";
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

  const nodesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "nodes"], queryFn: skipToken }),
    enabled: sidebarVisible && !!buda,
  });

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
    if (!nodeCache || !nodesQuery.data) return;
    void nodeCache.merge(flattenNodesForCache(nodesQuery.data));
  }, [nodeCache, nodesQuery.data]);

  const treeNodes = useMemo(() => {
    const roots = nodesQuery.data ?? [];
    return roots.length === 1 && hasCapability(roots[0].type, "container") && !roots[0].baseId
      ? roots[0].children
      : roots;
  }, [nodesQuery.data]);

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

  const openCreate = (parent: { id: string; name: string } | null) => {
    setActionsTarget(null);
    setOpen(false);
    setCreateParent(parent);
    setCreateOpen(true);
  };

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
      onDismiss={() => setOpen(false)}
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
