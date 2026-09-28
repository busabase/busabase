import { hasActiveToolCall } from "@acp-ui/core/group";
import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import { CheckCircle, ChevronDown, ChevronRight, Loader } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { toolRunSummary } from "../utils/tool-run-summary";
import { AcpToolCallRow } from "./AcpToolCallRow";

/**
 * Two or more consecutive tool calls, collapsed into one row —
 * "Explored 3 files, ran 2 commands". Mirrors `@acp-ui/web`'s
 * `AcpToolRunView`: open by default while any call in the run is still
 * `pending`/`in_progress`, and once opened (or by having been live while
 * open) it stays open until the user collapses it — it does not snap shut
 * the instant the last call settles.
 */
export function AcpToolRunRow({ blocks }: { blocks: AcpToolCallBlock[] }) {
  const tokens = useTokens();
  const { t } = useI18n();
  const active = hasActiveToolCall(blocks);
  // Only the FIRST render's `active` seeds this — a run live when it first
  // mounts opens; one already finished when it first appears (replayed
  // history) stays collapsed. `useState`'s initial-value argument is only
  // ever read once, so later re-renders (the run finishing, say) leave
  // whatever the user has since chosen alone — it does not snap shut the
  // instant the last call settles.
  const [open, setOpen] = useState(active);

  return (
    <View style={[styles.wrap, { borderColor: tokens.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.header}
      >
        {active ? (
          <Loader size={14} color={tokens.mutedForeground} />
        ) : (
          <CheckCircle size={14} color={tokens.success} />
        )}
        <Text
          numberOfLines={1}
          style={[typography.small, styles.title, { color: tokens.foreground }]}
        >
          {toolRunSummary(blocks, t.agents)}
        </Text>
        {open ? (
          <ChevronDown size={14} color={tokens.mutedForeground} />
        ) : (
          <ChevronRight size={14} color={tokens.mutedForeground} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {blocks.map((block, index) => (
            <AcpToolCallRow key={block.id} block={block} last={index === blocks.length - 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  title: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: spacing[3], paddingBottom: spacing[1] },
});
