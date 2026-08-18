import type { AssetAttachmentRef, BaseFieldVO } from "busabase-contract/types";
import { FileText, ImagePlus, Paperclip, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useAttachmentField } from "../hooks/use-attachment-field";

interface RecordAttachmentFieldProps {
  field: BaseFieldVO;
  refs: AssetAttachmentRef[];
  onChange: (refs: AssetAttachmentRef[]) => void;
}

export function RecordAttachmentField({ field, refs, onChange }: RecordAttachmentFieldProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const attachment = useAttachmentField({
    maxFiles: field.options.attachment?.maxFiles,
    refs,
    onChange,
  });

  return (
    <View style={styles.editor}>
      {refs.length > 0 ? (
        <View style={styles.refs}>
          {refs.map((ref) => (
            <NativeRow
              key={ref.id}
              title={ref.fileName}
              subtitle={`${getAttachmentKindLabel(ref)} · ${formatBytes(ref.size)}`}
              leading={
                isImageRef(ref) ? (
                  <Image
                    source={{ uri: resolveAttachmentUrl(attachment.serverUrl, ref.url) }}
                    resizeMode="cover"
                    style={styles.thumb}
                  />
                ) : (
                  <FileText size={18} color={tokens.mutedForeground} />
                )
              }
              onPress={() => attachment.setSelectedRef(ref)}
              last={ref.id === refs[refs.length - 1]?.id}
            />
          ))}
        </View>
      ) : (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.attachment.empty}
        </Text>
      )}

      {attachment.uploading ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={tokens.primary} />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.attachment.uploading}
          </Text>
        </View>
      ) : null}
      {attachment.error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>{attachment.error}</Text>
      ) : null}

      {attachment.atLimit ? null : (
        <Pressable
          accessibilityRole="button"
          disabled={attachment.uploading}
          style={[
            styles.addRow,
            {
              backgroundColor: tokens.primaryMuted,
              opacity: attachment.uploading ? 0.62 : 1,
            },
          ]}
          onPress={() => attachment.setPickerOpen(true)}
        >
          <Paperclip size={16} color={tokens.foreground} />
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{t.attachment.add}</Text>
        </Pressable>
      )}

      <NativeBottomSheet
        visible={attachment.pickerOpen}
        title="Add attachment"
        description="Choose a photo or a file to upload into this record field."
        showCloseButton
        onClose={() => attachment.setPickerOpen(false)}
        footer={
          <NativeActionBar>
            {attachment.uploading ? (
              <View style={styles.busy}>
                <ActivityIndicator size="small" color={tokens.primary} />
                <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                  {t.attachment.uploading}
                </Text>
              </View>
            ) : null}
            {attachment.error ? (
              <NativeInlineError
                message={attachment.error}
                onReset={() => attachment.setError(null)}
              />
            ) : null}
            <Button
              label="Cancel"
              variant="ghost"
              disabled={attachment.uploading}
              fullWidth
              onPress={() => attachment.setPickerOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.sheetRows}>
          <NativeRow
            title={t.attachment.addImage}
            subtitle="Pick from the photo library."
            leading={<ImagePlus size={18} color={tokens.primary} />}
            disabled={attachment.uploading}
            onPress={() => void attachment.pickImage()}
          />
          <NativeRow
            title={t.attachment.add}
            subtitle="Browse files on this device."
            leading={<Paperclip size={18} color={tokens.primary} />}
            disabled={attachment.uploading}
            last
            onPress={() => void attachment.pickDocument()}
          />
        </View>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={!!attachment.selectedRef}
        title={attachment.selectedRef?.fileName}
        description={
          attachment.selectedRef
            ? `${getAttachmentKindLabel(attachment.selectedRef)} · ${formatBytes(attachment.selectedRef.size)}`
            : undefined
        }
        showCloseButton
        onClose={() => attachment.setSelectedRef(null)}
        footer={
          <NativeActionBar>
            <Button
              label={t.attachment.remove}
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={attachment.removeSelected}
            />
            <Button
              label={t.common.cancel}
              variant="ghost"
              fullWidth
              onPress={() => attachment.setSelectedRef(null)}
            />
          </NativeActionBar>
        }
      >
        {attachment.selectedRef && isImageRef(attachment.selectedRef) ? (
          <Image
            source={{
              uri: resolveAttachmentUrl(attachment.serverUrl, attachment.selectedRef.url),
            }}
            resizeMode="contain"
            style={styles.preview}
          />
        ) : null}
      </NativeBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 10 },
  refs: { gap: 8 },
  thumb: { width: 36, height: 36, borderRadius: radius.sm },
  preview: { width: "100%", height: 220, borderRadius: radius.md },
  busy: { flexDirection: "row", alignItems: "center", gap: 8 },
  addRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  sheetRows: { gap: 8 },
});
