import type { AcpPermissionBlock } from "@acp-ui/core/reduce";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * The card ACP's `session/request_permission` needs — the reason this whole
 * stack does not route through the AI SDK. It carries a LIST of options
 * ("allow once", "always allow", "reject"…), which a boolean `approved`
 * cannot express.
 *
 * Busabase never sets `timeoutAt` (see `AgentPermissionBlock`'s own doc
 * comment: "busabase waits indefinitely and deliberately never
 * auto-approves" — a security property), so unlike `@acp-ui/web`'s
 * countdown this card has nothing to show while waiting: it just waits.
 */
export function AcpPermissionCard({
  block,
  onAnswer,
}: {
  block: AcpPermissionBlock;
  onAnswer: (optionId: string) => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const { resolution } = block;

  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{block.title}</Text>
      {typeof resolution === "object" ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.agents.permissionAnswered}{" "}
          {block.options.find((option) => option.optionId === resolution.optionId)?.name ??
            resolution.optionId}
        </Text>
      ) : (
        <View style={styles.options}>
          {block.options.map((option) => (
            <Button
              key={option.optionId}
              label={option.name}
              variant={option.kind?.startsWith("reject") ? "destructive" : "primary"}
              disabled={resolution === "answering"}
              onPress={() => onAnswer(option.optionId)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing[3],
    marginHorizontal: spacing[3],
    gap: spacing[2],
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
});
