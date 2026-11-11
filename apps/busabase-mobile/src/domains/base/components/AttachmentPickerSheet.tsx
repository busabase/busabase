import { ImagePlus, Paperclip } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeInlineError,
  NativeRow,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { useAttachmentField } from "../hooks/use-attachment-field";

interface AttachmentPickerSheetProps {
  attachment: ReturnType<typeof useAttachmentField>;
  title: string;
  description: string;
}

/**
 * "Photo or file?" — the upload source sheet shared by the `attachment` and
 * `drive` field editors, so both pick and upload exactly the same way.
 */
export function AttachmentPickerSheet({
  attachment,
  title,
  description,
}: AttachmentPickerSheetProps) {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <NativeBottomSheet
      visible={attachment.pickerOpen}
      title={title}
      description={description}
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
            label={t.common.cancel}
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
  );
}

const styles = StyleSheet.create({
  busy: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetRows: { gap: 8 },
});
