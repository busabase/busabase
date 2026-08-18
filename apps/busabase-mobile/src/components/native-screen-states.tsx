import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "./ui/Button";

export function NativeLoadingState({ label = "Loading" }: { label?: string }) {
  const tokens = useTokens();
  return (
    <View style={styles.state}>
      <ActivityIndicator color={tokens.primary} />
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export function NativeEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.statePanel}>
      <Text style={[typography.h2, styles.stateTitle, { color: tokens.foreground }]}>{title}</Text>
      {description ? (
        <Text style={[typography.body, styles.stateBody, { color: tokens.mutedForeground }]}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} />
      ) : null}
    </View>
  );
}

export function NativeErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={styles.statePanel}>
      <Text style={[typography.h2, styles.stateTitle, { color: tokens.foreground }]}>
        Could not load
      </Text>
      <Text style={[typography.body, styles.stateBody, { color: tokens.mutedForeground }]}>
        {message}
      </Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function NativeActionBar({ children }: { children: ReactNode }) {
  return <View style={styles.actionBar}>{children}</View>;
}

export function NativeActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>;
}

export function NativeActionItem({ children }: { children: ReactNode }) {
  return <View style={styles.actionItem}>{children}</View>;
}

export function NativeInlineError({ message, onReset }: { message: string; onReset?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={[styles.inlineError, { borderColor: tokens.destructive }]}>
      <Text
        numberOfLines={2}
        style={[typography.small, styles.inlineErrorText, { color: tokens.destructive }]}
      >
        {message}
      </Text>
      {onReset ? (
        <Pressable accessibilityRole="button" hitSlop={mobile.hitSlop} onPress={onReset}>
          <Text style={[typography.small, { color: tokens.foreground }]}>Reset</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: "center", justifyContent: "center", gap: spacing[3], paddingVertical: 48 },
  statePanel: {
    marginHorizontal: spacing[5],
    marginTop: spacing[6],
    paddingHorizontal: 18,
    paddingVertical: spacing[6],
    alignItems: "center",
    gap: spacing[3],
  },
  stateTitle: { textAlign: "center" },
  stateBody: { maxWidth: 320, textAlign: "center" },
  actionBar: { gap: 10 },
  actionRow: { flexDirection: "row", gap: 10 },
  actionItem: { flex: 1, minWidth: 0 },
  inlineError: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  inlineErrorText: { flex: 1, minWidth: 0 },
});
