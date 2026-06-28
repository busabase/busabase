import type { BaseFieldVO } from "busabase-core/types";
import { StyleSheet, Text, View } from "react-native";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { FieldValue } from "./FieldValue";

interface FieldListProps {
  fields: Record<string, unknown>;
  definitions?: BaseFieldVO[];
  /** Highlight values as proposed (new) values in a change request diff. */
  highlight?: boolean;
}

export function FieldList({ fields, definitions = [], highlight }: FieldListProps) {
  const tokens = useTokens();
  const definitionBySlug = new Map(definitions.map((definition) => [definition.slug, definition]));
  const orderedSlugs = [
    ...definitions.map((definition) => definition.slug).filter((slug) => slug in fields),
    ...Object.keys(fields).filter((slug) => !definitionBySlug.has(slug)),
  ];
  const items = orderedSlugs.filter((slug) => fields[slug] !== undefined);

  if (items.length === 0) {
    return (
      <Text style={[typography.body, { color: tokens.mutedForeground }]}>
        No field values to display.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((slug) => (
        <View key={slug} style={[styles.row, { borderColor: tokens.border }]}>
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {definitionBySlug.get(slug)?.name ?? slug}
          </Text>
          <FieldValue
            field={definitionBySlug.get(slug)}
            value={fields[slug]}
            highlight={highlight}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
});
