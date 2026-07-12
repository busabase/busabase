import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { ExternalLink, FileText } from "lucide-react-native";
import { useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useConnection } from "~/connection/connection-store";
import {
  getAttachmentKindLabel,
  getAttachmentRefs,
  isImageRef,
  resolveAttachmentUrl,
} from "~/lib/attachment";
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

  if (!isLong) {
    return valueText;
  }

  return (
    <View style={styles.longText}>
      {valueText}
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

/** Renders an `attachment` field value: image thumbnails + tappable file chips. */
function AttachmentValue({ value }: { value: unknown }) {
  const tokens = useTokens();
  const { state } = useConnection();
  const [selectedRef, setSelectedRef] = useState<AssetAttachmentRef | null>(null);
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const refs = getAttachmentRefs(value);
  const selectedUrl = selectedRef ? resolveAttachmentUrl(serverUrl, selectedRef.url) : null;

  if (refs.length === 0) {
    return <Text style={[typography.body, { color: tokens.mutedForeground }]}>-</Text>;
  }

  const images = refs.filter(isImageRef);
  const others = refs.filter((ref) => !isImageRef(ref));
  const open = (ref: AssetAttachmentRef) =>
    void Linking.openURL(resolveAttachmentUrl(serverUrl, ref.url)).catch(() => undefined);

  return (
    <>
      <View style={styles.attachmentList}>
        {images.length > 0 ? (
          <View style={styles.attachmentImages}>
            {images.map((ref) => (
              <Pressable
                key={ref.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={`View ${getAttachmentKindLabel(ref)} ${ref.fileName}`}
                onPress={() => setSelectedRef(ref)}
              >
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
          <View style={styles.attachmentRows}>
            {others.map((ref) => (
              <Pressable
                key={ref.id}
                accessibilityRole="button"
                accessibilityLabel={`View ${getAttachmentKindLabel(ref)} ${ref.fileName}`}
                style={[
                  styles.fileRow,
                  { backgroundColor: tokens.surface, borderColor: tokens.border },
                ]}
                onPress={() => setSelectedRef(ref)}
              >
                <FileText size={14} color={tokens.primary} />
                <Text
                  numberOfLines={1}
                  style={[typography.small, styles.fileName, { color: tokens.primary }]}
                >
                  {ref.fileName}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <NativeBottomSheet
        visible={!!selectedRef}
        title={selectedRef?.fileName}
        description={selectedRef ? getAttachmentKindLabel(selectedRef) : undefined}
        showCloseButton
        onClose={() => setSelectedRef(null)}
        footer={
          selectedRef ? (
            <NativeActionBar>
              <Button
                label="Open file"
                fullWidth
                leadingIcon={<ExternalLink size={18} color={tokens.primaryForeground} />}
                onPress={() => open(selectedRef)}
              />
              <Button label="Done" variant="ghost" fullWidth onPress={() => setSelectedRef(null)} />
            </NativeActionBar>
          ) : undefined
        }
      >
        {selectedRef && selectedUrl && isImageRef(selectedRef) ? (
          <Image
            source={{ uri: selectedUrl }}
            resizeMode="contain"
            style={[styles.attachmentPreview, { backgroundColor: tokens.muted }]}
          />
        ) : null}
        {selectedRef ? (
          <NativeSection title="File">
            <NativeRow title="Name" subtitle={selectedRef.fileName} />
            <NativeRow
              title="Type"
              subtitle={selectedRef.mimeType || getAttachmentKindLabel(selectedRef)}
              last
            />
          </NativeSection>
        ) : null}
      </NativeBottomSheet>
    </>
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
  attachmentRows: { gap: 6 },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  fileName: { flex: 1, minWidth: 0 },
  attachmentPreview: { width: "100%", height: 220, borderRadius: radius.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  link: { textDecorationLine: "underline" },
  expandText: { alignSelf: "flex-start", paddingVertical: 2 },
  highlight: { borderRadius: radius.sm, paddingHorizontal: 4 },
  longText: { gap: 6 },
});
