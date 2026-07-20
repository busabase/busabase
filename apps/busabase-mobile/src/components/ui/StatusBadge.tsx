import type { ChangeRequestStatus } from "busabase-contract/types";
import { useEffect, useRef } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
  const reducedMotion = useReducedMotion();
  const flip = useSharedValue(1);
  const previousStatus = useRef(status);

  // A restrained fade confirms the status actually changed (principle: "no
  // double-tap uncertainty") without an attention-seeking animation on every
  // list mount — only fires when `status` transitions after first render.
  useEffect(() => {
    if (previousStatus.current === status) {
      return;
    }
    previousStatus.current = status;
    if (reducedMotion) {
      return;
    }
    flip.value = 0.4;
    flip.value = withTiming(1, { duration: 180 });
  }, [status, reducedMotion, flip]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: flip.value }));

  const cha =
    status === "approved" || status === "merged" || status === "active"
      ? tokens.merged
      : status === "rejected" || status === "abandoned" || status === "archived"
        ? tokens.rejected
        : tokens.review;

  return (
    <Animated.View
      style={[
        styles.badge,
        compact ? styles.compact : null,
        { backgroundColor: withAlpha(cha.base, 0.12) },
        animatedStyle,
      ]}
    >
      <Text style={[typography.caption, { color: cha.text }]}>{getStatusLabel(status)}</Text>
    </Animated.View>
  );
}

function withAlpha(hex: string, alpha: number) {
  const clamped = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${clamped}`;
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
