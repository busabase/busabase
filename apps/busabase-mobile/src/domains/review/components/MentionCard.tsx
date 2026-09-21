import type { MentionInboxItemVO } from "busabase-contract/types";
import { formatUserRefLabel } from "busabase-core/dashboard/format";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatListTime } from "~/lib/format";
import { mobile, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { mentionDestination } from "../utils/mention-destination";

interface MentionCardProps {
  item: MentionInboxItemVO;
  onPress: () => void;
  last?: boolean;
}

/**
 * One "someone named you" row.
 *
 * Mirrors the web dashboard's MentionRow: author, an unread marker, the time,
 * then the comment body as the preview line.
 *
 * A row with nowhere to open still renders, as plain text rather than as
 * something that looks tappable and is not. That is the contract's own rule —
 * a `commit`-scoped comment has no page on either client, and dropping the row
 * would be the single case where being mentioned never reaches the person it
 * was aimed at.
 */
export function MentionCard({ item, onPress, last }: MentionCardProps) {
  const tokens = useTokens();
  const author = formatUserRefLabel(item.author, item.authorId);
  const openable = mentionDestination(item.href).kind !== "none";

  const content = (
    <>
      <View style={styles.titleRow}>
        {item.unread ? (
          <View style={[styles.unreadDot, { backgroundColor: tokens.primary }]} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[typography.bodyEm, styles.titleText, { color: tokens.foreground }]}
        >
          {author}
        </Text>
        <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
          {formatListTime(item.createdAt)}
        </Text>
      </View>
      <Text
        numberOfLines={2}
        style={[
          typography.caption,
          item.unread ? undefined : styles.readBody,
          { color: tokens.mutedForeground },
        ]}
      >
        {item.body}
      </Text>
    </>
  );

  const rowStyle = [
    styles.row,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
  ];

  if (!openable) {
    return (
      <View style={rowStyle} accessibilityLabel={`${author}: ${item.body}`}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${author}: ${item.body}`}
      hitSlop={mobile.hitSlop}
      style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.72 : 1 }]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 9, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  unreadDot: { width: 8, height: 8, borderRadius: 999 },
  titleText: { flex: 1, minWidth: 0 },
  readBody: { opacity: 0.85 },
});
