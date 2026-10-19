import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { ChevronDown, ChevronRight, Globe, Lock, MoreHorizontal } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { isMobileNodePathActive } from "../utils/node-navigation";
import { resolveNodeShareMarker } from "../utils/node-share-marker";
import type { DrawerDestination } from "./drawer-nav-destinations";
import { drawerScaffoldStyles as styles } from "./drawer-scaffold-styles";
import { NodeAvatar } from "./NodeAvatar";

interface DrawerNavRowProps {
  active: boolean;
  badge?: number;
  icon: DrawerDestination["icon"];
  label: string;
  onPress: () => void;
}

export function DrawerNavRow({ active, badge, icon: Icon, label, onPress }: DrawerNavRowProps) {
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

export function nodeNavMeta(node: NodeVO) {
  return {
    tappable: hasCapability(node.type, "hasDetail"),
  };
}

export const isNodeActive = (node: NodeVO, pathname: string) =>
  isMobileNodePathActive(node, pathname);

interface NodeNavItemProps {
  node: NodeVO;
  pathname: string;
  depth: number;
  expandedIds: ReadonlySet<string>;
  /** Folders whose children are still being fetched. */
  loadingNodeIds?: ReadonlySet<string>;
  /** Handed the active row's View, so the drawer can keep it on screen. */
  onActiveRowRef?: (row: View | null) => void;
  collapsible?: boolean;
  onPress: (node: NodeVO) => void;
  onToggleExpanded: (nodeId: string) => void;
  onOpenActions: (node: NodeVO) => void;
}

export function NodeNavItem({
  node,
  pathname,
  depth,
  expandedIds,
  loadingNodeIds,
  onActiveRowRef,
  collapsible = true,
  onPress,
  onToggleExpanded,
  onOpenActions,
}: NodeNavItemProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const meta = nodeNavMeta(node);
  const active = isNodeActive(node, pathname);
  const shareMarker = resolveNodeShareMarker(node);

  if (hasCapability(node.type, "hidden")) return null;

  const isContainer = collapsible && hasCapability(node.type, "container");
  const expanded = isContainer && expandedIds.has(node.id);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <View
        ref={active ? onActiveRowRef : undefined}
        collapsable={false}
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
            <NodeAvatar
              node={node}
              size={18}
              color={active ? tokens.primary : tokens.mutedForeground}
            />
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
            <NodeAvatar
              node={node}
              size={18}
              color={active ? tokens.primary : tokens.mutedForeground}
            />
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
        {shareMarker ? (
          <View accessibilityLabel={t.share[shareMarker.labelKey]} style={styles.nodeShareMarker}>
            {shareMarker.icon === "globe" ? (
              <Globe
                size={14}
                color={tokens.mutedForeground}
                opacity={shareMarker.tone === "muted" ? 0.55 : 1}
              />
            ) : (
              <Lock size={14} color={tokens.mutedForeground} />
            )}
          </View>
        ) : null}
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
      {expanded && node.children.length === 0 && loadingNodeIds?.has(node.id) ? (
        <View
          accessibilityLabel={t.common.loading}
          style={[styles.navItem, styles.baseItem, { paddingLeft: 8 + (depth + 1) * 12 }]}
        >
          <View style={styles.nodeChevron} />
          <ActivityIndicator size="small" color={tokens.mutedForeground} />
          <Text style={[typography.body, styles.baseText, { color: tokens.mutedForeground }]}>
            {t.common.loading}
          </Text>
        </View>
      ) : null}
      {expanded
        ? node.children.map((child) => (
            <NodeNavItem
              key={child.id}
              node={child}
              pathname={pathname}
              depth={depth + 1}
              expandedIds={expandedIds}
              loadingNodeIds={loadingNodeIds}
              onActiveRowRef={onActiveRowRef}
              onPress={onPress}
              onToggleExpanded={onToggleExpanded}
              onOpenActions={onOpenActions}
            />
          ))
        : null}
    </>
  );
}
