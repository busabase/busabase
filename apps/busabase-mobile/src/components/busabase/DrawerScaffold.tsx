import { skipToken, useQuery } from "@tanstack/react-query";
import { getNodeType, hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { usePathname, useRouter } from "expo-router";
import {
  Activity,
  AppWindow,
  Archive,
  Bot,
  FileText,
  Folder,
  HardDrive,
  Images,
  Inbox,
  Menu,
  Network,
  Plus,
  Search,
  Settings,
  Sparkles,
  Table2,
} from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeScreen } from "~/components/native-screen";
import { useI18n } from "~/i18n";
import type { CoreMessages } from "~/i18n/messages";
import { flattenNodesForCache, nodeToKnownNode } from "~/search/known-node-cache";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { CreateNodeModal } from "./CreateNodeModal";
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

type NavKey = keyof CoreMessages["nav"];
type DrawerItem = {
  key: NavKey;
  href: string;
  icon: typeof Inbox;
  activePaths?: string[];
};

// Mirrors the web dashboard's primary nav (Inbox · Search · Activity · Graph View).
const reviewItems = [
  { key: "inbox", href: "/drawer/inbox", icon: Inbox, activePaths: ["/change-requests"] },
  { key: "search", href: "/drawer/search", icon: Search },
  { key: "activity", href: "/drawer/activity", icon: Activity },
  { key: "graph", href: "/drawer/graph", icon: Network },
] as const satisfies ReadonlyArray<DrawerItem>;

// Shared media library + trash, mirroring the web dashboard's Assets + Archived views.
const libraryItems = [
  { key: "records", href: "/drawer/records", icon: FileText, activePaths: ["/records"] },
  { key: "bases", href: "/drawer/bases", icon: Table2, activePaths: ["/base"] },
  { key: "assets", href: "/drawer/assets", icon: Images, activePaths: ["/assets"] },
  { key: "archived", href: "/drawer/archived", icon: Archive },
] as const satisfies ReadonlyArray<DrawerItem>;

const settingsItem = {
  key: "settings",
  href: "/drawer/settings",
  icon: Settings,
} as const satisfies DrawerItem;

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
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const nodesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions()
      : { queryKey: ["no-connection", "nodes"], queryFn: skipToken }),
    enabled: open && !!buda,
  });

  useEffect(() => {
    if (!nodeCache || !nodesQuery.data) return;
    void nodeCache.merge(flattenNodesForCache(nodesQuery.data));
  }, [nodeCache, nodesQuery.data]);

  // Unwrap the single root workspace folder so its contents show directly,
  // instead of a redundant "Local workspace" row (matches the web sidebar).
  const treeNodes =
    nodesQuery.data?.length === 1 &&
    hasCapability(nodesQuery.data[0].type, "container") &&
    !nodesQuery.data[0].baseId
      ? nodesQuery.data[0].children
      : (nodesQuery.data ?? []);
  const knowledgeCount = countKnowledgeNodes(treeNodes);

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
              <View style={styles.section}>
                <Text
                  style={[
                    typography.caption,
                    styles.sectionLabel,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {t.nav.review}
                </Text>
                <View style={styles.navGroup}>
                  {reviewItems.map((item) => {
                    const active = isDrawerItemActive(pathname, item);
                    return (
                      <DrawerNavRow
                        key={item.href}
                        active={active}
                        icon={item.icon}
                        label={t.nav[item.key]}
                        onPress={() => navigate(item.href)}
                      />
                    );
                  })}
                </View>
              </View>

              <View style={styles.section}>
                <Text
                  style={[
                    typography.caption,
                    styles.sectionLabel,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {t.nav.library}
                </Text>
                <View style={styles.navGroup}>
                  {libraryItems.map((item) => {
                    const active = isDrawerItemActive(pathname, item);
                    return (
                      <DrawerNavRow
                        key={item.href}
                        active={active}
                        icon={item.icon}
                        label={t.nav[item.key]}
                        onPress={() => navigate(item.href)}
                      />
                    );
                  })}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text
                    style={[
                      typography.caption,
                      styles.sectionLabel,
                      { color: tokens.mutedForeground },
                    ]}
                  >
                    {t.nav.knowledge}
                  </Text>
                  <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                    {knowledgeCount}
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
                      Loading knowledge
                    </Text>
                  ) : null}
                  {nodesQuery.error ? (
                    <Text
                      style={[typography.small, styles.sectionHint, { color: tokens.destructive }]}
                    >
                      Could not load knowledge
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
                      No knowledge yet
                    </Text>
                  ) : null}
                  {treeNodes.map((node) => (
                    <NodeNavItem
                      key={node.id}
                      node={node}
                      pathname={pathname}
                      depth={0}
                      onPress={navigateNode}
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
        </View>
      </Modal>

      <CreateNodeModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(changeRequestId) => {
          setCreateOpen(false);
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
  baseItem: { alignItems: "center", paddingVertical: 8 },
  baseText: { flex: 1, minWidth: 0 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
});

function countKnowledgeNodes(nodes: NodeVO[]): number {
  return nodes.reduce((count, node) => count + 1 + countKnowledgeNodes(node.children), 0);
}

function DrawerNavRow({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: typeof Inbox;
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
        style={[typography.bodyEm, { color: active ? tokens.foreground : tokens.mutedForeground }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// Maps the registry's platform-neutral icon ids to lucide-react-native icons.
const NODE_ICONS: Record<string, typeof Folder> = {
  folder: Folder,
  table: Table2,
  sparkles: Sparkles,
  "file-text": FileText,
  bot: Bot,
  "hard-drive": HardDrive,
  "app-window": AppWindow,
};

// Per-node-type icon, subtitle, and whether the row navigates somewhere — all
// driven by the node-type registry (tappable = the type has a detail screen).
function nodeNavMeta(node: NodeVO) {
  const definition = getNodeType(node.type);
  const label = definition?.label ?? node.type;
  const mobileUnsupported = node.type === "file";
  return {
    icon: NODE_ICONS[definition?.icon ?? ""] ?? FileText,
    subtitle: mobileUnsupported
      ? `${label} · Not viewable on mobile yet`
      : node.type === "base"
        ? `${label} · ${node.slug}`
        : label,
    tappable: hasCapability(node.type, "hasDetail") && !mobileUnsupported,
  };
}

function isPathActive(pathname: string, basePath: string) {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function isDrawerItemActive(pathname: string, item: DrawerItem) {
  return [item.href, ...(item.activePaths ?? [])].some((path) => isPathActive(pathname, path));
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
  onPress,
}: {
  node: NodeVO;
  pathname: string;
  depth: number;
  onPress: (node: NodeVO) => void;
}) {
  const tokens = useTokens();
  const meta = nodeNavMeta(node);
  const active = isNodeActive(node, pathname);
  const Icon = meta.icon;
  const showSubtitle = depth === 0 || active;

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
      </Pressable>
      {node.children.map((child) => (
        <NodeNavItem
          key={child.id}
          node={child}
          pathname={pathname}
          depth={depth + 1}
          onPress={onPress}
        />
      ))}
    </>
  );
}
