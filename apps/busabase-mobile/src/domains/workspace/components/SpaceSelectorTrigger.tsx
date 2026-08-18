import { ChevronsUpDown, Database, RefreshCw } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface SpaceSelectorTriggerProps {
  accessibilityLabel: string;
  compact: boolean;
  isFetchingSpaces: boolean;
  isPopover: boolean;
  open: boolean;
  planLabel: string;
  subtitle: string;
  title: string;
  onPress: () => void;
}

export function SpaceSelectorTrigger({
  accessibilityLabel,
  compact,
  isFetchingSpaces,
  isPopover,
  open,
  planLabel,
  subtitle,
  title,
  onPress,
}: SpaceSelectorTriggerProps) {
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ expanded: open }}
      style={[
        compact ? styles.compactButton : styles.button,
        isPopover ? styles.sidebarButton : null,
        {
          backgroundColor: open
            ? tokens.primaryMuted
            : isPopover
              ? "transparent"
              : tokens.primaryMuted,
        },
      ]}
      onPress={onPress}
    >
      {isPopover ? (
        <View style={[styles.workspaceLogo, { backgroundColor: tokens.primary }]}>
          <Database size={18} color={tokens.primaryForeground} />
        </View>
      ) : null}
      <View style={styles.buttonText}>
        <Text
          numberOfLines={1}
          style={[compact ? typography.small : typography.bodyEm, { color: tokens.foreground }]}
        >
          {title}
        </Text>
        {compact ? null : isPopover ? (
          <View
            style={[
              styles.planBadge,
              { backgroundColor: tokens.muted, borderColor: tokens.border },
            ]}
          >
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{planLabel}</Text>
          </View>
        ) : (
          <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {isFetchingSpaces ? (
        <RefreshCw size={16} color={tokens.mutedForeground} />
      ) : (
        <ChevronsUpDown size={18} color={tokens.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: mobile.minTouchTarget,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sidebarButton: {
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  compactButton: {
    minHeight: 36,
    maxWidth: 180,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: { flex: 1, minWidth: 0 },
  workspaceLogo: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  planBadge: {
    alignSelf: "flex-start",
    marginTop: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
