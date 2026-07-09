import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { FileText, ImagePlus, Paperclip, Trash2 } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useConnection } from "~/connection/connection-store";
import { useI18n } from "~/i18n";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { type PickedFile, uploadAttachment } from "~/lib/attachment-upload";
import { getFieldTypeLabel } from "~/lib/field-type-label";
import { formatBytes } from "~/lib/format";
import { isEditableField, type RecordFormValue } from "~/lib/record-form";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeInlineError,
  NativeRow,
} from "../native-screen";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

interface RecordFormProps {
  fields: BaseFieldVO[];
  values: Record<string, RecordFormValue>;
  onChange: (slug: string, value: RecordFormValue) => void;
  variant?: "grouped" | "embedded";
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
  const options = choices.map((choice) => ({ value: choice.id, label: choice.name }));
  const selectedValue = selected[0] ?? null;

  if (multiple) {
    return (
      <View style={styles.choiceFullBleed}>
        <NativeChipList<string | null>
          value={null}
          selectedValues={selected}
          options={options}
          onChange={(id) => {
            if (id) onToggle(id);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.choiceFullBleed}>
      <NativeChipList<string | null>
        value={selectedValue}
        options={options}
        onChange={(id) => {
          if (id) onToggle(id);
        }}
      />
    </View>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  last,
}: {
  field: BaseFieldVO;
  value: RecordFormValue;
  onChange: (value: RecordFormValue) => void;
  last: boolean;
}) {
  const tokens = useTokens();
  const rowStyle = [
    styles.field,
    !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
  ];
  const meta = (
    <View style={styles.meta}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
        {iStringParse(field.name)}
        {field.required ? <Text style={{ color: tokens.destructive }}> *</Text> : null}
      </Text>
      <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
        {getFieldTypeLabel(field.type)}
      </Text>
    </View>
  );

  if (!isEditableField(field)) {
    return (
      <View style={rowStyle}>
        {meta}
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          Managed by the server — edit on web if needed.
        </Text>
      </View>
    );
  }

  if (field.type === "checkbox") {
    return (
      <View style={[...rowStyle, styles.checkboxRow]}>
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
      ? value.filter(
          (item): item is AssetAttachmentRef => typeof item === "object" && item !== null,
        )
      : [];
    return (
      <View style={rowStyle}>
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
      <View style={rowStyle}>
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
          : field.type === "url" || field.type === "embed"
            ? "url"
            : "default";

  return (
    <View style={rowStyle}>
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
  refs: AssetAttachmentRef[];
  onChange: (refs: AssetAttachmentRef[]) => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const { getCloudAuthorizationHeaders, state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;
  const connectionMode = state.status === "connected" ? state.connection.mode : null;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedRef, setSelectedRef] = useState<AssetAttachmentRef | null>(null);

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
      const headers = connectionMode === "cloud" ? await getCloudAuthorizationHeaders() : {};
      const ref = await uploadAttachment(buda.client, serverUrl, file, headers);
      // Single-file fields replace; multi-file fields append.
      onChange(maxFiles === 1 ? [ref] : [...refs, ref]);
      setPickerOpen(false);
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
            <NativeRow
              key={ref.id}
              title={ref.fileName}
              subtitle={`${getAttachmentKindLabel(ref)} · ${formatBytes(ref.size)}`}
              leading={
                isImageRef(ref) ? (
                  <Image
                    source={{ uri: resolveAttachmentUrl(serverUrl, ref.url) }}
                    resizeMode="cover"
                    style={styles.attachmentThumb}
                  />
                ) : (
                  <FileText size={18} color={tokens.mutedForeground} />
                )
              }
              onPress={() => setSelectedRef(ref)}
              last={ref.id === refs[refs.length - 1]?.id}
            />
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
        <Pressable
          accessibilityRole="button"
          disabled={uploading}
          style={[
            styles.attachmentAddRow,
            { backgroundColor: tokens.primaryMuted, opacity: uploading ? 0.62 : 1 },
          ]}
          onPress={() => setPickerOpen(true)}
        >
          <Paperclip size={16} color={tokens.foreground} />
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{t.attachment.add}</Text>
        </Pressable>
      )}

      <NativeBottomSheet
        visible={pickerOpen}
        title="Add attachment"
        description="Choose a photo or a file to upload into this record field."
        showCloseButton
        onClose={() => setPickerOpen(false)}
        footer={
          <NativeActionBar>
            {uploading ? (
              <View style={styles.attachmentBusy}>
                <ActivityIndicator size="small" color={tokens.primary} />
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  {t.attachment.uploading}
                </Text>
              </View>
            ) : null}
            {error ? <NativeInlineError message={error} onReset={() => setError(null)} /> : null}
            <Button
              label="Cancel"
              variant="ghost"
              disabled={uploading}
              fullWidth
              onPress={() => setPickerOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.attachmentSheetRows}>
          <NativeRow
            title={t.attachment.addImage}
            subtitle="Pick from the photo library."
            leading={<ImagePlus size={18} color={tokens.primary} />}
            disabled={uploading}
            onPress={() => void pickImage()}
          />
          <NativeRow
            title={t.attachment.add}
            subtitle="Browse files on this device."
            leading={<Paperclip size={18} color={tokens.primary} />}
            disabled={uploading}
            last
            onPress={() => void pickDocument()}
          />
        </View>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={!!selectedRef}
        title={selectedRef?.fileName}
        description={
          selectedRef
            ? `${getAttachmentKindLabel(selectedRef)} · ${formatBytes(selectedRef.size)}`
            : undefined
        }
        showCloseButton
        onClose={() => setSelectedRef(null)}
        footer={
          <NativeActionBar>
            <Button
              label={t.attachment.remove}
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                if (selectedRef) {
                  onChange(refs.filter((item) => item.id !== selectedRef.id));
                }
                setSelectedRef(null);
              }}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              fullWidth
              onPress={() => setSelectedRef(null)}
            />
          </NativeActionBar>
        }
      >
        {selectedRef && isImageRef(selectedRef) ? (
          <Image
            source={{ uri: resolveAttachmentUrl(serverUrl, selectedRef.url) }}
            resizeMode="contain"
            style={styles.attachmentPreview}
          />
        ) : null}
      </NativeBottomSheet>
    </View>
  );
}

export function RecordForm({ fields, values, onChange, variant = "grouped" }: RecordFormProps) {
  const tokens = useTokens();
  return (
    <View
      style={[
        styles.list,
        variant === "grouped"
          ? { backgroundColor: tokens.card, borderColor: tokens.border }
          : styles.embeddedList,
      ]}
    >
      {fields.map((field, index) => (
        <FieldRow
          key={field.id}
          field={field}
          value={values[field.slug] ?? ""}
          onChange={(next) => onChange(field.slug, next)}
          last={index === fields.length - 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  embeddedList: {
    borderWidth: 0,
    borderRadius: 0,
  },
  field: {
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  attachmentThumb: { width: 36, height: 36, borderRadius: radius.sm },
  attachmentPreview: { width: "100%", height: 220, borderRadius: radius.md },
  attachmentBusy: { flexDirection: "row", alignItems: "center", gap: 8 },
  attachmentAddRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  attachmentSheetRows: { gap: 8 },
  choiceFullBleed: { marginHorizontal: -14 },
});
