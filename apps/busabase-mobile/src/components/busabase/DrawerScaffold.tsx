import { skipToken, useQuery } from "@tanstack/react-query";
import { getNodeType, hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { usePathname, useRouter } from "expo-router";
import {
  Activity,
  Archive,
  Bot,
  FileText,
  Folder,
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
import { type ReactNode, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeScreen } from "~/components/native-screen";
import { useI18n } from "~/i18n";
import type { CoreMessages } from "~/i18n/messages";
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
}

type NavKey = keyof CoreMessages["nav"];

// Mirrors the web dashboard's primary nav (Inbox · Search · Activity · Graph View).
const reviewItems = [
  { key: "inbox", href: "/drawer/inbox", icon: Inbox },
  { key: "search", href: "/drawer/search", icon: Search },
  { key: "activity", href: "/drawer/activity", icon: Activity },
  { key: "graph", href: "/drawer/graph", icon: Network },
] as const satisfies ReadonlyArray<{ key: NavKey; href: string; icon: typeof Inbox }>;

// Shared media library + trash, mirroring the web dashboard's Assets + Archived views.
const libraryItems = [
  { key: "assets", href: "/drawer/assets", icon: Images },
  { key: "archived", href: "/drawer/archived", icon: Archive },
] as const satisfies ReadonlyArray<{ key: NavKey; href: string; icon: typeof Inbox }>;

const settingsItem = { key: "settings", href: "/drawer/settings", icon: Settings } as const;

export function DrawerScaffold({
  title,
  subtitle,
  children,
  refreshing,
  onRefresh,
}: DrawerScaffoldProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const nodesQuery = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions()
      : { queryKey: ["no-connection", "nodes"], queryFn: skipToken }),
    enabled: open && !!buda,
  });

  // Unwrap the single root workspace folder so its contents show directly,
  // instead of a redundant "Local workspace" row (matches the web sidebar).
  const treeNodes =
    nodesQuery.data?.length === 1 &&
    hasCapability(nodesQuery.data[0].type, "container") &&
    !nodesQuery.data[0].baseId
      ? nodesQuery.data[0].children
      : (nodesQuery.data ?? []);

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

  const navigateNode = (node: NodeVO) => {
    if (node.type === "base") {
      setOpen(false);
      router.push({ pathname: "/base/[slug]", params: { slug: node.slug } });
      return;
    }
    if (node.type === "skill") {
      setOpen(false);
      router.push({ pathname: "/skill/[nodeId]", params: { nodeId: node.id } });
      return;
    }
    if (node.type === "doc") {
      setOpen(false);
      router.push({ pathname: "/doc/[nodeId]", params: { nodeId: node.id } });
      return;
    }
    if (node.type === "folder") {
      setOpen(false);
      router.push({ pathname: "/folder/[nodeId]", params: { nodeId: node.id } });
      return;
    }
  };

  return (
    <>
      <NativeScreen
        title={title}
        subtitle={subtitle}
        refreshing={refreshing}
        onRefresh={onRefresh}
        headerLeading={headerLeading}
        headerAction={<SpaceSelector compact />}
      >
        {children}
      </NativeScreen>

      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={[styles.drawer, { backgroundColor: tokens.surface }]}>
            <View style={styles.drawerHeader}>
              <View style={styles.drawerTitle}>
                <Text style={[typography.h2, { color: tokens.foreground }]}>Busabase</Text>
              </View>
            </View>
            <SpaceSelector />

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
                <View style={styles.nav}>
                  {reviewItems.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Pressable
                        key={item.href}
                        style={[
                          styles.navItem,
                          { backgroundColor: active ? tokens.primaryMuted : "transparent" },
                        ]}
                        onPress={() => navigate(item.href)}
                      >
                        <Icon size={20} color={active ? tokens.primary : tokens.mutedForeground} />
                        <Text
                          style={[
                            typography.bodyEm,
                            { color: active ? tokens.foreground : tokens.mutedForeground },
                          ]}
                        >
                          {t.nav[item.key]}
                        </Text>
                      </Pressable>
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
                <View style={styles.nav}>
                  {libraryItems.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Pressable
                        key={item.href}
                        style={[
                          styles.navItem,
                          { backgroundColor: active ? tokens.primaryMuted : "transparent" },
                        ]}
                        onPress={() => navigate(item.href)}
                      >
                        <Icon size={20} color={active ? tokens.primary : tokens.mutedForeground} />
                        <Text
                          style={[
                            typography.bodyEm,
                            { color: active ? tokens.foreground : tokens.mutedForeground },
                          ]}
                        >
                          {t.nav[item.key]}
                        </Text>
                      </Pressable>
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
                    {t.nav.bases}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.nav.create}
                    hitSlop={mobile.hitSlop}
                    onPress={() => {
                      setOpen(false);
                      setCreateOpen(true);
                    }}
                  >
                    <Plus size={18} color={tokens.mutedForeground} />
                  </Pressable>
                </View>
                <View style={styles.nav}>
                  {nodesQuery.isLoading ? (
                    <Text
                      style={[
                        typography.small,
                        styles.sectionHint,
                        { color: tokens.mutedForeground },
                      ]}
                    >
                      Loading bases
                    </Text>
                  ) : null}
                  {nodesQuery.error ? (
                    <Text
                      style={[typography.small, styles.sectionHint, { color: tokens.destructive }]}
                    >
                      Could not load bases
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
                      No bases yet
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

              <View style={styles.nav}>
                <Pressable
                  style={[
                    styles.navItem,
                    {
                      backgroundColor:
                        pathname === settingsItem.href ? tokens.primaryMuted : "transparent",
                    },
                  ]}
                  onPress={() => navigate(settingsItem.href)}
                >
                  <settingsItem.icon
                    size={20}
                    color={pathname === settingsItem.href ? tokens.primary : tokens.mutedForeground}
                  />
                  <Text
                    style={[
                      typography.bodyEm,
                      {
                        color:
                          pathname === settingsItem.href
                            ? tokens.foreground
                            : tokens.mutedForeground,
                      },
                    ]}
                  >
                    {t.nav.settings}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
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
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modal: { flex: 1, flexDirection: "row" },
  edgeDismiss: { flex: 1, backgroundColor: "transparent" },
  drawer: {
    width: mobile.drawerWidth,
    maxWidth: "82%",
    paddingTop: 56,
    paddingHorizontal: 18,
    gap: 24,
  },
  drawerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  drawerTitle: { flex: 1, gap: 4, paddingRight: 12 },
  drawerScroll: { flex: 1 },
  drawerBody: { gap: 24, paddingBottom: 24 },
  nav: { gap: 6 },
  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 4,
  },
  sectionLabel: { textTransform: "uppercase" },
  sectionHint: { paddingHorizontal: 14, paddingVertical: 8 },
  navItem: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  baseItem: { alignItems: "flex-start", paddingVertical: 10 },
  baseText: { flex: 1, minWidth: 0 },
});

// Maps the registry's platform-neutral icon ids to lucide-react-native icons.
const NODE_ICONS: Record<string, typeof Folder> = {
  folder: Folder,
  table: Table2,
  sparkles: Sparkles,
  "file-text": FileText,
  bot: Bot,
};

// Per-node-type icon, subtitle, and whether the row navigates somewhere — all
// driven by the node-type registry (tappable = the type has a detail screen).
function nodeNavMeta(node: NodeVO) {
  const definition = getNodeType(node.type);
  return {
    icon: NODE_ICONS[definition?.icon ?? ""] ?? FileText,
    subtitle: node.type === "base" ? node.slug : (definition?.label ?? node.type),
    tappable: hasCapability(node.type, "hasDetail"),
  };
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
  const active =
    (node.type === "base" && pathname === `/base/${node.slug}`) ||
    (node.type === "skill" && pathname === `/skill/${node.id}`) ||
    (node.type === "doc" && pathname === `/doc/${node.id}`) ||
    (node.type === "folder" && pathname === `/folder/${node.id}`);
  const Icon = meta.icon;

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
            paddingLeft: 14 + depth * 14,
          },
        ]}
        onPress={() => onPress(node)}
      >
        <Icon size={20} color={active ? tokens.primary : tokens.mutedForeground} />
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
          <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
            {meta.subtitle}
          </Text>
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
