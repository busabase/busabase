import type { AttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { FileText } from "lucide-react-native";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useConnection } from "~/connection/connection-store";
import { getAttachmentRefs, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { stringifyFieldValue } from "~/lib/busabase-display";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const LONG_TEXT_TYPES = new Set(["longtext", "markdown", "html", "ai_summary"]);
const LONG_TEXT_THRESHOLD = 180;
const COLLAPSED_LINES = 4;

interface FieldValueProps {
  field?: BaseFieldVO;
  value: unknown;
  /** Render the value as a proposed (new) value — used in change request diffs. */
  highlight?: boolean;
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
  if (field.type === "url") {
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

export function FieldValue({ field, value, highlight }: FieldValueProps) {
  const tokens = useTokens();
  const [expanded, setExpanded] = useState(false);

  if (field?.type === "attachment") {
    return <AttachmentValue value={value} />;
  }

  if (field?.type === "checkbox") {
    const checked = value === true || value === "true";
    return (
      <Text style={[typography.body, { color: checked ? tokens.success : tokens.mutedForeground }]}>
        {checked ? "Yes" : "No"}
      </Text>
    );
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
    return (
      <Pressable onPress={() => void Linking.openURL(href).catch(() => undefined)}>
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

  if (!isLong) {
    return valueText;
  }

  return (
    <View style={styles.longText}>
      {valueText}
      <Pressable accessibilityRole="button" onPress={() => setExpanded((current) => !current)}>
        <Text style={[typography.small, { color: tokens.primary }]}>
          {expanded ? "Show less" : "Show more"}
        </Text>
      </Pressable>
    </View>
  );
}

/** Renders an `attachment` field value: image thumbnails + tappable file chips. */
function AttachmentValue({ value }: { value: unknown }) {
  const tokens = useTokens();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const refs = getAttachmentRefs(value);

  if (refs.length === 0) {
    return <Text style={[typography.body, { color: tokens.mutedForeground }]}>-</Text>;
  }

  const images = refs.filter(isImageRef);
  const others = refs.filter((ref) => !isImageRef(ref));
  const open = (ref: AttachmentRef) =>
    void Linking.openURL(resolveAttachmentUrl(serverUrl, ref.url)).catch(() => undefined);

  return (
    <View style={styles.attachmentList}>
      {images.length > 0 ? (
        <View style={styles.attachmentImages}>
          {images.map((ref) => (
            <Pressable key={ref.id} accessibilityRole="imagebutton" onPress={() => open(ref)}>
              <Image
                source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
                resizeMode="cover"
                style={[styles.attachmentThumb, { borderColor: tokens.border }]}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {others.length > 0 ? (
        <View style={styles.chips}>
          {others.map((ref) => (
            <Pressable
              key={ref.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${ref.fileName}`}
              style={[
                styles.fileChip,
                { backgroundColor: tokens.surface, borderColor: tokens.border },
              ]}
              onPress={() => open(ref)}
            >
              <FileText size={13} color={tokens.primary} />
              <Text numberOfLines={1} style={[typography.small, { color: tokens.primary }]}>
                {ref.fileName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  attachmentList: { gap: 8 },
  attachmentImages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachmentThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  link: { textDecorationLine: "underline" },
  highlight: { borderRadius: radius.sm, paddingHorizontal: 4 },
  longText: { gap: 6 },
});
