import { Bot, Database, GitPullRequest, Plus, Sparkles } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/**
 * Shown on Home when the workspace has nothing at all — no pending reviews, no
 * recently visited nodes, no activity. Mirrors the web dashboard's
 * `EmptyAgentGuide`: rather than three empty section shells, explain the
 * approval-first model and give one obvious next step.
 *
 * Deliberate platform difference: web's primary action opens its Agent Skills
 * dialog. This app has no agent-integration surface at all, so there would be
 * nothing behind that button — the CTA opens the create sheet instead, which is
 * the next step a phone user can actually take. The explanatory copy is shared
 * with web so the two read the same.
 */
export function EmptyWorkspaceGuide({ onCreate }: { onCreate: () => void }) {
  const tokens = useTokens();
  const { t } = useI18n();

  const points = [
    { icon: Database, text: t.home.guideStructuredData },
    { icon: GitPullRequest, text: t.home.guideChangeRequests },
    { icon: Bot, text: t.home.guideAgentDatabase },
  ];

  return (
    <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: tokens.primaryMuted }]}>
          <Sparkles size={18} color={tokens.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{t.home.guideTitle}</Text>
          <Text style={[typography.small, styles.body, { color: tokens.mutedForeground }]}>
            {t.home.guideBody}
          </Text>
        </View>
      </View>

      <View style={styles.points}>
        {points.map((point) => {
          const Icon = point.icon;
          return (
            <View key={point.text} style={styles.point}>
              <Icon size={16} color={tokens.mutedForeground} />
              <Text style={[typography.small, styles.pointText, { color: tokens.mutedForeground }]}>
                {point.text}
              </Text>
            </View>
          );
        })}
      </View>

      <Button
        label={t.nav.create}
        leadingIcon={<Plus size={18} color={tokens.primaryForeground} />}
        onPress={onCreate}
        fullWidth
      />
      <Text style={[typography.caption, styles.hint, { color: tokens.mutedForeground }]}>
        {t.home.guideManualHint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 14,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, minWidth: 0 },
  body: { marginTop: 4, lineHeight: 20 },
  points: { gap: 8 },
  point: { flexDirection: "row", alignItems: "center", gap: 8 },
  pointText: { flex: 1, minWidth: 0 },
  hint: { textAlign: "center" },
});
