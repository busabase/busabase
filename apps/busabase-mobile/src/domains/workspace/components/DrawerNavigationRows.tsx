import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { isMobileNodePathActive } from "../utils/node-navigation";
import type { DrawerDestination } from "./drawer-nav-destinations";
import { drawerScaffoldStyles as styles } from "./drawer-scaffold-styles";
import { nodeIconForType } from "./node-icons";

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
    icon: nodeIconForType(node.type),
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
  collapsible = true,
  onPress,
  onToggleExpanded,
  onOpenActions,
}: NodeNavItemProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const meta = nodeNavMeta(node);
  const active = isNodeActive(node, pathname);

  if (hasCapability(node.type, "hidden")) return null;

  const Icon = meta.icon;
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
