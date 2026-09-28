import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Wrench,
  XCircle,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { toolStatusLabel } from "../utils/tool-status";

/** Mirrors `@acp-ui/web`'s `statusIcons` — same four states, RN icon set. */
function StatusIcon({ status, color }: { status: AcpToolCallBlock["status"]; color: string }) {
  switch (status) {
    case "pending":
      return <Circle size={13} color={color} />;
    case "in_progress":
      return <Clock size={13} color={color} />;
    case "completed":
      return <CheckCircle size={13} color={color} />;
    case "failed":
      return <XCircle size={13} color={color} />;
  }
}

const describeRaw = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * One tool call — a compact row that expands to show `rawInput`/`rawOutput`
 * when the call carries any. Mirrors `@acp-ui/web`'s `AcpToolCallView`: the
 * core keys a call by `toolCallId`, so its stream of `tool_call_update`s
 * arrives here as one block whose status changes in place, never as repeated
 * rows.
 */
export function AcpToolCallRow({ block, last }: { block: AcpToolCallBlock; last?: boolean }) {
  const tokens = useTokens();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const hasInput = block.rawInput !== undefined && block.rawInput !== null;
  const hasOutput = block.rawOutput !== undefined && block.rawOutput !== null;
  const hasDetail = hasInput || hasOutput;
  const statusColor =
    block.status === "completed"
      ? tokens.success
      : block.status === "failed"
        ? tokens.destructive
        : tokens.mutedForeground;

  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
      ]}
    >
      <Pressable
        accessibilityRole={hasDetail ? "button" : undefined}
        accessibilityState={hasDetail ? { expanded } : undefined}
        disabled={!hasDetail}
        onPress={() => setExpanded((current) => !current)}
        style={styles.header}
      >
        <Wrench size={14} color={tokens.mutedForeground} />
        <Text
          numberOfLines={1}
          style={[typography.small, styles.title, { color: tokens.foreground }]}
        >
          {block.title || block.toolKind || "tool"}
        </Text>
        <View style={[styles.badge, { backgroundColor: tokens.muted }]}>
          <StatusIcon status={block.status} color={statusColor} />
          <Text style={[typography.caption, { color: statusColor }]}>
            {toolStatusLabel(block.status, t.agents)}
          </Text>
        </View>
        {hasDetail ? (
          expanded ? (
            <ChevronDown size={14} color={tokens.mutedForeground} />
          ) : (
            <ChevronRight size={14} color={tokens.mutedForeground} />
          )
        ) : null}
      </Pressable>
      {expanded && hasDetail ? (
        <View style={[styles.detail, { backgroundColor: tokens.muted }]}>
          {hasInput ? (
            <Text style={[typography.caption, styles.mono, { color: tokens.foreground }]}>
              {describeRaw(block.rawInput)}
            </Text>
          ) : null}
          {hasOutput ? (
            <Text
              style={[
                typography.caption,
                styles.mono,
                { color: block.status === "failed" ? tokens.destructive : tokens.foreground },
              ]}
            >
              {describeRaw(block.rawOutput)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 2 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: 8 },
  title: { flex: 1, minWidth: 0 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  detail: {
    borderRadius: radius.md,
    padding: spacing[2],
    marginBottom: spacing[2],
    gap: spacing[1],
  },
  mono: { fontFamily: "monospace" },
});
