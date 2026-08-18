import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface NativeSectionProps {
  title?: string;
  caption?: string;
  children: ReactNode;
  style?: ViewStyle;
}

export function NativeSection({ title, caption, children, style }: NativeSectionProps) {
  const tokens = useTokens();

  return (
    <View style={[styles.sectionWrap, style]}>
      {title ? (
        <View style={[styles.sectionHeader, { backgroundColor: tokens.muted }]}>
          <Text
            style={[typography.caption, styles.sectionTitle, { color: tokens.mutedForeground }]}
          >
            {title}
          </Text>
          {caption ? (
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{caption}</Text>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

interface NativeRowProps {
  title: string;
  subtitle?: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children?: ReactNode;
  last?: boolean;
}

export function NativeRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  disabled,
  destructive,
  children,
  last,
}: NativeRowProps) {
  const tokens = useTokens();
  const textColor = destructive ? tokens.destructive : tokens.foreground;
  const content = (
    <>
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text
            numberOfLines={1}
            style={[typography.bodyEm, styles.rowTitle, { color: textColor }]}
          >
            {title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              style={[typography.small, styles.rowMeta, { color: tokens.mutedForeground }]}
            >
              {meta}
            </Text>
          ) : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
      {onPress && !trailing ? <ChevronRight size={18} color={tokens.mutedForeground} /> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        hitSlop={mobile.hitSlop}
        style={({ pressed }) => [
          styles.nativeRow,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
          { opacity: disabled ? 0.52 : pressed ? 0.72 : 1 },
        ]}
        onPress={onPress}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.nativeRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
      ]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionWrap: { marginHorizontal: spacing[5], marginTop: 10, gap: 5 },
  sectionHeader: {
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: { textTransform: "uppercase" },
  nativeRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLeading: { width: 28, alignItems: "center" },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowTitle: { flex: 1, minWidth: 0 },
  rowMeta: { flexShrink: 1, minWidth: 0, textAlign: "right" },
  rowTrailing: { alignItems: "flex-end", flexShrink: 0, maxWidth: "46%" },
});
