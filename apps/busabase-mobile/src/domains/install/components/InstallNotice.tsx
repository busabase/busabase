import { Square, SquareCheck, TriangleAlert } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface InstallNoticeProps {
  body?: string;
  danger?: boolean;
  lines?: string[];
  title: string;
}

export function InstallCheckMark({ checked }: { checked: boolean }) {
  const tokens = useTokens();
  return checked ? (
    <SquareCheck size={20} color={tokens.primary} />
  ) : (
    <Square size={20} color={tokens.mutedForeground} />
  );
}

export function InstallNotice({ body, danger, lines, title }: InstallNoticeProps) {
  const tokens = useTokens();
  const accent = danger ? tokens.destructive : tokens.warning;
  return (
    <View style={[styles.panel, { borderColor: danger ? tokens.destructive : tokens.border }]}>
      <View style={styles.titleRow}>
        <TriangleAlert size={16} color={accent} />
        <Text style={[typography.bodyEm, styles.title, { color: accent }]}>{title}</Text>
      </View>
      {body ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>{body}</Text>
      ) : null}
      {lines?.map((line) => (
        <Text key={line} style={[typography.small, { color: tokens.foreground }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export const installPanelStyle = {
  borderWidth: StyleSheet.hairlineWidth,
  borderRadius: radius.md,
  padding: spacing[3],
  gap: spacing[1] + 2,
} as const;

const styles = StyleSheet.create({
  panel: installPanelStyle,
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  title: { flex: 1, minWidth: 0 },
});
