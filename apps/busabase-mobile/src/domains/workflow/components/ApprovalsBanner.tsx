import { useRouter } from "expo-router";
import { ChevronRight, ClipboardCheck } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useWaitingWorkflowRunCount } from "../hooks/use-waiting-workflow-runs";

/**
 * "N runs are waiting for your approval", at the top of the Inbox, and nothing
 * at all when none are.
 *
 * A row, not another tab: the Inbox's tab strip has no room for a fifth label
 * and its count on a phone, and a count on a tab that has scrolled off the edge
 * tells nobody anything. A notification has to be on screen to be one.
 */
export function ApprovalsBanner() {
  const { t } = useI18n();
  const router = useRouter();
  const tokens = useTokens();
  const count = useWaitingWorkflowRunCount();
  if (count === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.workflow.approvalsTitle}
      hitSlop={mobile.hitSlop}
      onPress={() => router.push("/approvals")}
      style={({ pressed }) => [
        styles.banner,
        { backgroundColor: tokens.muted, borderColor: tokens.border, opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tokens.primaryMuted }]}>
        <ClipboardCheck size={18} color={tokens.review.text} />
      </View>
      <Text
        numberOfLines={2}
        style={[typography.bodyEm, styles.text, { color: tokens.foreground }]}
      >
        {count === 1
          ? t.workflow.approvalsBannerOne
          : fmt(t.workflow.approvalsBannerMany, { count })}
      </Text>
      <ChevronRight size={18} color={tokens.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
    minHeight: 52,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, minWidth: 0 },
});
