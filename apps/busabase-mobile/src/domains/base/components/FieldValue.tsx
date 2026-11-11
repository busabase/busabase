import type { BaseFieldVO, UserRefVO } from "busabase-contract/types";
import { describeDateFieldValue, getDateFieldOptions } from "busabase-core/base/date-value";
import { getMemberIds, isFileFieldType, isPeopleFieldType } from "busabase-core/base/field-types";
import { formatMemberChipLabel } from "busabase-core/dashboard/format";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CollapsedMarkdown } from "~/components/MarkdownView";
import { stringifyFieldValue } from "~/domains/review/utils/busabase-display";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { AttachmentValue } from "./AttachmentValue";

const LONG_TEXT_TYPES = new Set(["longtext", "markdown", "html", "ai_summary"]);
const LONG_TEXT_THRESHOLD = 180;
const COLLAPSED_LINES = 4;

interface FieldValueProps {
  field?: BaseFieldVO;
  value: unknown;
  /**
   * People named by this record's `member` / `created_by` / `updated_by` cells
   * (`RecordVO.fieldUsers`, resolved by the server). Without it those cells fall
   * back to an id-derived label — which is all a public/Embed surface ever gets.
   */
  fieldUsers?: Record<string, UserRefVO>;
  /** Render the value as a proposed (new) value — used in change request diffs. */
  highlight?: boolean;
  /** Disable nested controls when the value is rendered inside a tappable row. */
  interactive?: boolean;
}

function getChipLabels(field: BaseFieldVO | undefined, value: unknown): string[] {
  if (!field) {
    return [];
  }
  if (field.type === "select") {
    const choiceId = typeof value === "string" ? value : "";
    const label = field.options.choices?.find((choice) => choice.id === choiceId)?.name ?? choiceId;
    return label ? [label] : [];
  }
  if ((field.type === "multiselect" || field.type === "ai_tags") && Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item !== "string") {
          return "";
        }
        return field.options.choices?.find((choice) => choice.id === item)?.name ?? item;
      })
      .filter(Boolean);
  }
  return [];
}

function getLinkHref(field: BaseFieldVO | undefined, value: unknown): string | null {
  if (!field || typeof value !== "string" || !value) {
    return null;
  }
  if (field.type === "url" || field.type === "embed") {
    return value;
  }
  if (field.type === "email") {
    return `mailto:${value}`;
  }
  if (field.type === "phone") {
    return `tel:${value}`;
  }
  return null;
}

export function FieldValue({
  field,
  value,
  fieldUsers,
  highlight,
  interactive = true,
}: FieldValueProps) {
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);

  // People render as named chips, never as the raw ids `stringifyFieldValue`
  // would join — "local-editor, local-viewer" tells a phone user nothing.
  if (field && isPeopleFieldType(field.type)) {
    const ids = getMemberIds(value);
    if (ids.length === 0) {
      return <Text style={[typography.body, { color: tokens.mutedForeground }]}>—</Text>;
    }
    return (
      <View style={styles.chips}>
        {ids.map((id: string) => (
          <MemberChip key={id} id={id} user={fieldUsers?.[id]} />
        ))}
      </View>
    );
  }

  if (field && isFileFieldType(field.type)) {
    return (
      <AttachmentValue value={value} interactive={interactive} drive={field.type === "drive"} />
    );
  }

  if (field?.type === "checkbox") {
    const checked = value === true || value === "true";
    return (
      <Text style={[typography.body, { color: checked ? tokens.success : tokens.mutedForeground }]}>
        {checked ? "Yes" : "No"}
      </Text>
    );
  }

  // Unparseable date text falls through to the raw string below rather than vanishing.
  if (field?.type === "date" && describeDateFieldValue(value)) {
    return <DateValue field={field} value={value} highlight={highlight} compact={!interactive} />;
  }

  const chips = getChipLabels(field, value);
  if (chips.length > 0) {
    return (
      <View style={styles.chips}>
        {chips.map((chip) => (
          <View
            key={chip}
            style={[styles.chip, { backgroundColor: tokens.muted, borderColor: tokens.border }]}
          >
            <Text style={[typography.small, { color: tokens.foreground }]}>{chip}</Text>
          </View>
        ))}
      </View>
    );
  }

  const href = getLinkHref(field, value);
  if (href) {
    if (!interactive) {
      return (
        <Text numberOfLines={1} style={[typography.body, { color: tokens.foreground }]}>
          {String(value)}
        </Text>
      );
    }
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(href).catch(() => undefined)}
      >
        <Text style={[typography.body, styles.link, { color: tokens.primary }]}>
          {String(value)}
        </Text>
      </Pressable>
    );
  }

  const text = stringifyFieldValue(value);
  if (!text) {
    return <Text style={[typography.body, { color: tokens.mutedForeground }]}>-</Text>;
  }

  const isLong = LONG_TEXT_TYPES.has(field?.type ?? "") || text.length > LONG_TEXT_THRESHOLD;
  const valueText = (
    <Text
      numberOfLines={isLong && !expanded ? COLLAPSED_LINES : undefined}
      style={[
        typography.body,
        highlight
          ? [styles.highlight, { backgroundColor: tokens.primaryMuted, color: tokens.foreground }]
          : { color: tokens.foreground },
      ]}
    >
      {text}
    </Text>
  );

  if (!isLong || !interactive) {
    return valueText;
  }

  // A markdown field on the record screen reads as formatted text, as on web —
  // not as its `**` and `#` symbols.
  const body =
    field?.type === "markdown" ? (
      <CollapsedMarkdown collapsed={!expanded} maxHeight={COLLAPSED_LINES * 22}>
        {text}
      </CollapsedMarkdown>
    ) : (
      valueText
    );

  return (
    <View style={styles.longText}>
      {body}
      <Text
        accessibilityRole="button"
        onPress={() => setExpanded((current) => !current)}
        style={[typography.small, styles.expandText, { color: tokens.primary }]}
      >
        {expanded ? "Show less" : "Show more"}
      </Text>
    </View>
  );
}

/**
 * A `date` field value, read the same by every teammate: a day value is that
 * day everywhere; a date-time value is shown in the field's pinned zone (else
 * the device's), with a "+1"/"-1" when that lands on a different day than the
 * writer typed, and the writer's / reader's own wall time underneath.
 */
function DateValue({
  field,
  value,
  highlight,
  compact,
}: {
  field: BaseFieldVO;
  value: unknown;
  highlight?: boolean;
  /** Dense cells (table, gallery): one line; the extra context moves to the a11y hint. */
  compact?: boolean;
}) {
  const tokens = useTokens();
  const { t, locale } = useI18n();
  const display = describeDateFieldValue(value, {
    locale,
    options: getDateFieldOptions(field.options),
  });
  if (!display) {
    return null;
  }
  const shift = display.dayShift > 0 ? `+${display.dayShift}` : String(display.dayShift);
  const secondary = [
    display.enteredAs ? fmt(t.dateField.enteredAs, { value: display.enteredAs }) : null,
    display.readerLocal ? fmt(t.dateField.yourLocalTime, { value: display.readerLocal }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <View style={styles.dateValue}>
      <Text
        numberOfLines={compact ? 1 : undefined}
        accessibilityHint={secondary.length > 0 ? secondary.join(". ") : undefined}
        style={[
          typography.body,
          highlight
            ? [styles.highlight, { backgroundColor: tokens.primaryMuted, color: tokens.foreground }]
            : { color: tokens.foreground },
        ]}
      >
        {display.text}
        {display.dayShift !== 0 ? (
          <Text
            accessibilityLabel={fmt(t.dateField.dayShiftHint, { shift })}
            style={[typography.small, { color: tokens.mutedForeground }]}
          >
            {` ${shift}`}
          </Text>
        ) : null}
      </Text>
      {(compact ? [] : secondary).map((line) => (
        <Text key={line} style={[typography.small, { color: tokens.mutedForeground }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Initials for the avatar bubble — mirrors the web chip's `initialsFor`. */
const memberInitials = (label: string) => {
  const clean = label.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : clean.slice(0, 2)).toUpperCase();
};

function MemberChip({ id, user }: { id: string; user?: UserRefVO }) {
  const tokens = useTokens();
  // Same label rule as the web chip (`formatMemberChipLabel`), imported rather
  // than re-implemented so the two platforms can never disagree about who a
  // given id is.
  const label = formatMemberChipLabel(user, id);
  return (
    <View style={[styles.memberChip, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
      {user?.image ? (
        <Image source={{ uri: user.image }} style={styles.memberAvatar} />
      ) : (
        <View style={[styles.memberAvatar, { backgroundColor: tokens.muted }]}>
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
            {memberInitials(label)}
          </Text>
        </View>
      )}
      <Text numberOfLines={1} style={[typography.small, { color: tokens.foreground }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  memberChip: {
    alignItems: "center",
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    paddingLeft: 3,
    paddingRight: 10,
    paddingVertical: 3,
  },
  memberAvatar: {
    alignItems: "center",
    borderRadius: radius.full,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  link: { textDecorationLine: "underline" },
  expandText: { alignSelf: "flex-start", paddingVertical: 2 },
  highlight: { borderRadius: radius.sm, paddingHorizontal: 4 },
  longText: { gap: 6 },
  dateValue: { gap: 2 },
});
