import type { RecordVO } from "busabase-contract/types";
import { Pressable, StyleSheet, Text } from "react-native";
import { getPreview, getRecordTitle } from "~/lib/busabase-display";
import { formatDate } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

export function RecordCard({ record, onPress }: { record: RecordVO; onPress?: () => void }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: tokens.card,
          borderColor: tokens.border,
          opacity: pressed ? 0.78 : 1,
        },
      ]}
      onPress={onPress}
    >
      <Text style={[typography.h3, { color: tokens.foreground }]}>{getRecordTitle(record)}</Text>
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>
        {getPreview(record.headCommit.fields)}
      </Text>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {record.base.name} · {record.status} · {formatDate(record.updatedAt)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 8,
  },
});
