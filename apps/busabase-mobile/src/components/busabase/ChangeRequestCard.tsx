import type { ChangeRequestVO } from "busabase-contract/types";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getChangeRequestMessage,
  getChangeRequestScopeName,
  getChangeRequestTitle,
  getOperationSummary,
} from "~/lib/busabase-display";
import { formatListTime } from "~/lib/format";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { getStatusLabel } from "../ui/StatusBadge";

interface ChangeRequestCardProps {
  changeRequest: ChangeRequestVO;
  onPress: () => void;
  last?: boolean;
}

// Mirrors the web dashboard's ReviewChangeRequestRow hierarchy
// (packages/busabase-core/src/domains/dashboard/components/inbox.tsx):
// status carries color via the dot ONLY (no visible text on it) and carries
// its label ONLY as plain text at the end of the metadata line — never both
// at once as a colored chip, which reads as redundant. The optional second
// line is the author's own commit message, not a synthesized field preview,
// and is omitted entirely when there isn't one (matching web).
export function ChangeRequestCard({ changeRequest, onPress, last }: ChangeRequestCardProps) {
  const tokens = useTokens();
  const scopeName = getChangeRequestScopeName(changeRequest);
  const operationSummary = getOperationSummary(changeRequest);
  const message = getChangeRequestMessage(changeRequest);
  const title = getChangeRequestTitle(changeRequest);
  const statusLabel = getStatusLabel(changeRequest.status);
  const statusColor =
    changeRequest.status === "approved" || changeRequest.status === "merged"
      ? tokens.merged.base
      : changeRequest.status === "rejected" ||
          changeRequest.status === "abandoned" ||
          changeRequest.status === "conflict"
        ? tokens.rejected.base
        : tokens.review.base;

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
          numberOfLines={1}
          style={[typography.bodyEm, styles.titleText, { color: tokens.foreground }]}
        >
          {title}
        </Text>
      </View>
      {message ? (
        <Text
          numberOfLines={1}
          style={[typography.small, styles.messageText, { color: tokens.mutedForeground }]}
        >
          {message}
        </Text>
      ) : null}
      <Text
        numberOfLines={1}
        style={[typography.caption, styles.metaText, { color: tokens.mutedForeground }]}
      >
        {scopeName} · {operationSummary} · {statusLabel} · {formatListTime(changeRequest.updatedAt)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reviewRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 3,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  titleText: { flex: 1, minWidth: 0 },
  messageText: { paddingLeft: 16 },
  metaText: { paddingLeft: 16 },
});
