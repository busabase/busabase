import type { NodeVO } from "busabase-contract/types";
import { House, Plus, Search, Settings } from "lucide-react-native";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { CoreMessages } from "~/i18n/messages";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { toggleNodeExpanded } from "../utils/tree-expansion";
import { DrawerNavRow, NodeNavItem } from "./DrawerNavigationRows";
import {
  type DrawerDestination,
  isDrawerItemActive,
  isPathActive,
} from "./drawer-nav-destinations";
import { drawerScaffoldStyles as styles } from "./drawer-scaffold-styles";
import { SpaceSelector } from "./SpaceSelector";

const pinnedItems = [
  { key: "home", href: "/drawer/home", icon: House },
  { key: "search", href: "/drawer/search", icon: Search },
] as const satisfies ReadonlyArray<DrawerDestination>;

const settingsItem = {
  key: "settings",
  href: "/drawer/settings",
  icon: Settings,
} as const satisfies DrawerDestination;

interface DrawerNavigationPanelProps {
  persistentSidebar: boolean;
  sidebarWidth: number;
  insets: { top: number; bottom: number };
  pathname: string;
  t: CoreMessages;
  pendingCount: number;
  contextualDestination: DrawerDestination | null;
  favoriteNodes: NodeVO[];
  treeNodes: NodeVO[];
  nodesLoading: boolean;
  nodesError: boolean;
  expandedIds: ReadonlySet<string>;
  onDismiss: () => void;
  onNavigate: (href: string) => void;
  onNavigateNode: (node: NodeVO) => void;
  onOpenActions: (node: NodeVO, allowCreateChild: boolean) => void;
  onCreateRoot: () => void;
}

export function DrawerNavigationPanel({
  persistentSidebar,
  sidebarWidth,
  insets,
  pathname,
  t,
  pendingCount,
  contextualDestination,
  favoriteNodes,
  treeNodes,
  nodesLoading,
  nodesError,
  expandedIds,
  onDismiss,
  onNavigate,
  onNavigateNode,
  onOpenActions,
  onCreateRoot,
}: DrawerNavigationPanelProps) {
  const tokens = useTokens();

  return (
    <View
      style={[
        styles.drawer,
        persistentSidebar ? null : styles.compactDrawer,
        {
          width: persistentSidebar ? sidebarWidth : mobile.drawerWidth,
          backgroundColor: tokens.sidebar,
          borderColor: tokens.border,
          paddingTop: Platform.select({
            web: persistentSidebar ? 0 : mobile.headerHeight,
            default: insets.top,
          }),
          paddingBottom: Platform.select({ web: 0, default: insets.bottom }),
        },
      ]}
    >
      <View style={[styles.spaceWrap, { borderColor: tokens.border }]}>
        <SpaceSelector presentation="popover" onDismissContainer={onDismiss} />
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
              onPress={() => onNavigate(item.href)}
            />
          ))}
          {contextualDestination ? (
            <DrawerNavRow
              active={isDrawerItemActive(pathname, contextualDestination)}
              badge={contextualDestination.key === "inbox" ? pendingCount : undefined}
              icon={contextualDestination.icon}
              label={t.nav[contextualDestination.key]}
              onPress={() => onNavigate(contextualDestination.href)}
            />
          ) : null}
        </View>

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
                  collapsible={false}
                  expandedIds={expandedIds}
                  onPress={onNavigateNode}
                  onToggleExpanded={toggleNodeExpanded}
                  onOpenActions={(target) => onOpenActions(target, false)}
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
              onPress={onCreateRoot}
            >
              <Plus size={16} color={tokens.mutedForeground} />
            </Pressable>
          </View>
          <View style={styles.navGroup}>
            {nodesLoading ? (
              <Text
                style={[typography.small, styles.sectionHint, { color: tokens.mutedForeground }]}
              >
                {t.nav.workspaceLoading}
              </Text>
            ) : null}
            {nodesError ? (
              <Text style={[typography.small, styles.sectionHint, { color: tokens.destructive }]}>
                {t.nav.workspaceError}
              </Text>
            ) : null}
            {!nodesLoading && !nodesError && treeNodes.length === 0 ? (
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
                onPress={onNavigateNode}
                onToggleExpanded={toggleNodeExpanded}
                onOpenActions={(target) => onOpenActions(target, true)}
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
          onPress={() => onNavigate(settingsItem.href)}
        />
      </View>
    </View>
  );
}
