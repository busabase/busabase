import type { ChangeRequestVO } from "busabase-contract/types";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getChangeRequestTitle, getPreview } from "~/lib/busabase-display";
import { formatDate } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { StatusBadge } from "../ui/StatusBadge";

interface ChangeRequestCardProps {
  changeRequest: ChangeRequestVO;
  onPress: () => void;
}

export function ChangeRequestCard({ changeRequest, onPress }: ChangeRequestCardProps) {
  const tokens = useTokens();
  const scopeName = changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree";
  return (
    <Pressable
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
      <View style={styles.top}>
        <Text style={[typography.h3, styles.title, { color: tokens.foreground }]}>
          {getChangeRequestTitle(changeRequest)}
        </Text>
        <StatusBadge status={changeRequest.status} />
      </View>
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>
        {getPreview(changeRequest.primaryOperation?.headCommit.fields ?? {})}
      </Text>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {scopeName} · {formatDate(changeRequest.updatedAt)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
  },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { flex: 1 },
});
