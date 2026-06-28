import type { ChangeRequestStatus } from "busabase-core/types";
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
  active: "Active",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const tokens = useTokens();
  const color =
    status === "approved" || status === "merged" || status === "active"
      ? tokens.success
      : status === "rejected" || status === "abandoned" || status === "archived"
        ? tokens.destructive
        : tokens.warning;

  return (
    <View style={[styles.badge, { backgroundColor: tokens.muted }]}>
      <Text style={[typography.caption, { color }]}>{labelByStatus[status]}</Text>
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
});
