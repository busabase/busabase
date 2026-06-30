import type { BaseVO } from "busabase-contract/types";
import { StyleSheet, Text, View } from "react-native";
import { formatDate } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

export function BaseCard({ base }: { base: BaseVO }) {
  const tokens = useTokens();
  return (
    <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      <Text style={[typography.h3, { color: tokens.foreground }]}>{base.name}</Text>
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>
        {base.description || "No description"}
      </Text>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {base.fields.length} fields · Created {formatDate(base.createdAt)}
      </Text>
    </View>
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
