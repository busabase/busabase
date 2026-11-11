import type { BaseFieldVO } from "busabase-contract/types";
import { FolderPlus, Paperclip } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { FileTreeList } from "~/domains/knowledge/components/FileTreeList";
import { fmt, useI18n } from "~/i18n";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useDriveField } from "../hooks/use-drive-field";
import type { DriveRef } from "../utils/drive-field";
import { AttachmentPickerSheet } from "./AttachmentPickerSheet";
import { DriveFieldSheets } from "./DriveFieldSheets";

interface RecordDriveFieldProps {
  field: BaseFieldVO;
  entries: DriveRef[];
  onChange: (entries: DriveRef[]) => void;
}

/**
 * Editor for a `drive` field: the cell's files in folders, browsed with the
 * Drive node's own list. Add a file into the folder you are in, open a new
 * folder, and rename / move / remove files and folders.
 */
export function RecordDriveField({ field, entries, onChange }: RecordDriveFieldProps) {
  const tokens = useTokens();
  const { t } = useI18n();
  const drive = useDriveField({ field, entries, onChange });
  const { upload } = drive;

  return (
    <View style={styles.editor}>
      <FileTreeList
        currentFolder={drive.folder}
        fileItems={drive.items}
        totalFileCount={entries.length}
        visibleFiles={drive.visibleItems}
        onOpenFile={(file) => drive.openFile(file.path)}
        onOpenFolder={drive.openFolder}
        onFolderActions={drive.openFolderActions}
        style={styles.list}
      />
      {drive.pendingFolder ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {t.driveField.pendingFolderHint}
        </Text>
      ) : null}

      {upload.uploading ? (
        <View style={styles.busy}>
          <ActivityIndicator size="small" color={tokens.primary} />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>
            {t.attachment.uploading}
          </Text>
        </View>
      ) : null}
      {upload.error ? (
        <Text style={[typography.small, { color: tokens.destructive }]}>{upload.error}</Text>
      ) : null}

      <View style={styles.actions}>
        {upload.atLimit ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={upload.uploading}
            style={[
              styles.action,
              { backgroundColor: tokens.primaryMuted, opacity: upload.uploading ? 0.62 : 1 },
            ]}
            onPress={() => upload.setPickerOpen(true)}
          >
            <Paperclip size={16} color={tokens.foreground} />
            <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
              {t.attachment.add}
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          style={[
            styles.action,
            { borderColor: tokens.border, borderWidth: StyleSheet.hairlineWidth },
          ]}
          onPress={drive.startNewFolder}
        >
          <FolderPlus size={16} color={tokens.foreground} />
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
            {t.driveField.newFolder}
          </Text>
        </Pressable>
      </View>

      <AttachmentPickerSheet
        attachment={upload}
        title={fmt(t.driveField.addTo, { folder: drive.folder || t.fileTree.root })}
        description={t.driveField.addDescription}
      />
      <DriveFieldSheets drive={drive} />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 10 },
  // The list sits inside a form row that already has its own padding.
  list: { marginHorizontal: 0, marginTop: 0 },
  busy: { flexDirection: "row", alignItems: "center", gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: {
    minHeight: 44,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
});
