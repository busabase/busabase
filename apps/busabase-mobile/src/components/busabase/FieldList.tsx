import type { BaseFieldVO } from "busabase-contract/types";
import { iStringParse } from "openlib/i18n/i-string";
import { StyleSheet, Text, View } from "react-native";
import { NativeRow } from "~/components/native-screen";
import { getFieldTypeLabel } from "~/lib/field-type-label";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { FieldValue } from "./FieldValue";

interface FieldListProps {
  fields: Record<string, unknown>;
  definitions?: BaseFieldVO[];
  /** Highlight values as proposed (new) values in a change request diff. */
  highlight?: boolean;
  limitToDefinitions?: boolean;
  variant?: "rows" | "compact" | "grouped";
}

export function FieldList({
  fields,
  definitions = [],
  highlight,
  limitToDefinitions,
  variant = "rows",
}: FieldListProps) {
  const tokens = useTokens();
  const definitionBySlug = new Map(definitions.map((definition) => [definition.slug, definition]));
  const orderedSlugs = [
    ...definitions.map((definition) => definition.slug).filter((slug) => slug in fields),
    ...(limitToDefinitions
      ? []
      : Object.keys(fields).filter((slug) => !definitionBySlug.has(slug))),
  ];
  const items = orderedSlugs.filter((slug) => fields[slug] !== undefined);

  if (items.length === 0) {
    if (variant === "compact" || variant === "grouped") {
      return (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          No field values to display.
        </Text>
      );
    }
    return <NativeRow title="No field values" subtitle="There are no values to display." last />;
  }

  if (variant === "compact") {
    return (
      <View style={styles.compactList}>
        {items.map((slug) => {
          const label = iStringParse(definitionBySlug.get(slug)?.name ?? slug);
          const field = definitionBySlug.get(slug);

          return (
            <View key={slug} style={styles.compactRow}>
              <Text
                numberOfLines={1}
                style={[typography.caption, styles.compactLabel, { color: tokens.mutedForeground }]}
              >
                {label}
              </Text>
              <View style={styles.compactValue}>
                <FieldValue field={field} value={fields[slug]} highlight={highlight} />
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  if (variant === "grouped") {
    return (
      <View>
        {items.map((slug, index) => {
          const label = iStringParse(definitionBySlug.get(slug)?.name ?? slug);
          const field = definitionBySlug.get(slug);

          return (
            <View
              key={slug}
              style={[
                styles.groupedRow,
                index !== items.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderColor: tokens.border,
                },
              ]}
            >
              <View style={styles.groupedLabelLine}>
                <Text
                  numberOfLines={1}
                  style={[
                    typography.caption,
                    styles.groupedLabel,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {label}
                </Text>
                {field ? (
                  <Text
                    numberOfLines={1}
                    style={[typography.caption, { color: tokens.mutedForeground }]}
                  >
                    {getFieldTypeLabel(field.type)}
                  </Text>
                ) : null}
              </View>
              <FieldValue field={field} value={fields[slug]} highlight={highlight} />
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <>
      {items.map((slug, index) => {
        const label = iStringParse(definitionBySlug.get(slug)?.name ?? slug);
        const field = definitionBySlug.get(slug);

        return (
          <NativeRow
            key={slug}
            title={label}
            subtitle={field ? getFieldTypeLabel(field.type) : slug}
            last={index === items.length - 1}
            meta={highlight ? "Proposed" : undefined}
          >
            <FieldValue field={field} value={fields[slug]} highlight={highlight} />
          </NativeRow>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  compactList: { gap: 8 },
  compactRow: { gap: 3 },
  compactLabel: { textTransform: "uppercase" },
  compactValue: { minWidth: 0 },
  groupedRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 7 },
  groupedLabelLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  groupedLabel: { flex: 1, minWidth: 0, textTransform: "uppercase" },
});
