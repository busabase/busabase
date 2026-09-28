import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { AppWindow, Bot, FileText, Rows3, Sparkles, Table2 } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

interface TemplateCardProps {
  template: TemplateCardVO;
  onPress: () => void;
}

/**
 * One catalog entry — screenshot, title, description, and the same stat chips
 * web's `TemplateCardSummary` shows (Bases / Apps / Docs / sample rows /
 * agent manual), so a template reads the same before you decide to open it.
 *
 * Full-width and stacked rather than web's grid: this app's cards elsewhere
 * (Search results, Home's recents) are already single-column, and a template
 * screenshot needs real width to read at all — a 3-per-row grid would shrink
 * it to a postage stamp.
 */
export function TemplateCard({ template, onPress }: TemplateCardProps) {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const [imageFailed, setImageFailed] = useState(false);
  const [screenshot] = template.screenshots;
  const title = template.displayName ? iStringParse(template.displayName, locale) : template.name;
  const description = iStringParse(template.description, locale);

  const stats = [
    template.stats.bases > 0
      ? {
          label: fmt(t.templates.cardBases, {
            count: template.stats.bases,
            plural: template.stats.bases === 1 ? "" : "s",
          }),
          Icon: Table2,
        }
      : null,
    template.stats.airapps > 0
      ? {
          label: fmt(t.templates.cardApps, {
            count: template.stats.airapps,
            plural: template.stats.airapps === 1 ? "" : "s",
          }),
          Icon: AppWindow,
        }
      : null,
    template.stats.docs > 0
      ? {
          label: fmt(t.templates.cardDocs, {
            count: template.stats.docs,
            plural: template.stats.docs === 1 ? "" : "s",
          }),
          Icon: FileText,
        }
      : null,
    template.stats.records > 0
      ? {
          label: fmt(t.templates.cardRows, {
            count: template.stats.records,
            plural: template.stats.records === 1 ? "" : "s",
          }),
          Icon: Rows3,
        }
      : null,
    template.stats.skill ? { label: t.templates.cardManual, Icon: Bot } : null,
  ].filter((entry) => entry !== null);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.card,
        { borderColor: tokens.border, backgroundColor: tokens.card, opacity: pressed ? 0.85 : 1 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.imageWrap, { backgroundColor: tokens.muted }]}>
        {screenshot && !imageFailed ? (
          <Image
            source={{ uri: screenshot }}
            resizeMode="cover"
            style={styles.image}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Sparkles size={28} color={tokens.mutedForeground} />
        )}
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
          {title}
        </Text>
        <Text numberOfLines={2} style={[typography.small, { color: tokens.mutedForeground }]}>
          {description}
        </Text>
        {stats.length > 0 ? (
          <View style={styles.stats}>
            {stats.map(({ label, Icon }) => (
              <View key={label} style={styles.stat}>
                <Icon size={13} color={tokens.mutedForeground} />
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  imageWrap: {
    aspectRatio: 16 / 10,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
  body: { padding: spacing[3], gap: 4 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing[3], marginTop: 4 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
});
