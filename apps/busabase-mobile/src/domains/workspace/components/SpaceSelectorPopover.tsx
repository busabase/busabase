import { Database, Settings, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useI18n } from "~/i18n";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface SpaceSelectorPopoverProps {
  children: ReactNode;
  footer?: ReactNode;
  subtitle: string;
  title: string;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function SpaceSelectorPopover({
  children,
  footer,
  subtitle,
  title,
  onClose,
  onOpenSettings,
}: SpaceSelectorPopoverProps) {
  const tokens = useTokens();
  const { height } = useWindowDimensions();
  const { t } = useI18n();

  return (
    <View
      style={[
        styles.popover,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
          maxHeight: Math.min(Math.max(height - 128, 360), 620),
        },
      ]}
    >
      <View style={[styles.header, { borderColor: tokens.border }]}>
        <View style={styles.identity}>
          <View style={[styles.workspaceLogo, { backgroundColor: tokens.primary }]}>
            <Database size={20} color={tokens.primaryForeground} />
          </View>
          <View style={styles.identityText}>
            <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
              {title}
            </Text>
            <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
              {subtitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.workspaceSelector.closeMenu}
            hitSlop={mobile.hitSlop}
            style={styles.iconButton}
            onPress={onClose}
          >
            <X size={18} color={tokens.mutedForeground} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          style={[styles.settingsButton, { borderColor: tokens.border }]}
          onPress={onOpenSettings}
        >
          <Settings size={15} color={tokens.mutedForeground} />
          <Text style={[typography.small, { color: tokens.foreground }]}>{t.nav.settings}</Text>
        </Pressable>
      </View>
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { borderColor: tokens.border }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  popover: {
    position: "absolute",
    top: 62,
    left: 0,
    right: 0,
    zIndex: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  header: {
    padding: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  identityText: { flex: 1, minWidth: 0 },
  workspaceLogo: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  settingsButton: {
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  content: { paddingBottom: 10 },
  footer: {
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
