import type { ChangeRequestStatus } from "busabase-contract/types";
import { StyleSheet, Text, View } from "react-native";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

type BadgeStatus = ChangeRequestStatus | "active" | "archived";

const labelByStatus: Record<BadgeStatus, string> = {
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  merged: "Merged",
  abandoned: "Abandoned",
  conflict: "Conflict",
  active: "Active",
  archived: "Archived",
};

export const getStatusLabel = (status: BadgeStatus) => labelByStatus[status];

export function StatusBadge({ status, compact }: { status: BadgeStatus; compact?: boolean }) {
  const tokens = useTokens();
  const color =
    status === "approved" || status === "merged" || status === "active"
      ? tokens.success
      : status === "rejected" || status === "abandoned" || status === "archived"
        ? tokens.destructive
        : tokens.warning;

  return (
    <View
      style={[styles.badge, compact ? styles.compact : null, { backgroundColor: tokens.muted }]}
    >
      <Text style={[typography.caption, { color }]}>{getStatusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  compact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
