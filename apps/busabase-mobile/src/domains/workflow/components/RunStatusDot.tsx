import type { WorkflowRunStatus } from "busabase-contract/domains/workflow/run";
import { StyleSheet, View } from "react-native";
import { useTokens } from "~/theme/use-tokens";
import { workflowRunTone } from "../utils/run-display";

/** The colour a run's status carries, as a dot: the label is written beside it, never inside. */
export function RunStatusDot({ status }: { status: WorkflowRunStatus }) {
  const tokens = useTokens();
  const tone = workflowRunTone(status);
  const color =
    tone === "success"
      ? tokens.merged.base
      : tone === "failure"
        ? tokens.rejected.base
        : tone === "attention"
          ? tokens.review.base
          : tone === "active"
            ? tokens.primary
            : tokens.mutedForeground;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: 999 },
});
