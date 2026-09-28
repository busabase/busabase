import type { AcpMessageBlock } from "@acp-ui/core/reduce";
import { ChevronDown, ChevronRight, Paperclip } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MarkdownView } from "~/components/MarkdownView";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * One chat bubble, or one collapsible reasoning panel.
 *
 * Mirrors `@acp-ui/web`'s `AcpMessageView`: `variant: "thought"` (ACP's
 * `agent_thought_chunk`) gets the collapsed-by-default treatment web gives it
 * through kui's `Reasoning`, not an italic paragraph the user cannot dismiss.
 * `role` decides which side of the screen the bubble sits on.
 *
 * Attachments the agent sent are named, not previewed — web renders an image
 * grid + inline file chips; that is real scope for a later pass, not
 * something to fake here. A user's own attachments never reach this block on
 * mobile in the first place: v1's composer sends text only.
 */
export function AcpMessageBlockView({
  block,
  streaming,
}: {
  block: AcpMessageBlock;
  streaming: boolean;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  if (block.variant === "thought") {
    if (!block.text && !streaming) return null;
    return (
      <View style={styles.thoughtWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={8}
          onPress={() => setExpanded((current) => !current)}
          style={styles.thoughtTrigger}
        >
          {expanded ? (
            <ChevronDown size={14} color={tokens.mutedForeground} />
          ) : (
            <ChevronRight size={14} color={tokens.mutedForeground} />
          )}
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {streaming ? t.agents.thinking : t.agents.briefReasoning}
          </Text>
        </Pressable>
        {expanded && block.text ? (
          <View style={[styles.thoughtBody, { borderColor: tokens.border }]}>
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>{block.text}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const fromUser = block.role === "user";
  return (
    <View style={[styles.row, fromUser ? styles.rowUser : styles.rowAgent]}>
      <View
        style={[
          styles.bubble,
          fromUser
            ? { backgroundColor: tokens.primary, borderColor: tokens.primary }
            : { backgroundColor: tokens.card, borderColor: tokens.border },
        ]}
      >
        {block.text ? (
          fromUser ? (
            <Text style={[typography.body, { color: tokens.primaryForeground }]}>{block.text}</Text>
          ) : (
            <MarkdownView>{block.text}</MarkdownView>
          )
        ) : null}
        {block.attachments && block.attachments.length > 0 ? (
          <View style={styles.attachmentRow}>
            <Paperclip
              size={13}
              color={fromUser ? tokens.primaryForeground : tokens.mutedForeground}
            />
            <Text
              style={[
                typography.caption,
                { color: fromUser ? tokens.primaryForeground : tokens.mutedForeground },
              ]}
            >
              {fmt(block.attachments.length === 1 ? "{count} attachment" : "{count} attachments", {
                count: block.attachments.length,
              })}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: spacing[3] },
  rowUser: { justifyContent: "flex-end" },
  rowAgent: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "88%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  attachmentRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  thoughtWrap: { paddingHorizontal: spacing[3] },
  thoughtTrigger: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  thoughtBody: {
    borderLeftWidth: 2,
    paddingLeft: spacing[2],
    marginLeft: 7,
    marginBottom: 4,
  },
});
