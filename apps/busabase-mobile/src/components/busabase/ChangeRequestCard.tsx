import type { ChangeRequestVO } from "busabase-contract/types";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getChangeRequestReviewCue,
  getChangeRequestScopeName,
  getChangeRequestTitle,
  getOperationSummary,
  getPreview,
} from "~/lib/busabase-display";
import { formatDate } from "~/lib/format";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { StatusBadge } from "../ui/StatusBadge";

interface ChangeRequestCardProps {
  changeRequest: ChangeRequestVO;
  onPress: () => void;
  last?: boolean;
}

export function ChangeRequestCard({ changeRequest, onPress, last }: ChangeRequestCardProps) {
  const tokens = useTokens();
  const scopeName = getChangeRequestScopeName(changeRequest);
  const operationSummary = getOperationSummary(changeRequest);
  const preview = getPreview(changeRequest.primaryOperation?.headCommit.fields ?? {}, {
    fallback: "",
    maxLength: 104,
  });
  const reviewCue = getChangeRequestReviewCue(changeRequest);
  const title = getChangeRequestTitle(changeRequest);
  const statusColor =
    changeRequest.status === "approved" || changeRequest.status === "merged"
      ? tokens.success
      : changeRequest.status === "rejected" ||
          changeRequest.status === "abandoned" ||
          changeRequest.status === "conflict"
        ? tokens.destructive
        : tokens.warning;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={mobile.hitSlop}
      style={({ pressed }) => [
        styles.reviewRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
        { opacity: pressed ? 0.72 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={styles.titleRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text
          numberOfLines={2}
          style={[typography.bodyEm, styles.titleText, { color: tokens.foreground }]}
        >
          {title}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
          {formatDate(changeRequest.updatedAt)}
        </Text>
        <StatusBadge status={changeRequest.status} compact />
      </View>
      <Text
        numberOfLines={2}
        style={[typography.small, styles.previewText, { color: tokens.foreground }]}
      >
        {preview || operationSummary}
      </Text>
      <Text numberOfLines={1} style={[typography.caption, { color: tokens.mutedForeground }]}>
        {reviewCue} · {scopeName} · {operationSummary}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reviewRow: {
    minHeight: 96,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    marginTop: 7,
  },
  titleText: { flex: 1, minWidth: 0 },
  statusRow: {
    paddingLeft: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  previewText: { paddingLeft: 19 },
});
