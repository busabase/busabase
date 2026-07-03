import type { AttachmentRef, BaseFieldVO } from "busabase-contract/types";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { FileText, ImagePlus, Paperclip, X } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import { isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { type PickedFile, uploadAttachment } from "~/lib/attachment-upload";
import { isEditableField, type RecordFormValue } from "~/lib/record-form";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { TextInput } from "../ui/TextInput";

interface RecordFormProps {
  fields: BaseFieldVO[];
  values: Record<string, RecordFormValue>;
  onChange: (slug: string, value: RecordFormValue) => void;
}

const MULTILINE_TYPES = new Set(["longtext", "markdown", "html"]);

function ChoiceChips({
  choices,
  selected,
  multiple,
  onToggle,
}: {
  choices: NonNullable<BaseFieldVO["options"]["choices"]>;
  selected: string[];
  multiple: boolean;
  onToggle: (id: string) => void;
}) {
  const tokens = useTokens();
  return (
    <View style={styles.chips}>
      {choices.map((choice) => {
        const active = selected.includes(choice.id);
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? tokens.primaryMuted : tokens.surface,
                borderColor: active ? tokens.primary : tokens.border,
              },
            ]}
            onPress={() => onToggle(choice.id)}
          >
            <Text
              style={[
                typography.small,
                { color: active ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {multiple ? choice.name : choice.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
}) {
  const tokens = useTokens();
  const meta = (
    <View style={styles.meta}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
        {iStringParse(field.name)}
        {field.required ? <Text style={{ color: tokens.destructive }}> *</Text> : null}
      </Text>
      <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{field.type}</Text>
    </View>
  );

  if (!isEditableField(field)) {
    return (
      <View style={[styles.field, { borderColor: tokens.border }]}>
        {meta}
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          Managed by the server — edit on web if needed.
        </Text>
      </View>
    );
  }

  if (field.type === "checkbox") {
    return (
      <View style={[styles.field, styles.checkboxRow, { borderColor: tokens.border }]}>
        {meta}
        <Switch
          value={value === true}
          trackColor={{ true: tokens.primary }}
          onValueChange={(next) => onChange(next)}
        />
      </View>
    );
  }

  if (field.type === "attachment") {
    const refs = Array.isArray(value)
      ? value.filter((item): item is AttachmentRef => typeof item === "object" && item !== null)
      : [];
    return (
      <View style={[styles.field, { borderColor: tokens.border }]}>
        {meta}
        <AttachmentFieldEditor field={field} refs={refs} onChange={(next) => onChange(next)} />
      </View>
    );
  }

  if (field.type === "select" || field.type === "multiselect") {
    const choices = field.options.choices ?? [];
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : value
        ? [String(value)]
        : [];
    const multiple = field.type === "multiselect";
    return (
      <View style={[styles.field, { borderColor: tokens.border }]}>
        {meta}
        <ChoiceChips
          choices={choices}
          selected={selected}
          multiple={multiple}
          onToggle={(id) => {
            if (multiple) {
              onChange(
                selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
              );
            } else {
              onChange(selected[0] === id ? "" : id);
            }
          }}
        />
      </View>
    );
  }

  const multiline = MULTILINE_TYPES.has(field.type);
  const keyboardType =
    field.type === "number"
      ? "numeric"
      : field.type === "email"
        ? "email-address"
        : field.type === "phone"
          ? "phone-pad"
          : field.type === "url"
            ? "url"
            : "default";

  return (
    <View style={[styles.field, { borderColor: tokens.border }]}>
      {meta}
      <TextInput
        value={typeof value === "string" ? value : ""}
        multiline={multiline}
        keyboardType={keyboardType}
        textAlignVertical={multiline ? "top" : "center"}
        style={multiline ? styles.multiline : undefined}
        placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
        onChangeText={(next) => onChange(next)}
      />
    </View>
  );
}

/** Pick + upload files for an `attachment` field, then store the inline refs. */
function AttachmentFieldEditor({
  field,
  refs,
  onChange,
}: {
  field: BaseFieldVO;
  refs: AttachmentRef[];
  onChange: (refs: AttachmentRef[]) => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxFiles = field.options.attachment?.maxFiles;
  const atLimit = typeof maxFiles === "number" && maxFiles > 0 && refs.length >= maxFiles;

  const upload = async (file: PickedFile) => {
    if (!buda || !serverUrl) {
      setError("Not connected");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const ref = await uploadAttachment(buda.client, serverUrl, file);
      // Single-file fields replace; multi-file fields append.
      onChange(maxFiles === 1 ? [ref] : [...refs, ref]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      name: asset.fileName ?? `image-${asset.assetId ?? "upload"}.jpg`,
      mimeType: asset.mimeType ?? "image/jpeg",
      size: asset.fileSize ?? 0,
    });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await upload({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 0,
    });
  };

  return (
    <View style={styles.attachmentEditor}>
      {refs.length > 0 ? (
        <View style={styles.attachmentRefs}>
          {refs.map((ref) => (
            <View key={ref.id} style={[styles.attachmentItem, { borderColor: tokens.border }]}>
              {isImageRef(ref) ? (
                <Image
                  source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
                  resizeMode="cover"
                  style={styles.attachmentThumb}
                />
              ) : (
                <FileText size={16} color={tokens.mutedForeground} />
              )}
              <Text
                numberOfLines={1}
                style={[typography.small, styles.attachmentName, { color: tokens.foreground }]}
              >
                {ref.fileName}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.attachment.remove} ${ref.fileName}`}
                hitSlop={8}
                onPress={() => onChange(refs.filter((item) => item.id !== ref.id))}
              >
                <X size={16} color={tokens.destructive} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.attachment.empty}
        </Text>
      )}

      {uploading ? (
        <View style={styles.attachmentBusy}>
          <ActivityIndicator size="small" color={tokens.primary} />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.attachment.uploading}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>{error}</Text>
      ) : null}

      {atLimit ? null : (
        <View style={styles.attachmentActions}>
          <Pressable
            accessibilityRole="button"
            disabled={uploading}
            style={[styles.attachmentButton, { borderColor: tokens.border }]}
            onPress={() => void pickImage()}
          >
            <ImagePlus size={16} color={tokens.primary} />
            <Text style={[typography.small, { color: tokens.primary }]}>
              {t.attachment.addImage}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={uploading}
            style={[styles.attachmentButton, { borderColor: tokens.border }]}
            onPress={() => void pickDocument()}
          >
            <Paperclip size={16} color={tokens.primary} />
            <Text style={[typography.small, { color: tokens.primary }]}>{t.attachment.add}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function RecordForm({ fields, values, onChange }: RecordFormProps) {
  return (
    <View style={styles.list}>
      {fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          value={values[field.slug] ?? ""}
          onChange={(next) => onChange(field.slug, next)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: 12,
    gap: 8,
  },
  meta: { gap: 2 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  multiline: { minHeight: 96, paddingTop: 10 },
  attachmentEditor: { gap: 10 },
  attachmentRefs: { gap: 8 },
  attachmentItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attachmentThumb: { width: 36, height: 36, borderRadius: radius.sm },
  attachmentName: { flex: 1 },
  attachmentBusy: { flexDirection: "row", alignItems: "center", gap: 8 },
  attachmentActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  attachmentButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
