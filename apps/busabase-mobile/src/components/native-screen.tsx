import type { ReactNode } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { Button } from "./ui/Button";

interface NativeScreenProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerLeading?: ReactNode;
  headerAction?: ReactNode;
}

export function NativeScreen({
  title,
  subtitle,
  children,
  refreshing,
  onRefresh,
  headerLeading,
  headerAction,
}: NativeScreenProps) {
  const tokens = useTokens();

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, { backgroundColor: tokens.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={tokens.primary}
            />
          ) : undefined
        }
      >
        <View style={styles.header}>
          {headerLeading ? <View style={styles.headerLeading}>{headerLeading}</View> : null}
          <View style={styles.titleBlock}>
            <Text style={[typography.h1, { color: tokens.foreground }]}>{title}</Text>
            {subtitle ? (
              <Text style={[typography.body, { color: tokens.mutedForeground }]}>{subtitle}</Text>
            ) : null}
          </View>
          {headerAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

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
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const tokens = useTokens();
  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text style={[typography.h2, { color: tokens.foreground }]}>{title}</Text>
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>{description}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} />
      ) : null}
    </View>
  );
}

export function NativeErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const tokens = useTokens();
  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text style={[typography.h2, { color: tokens.foreground }]}>Could not load</Text>
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingBottom: 40 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerLeading: { width: 44 },
  headerAction: { minWidth: 44, alignItems: "flex-end" },
  titleBlock: { flex: 1, gap: 4 },
  state: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48 },
  card: {
    marginHorizontal: 20,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 18,
    gap: 12,
  },
});
