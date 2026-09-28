import type { AcpNoteBlock } from "@acp-ui/core/reduce";
import { StyleSheet, Text, View } from "react-native";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * A session-level message, not part of the conversation itself — "this agent
 * has no workspace access", "session ended". Mirrors `@acp-ui/web`'s
 * `AcpNoteView`: `ended` notes get the destructive treatment.
 */
export function AcpNoteBanner({ block }: { block: AcpNoteBlock }) {
  const tokens = useTokens();
  return (
    <View
      style={[
        styles.banner,
        block.ended
          ? { backgroundColor: `${tokens.destructive}1A`, borderColor: tokens.destructive }
          : { backgroundColor: tokens.muted, borderColor: tokens.border },
      ]}
    >
      <Text
        style={[
          typography.small,
          { color: block.ended ? tokens.destructive : tokens.mutedForeground },
        ]}
      >
        {block.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing[2],
    marginHorizontal: spacing[3],
  },
});
