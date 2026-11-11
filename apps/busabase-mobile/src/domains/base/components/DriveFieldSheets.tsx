import { fileTreeFileName } from "busabase-core/dashboard/file-tree-files";
import { ExternalLink, Pencil, Trash2 } from "lucide-react-native";
import { Image, Linking, StyleSheet } from "react-native";
import { NativeActionBar, NativeBottomSheet } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { fmt, useI18n } from "~/i18n";
import { getAttachmentKindLabel, isImageRef, resolveAttachmentUrl } from "~/lib/attachment";
import { formatBytes } from "~/lib/format";
import { radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { DriveFieldController } from "../hooks/use-drive-field";
import { formatDriveFileCount } from "../utils/drive-field";

/** The file, folder, rename/move, new-folder and remove-folder sheets of RecordDriveField. */
export function DriveFieldSheets({ drive }: { drive: DriveFieldController }) {
  const tokens = useTokens();
  const { t } = useI18n();
  const { sheet, selectedEntry } = drive;
  const serverUrl = drive.upload.serverUrl;
  const folderPath = sheet?.kind === "folder" || sheet?.kind === "removeFolder" ? sheet.path : "";
  const folderFiles = formatDriveFileCount(drive.countFolderFiles(folderPath), t.driveField);
  const cancel = (
    <Button label={t.common.cancel} variant="ghost" fullWidth onPress={drive.closeSheet} />
  );

  return (
    <>
      <NativeBottomSheet
        visible={sheet?.kind === "file" && !!selectedEntry}
        title={selectedEntry ? fileTreeFileName(selectedEntry.path) : undefined}
        description={
          selectedEntry
            ? `${selectedEntry.path} · ${getAttachmentKindLabel(selectedEntry)} · ${formatBytes(selectedEntry.size)}`
            : undefined
        }
        showCloseButton
        onClose={drive.closeSheet}
        footer={
          selectedEntry ? (
            <NativeActionBar>
              <Button
                label={t.driveField.openFile}
                fullWidth
                leadingIcon={<ExternalLink size={18} color={tokens.primaryForeground} />}
                onPress={() =>
                  void Linking.openURL(resolveAttachmentUrl(serverUrl, selectedEntry.url)).catch(
                    () => undefined,
                  )
                }
              />
              <Button
                label={t.driveField.renameOrMove}
                variant="secondary"
                fullWidth
                leadingIcon={<Pencil size={18} color={tokens.foreground} />}
                onPress={() => drive.startRename("file", selectedEntry.path)}
              />
              <Button
                label={t.attachment.remove}
                variant="destructive"
                fullWidth
                leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
                onPress={() => drive.removeFile(selectedEntry.path)}
              />
              {cancel}
            </NativeActionBar>
          ) : undefined
        }
      >
        {selectedEntry && isImageRef(selectedEntry) ? (
          <Image
            source={{ uri: resolveAttachmentUrl(serverUrl, selectedEntry.url) }}
            resizeMode="contain"
            style={[styles.preview, { backgroundColor: tokens.muted }]}
          />
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={sheet?.kind === "folder"}
        title={fileTreeFileName(folderPath)}
        description={`${folderPath} · ${folderFiles}`}
        showCloseButton
        onClose={drive.closeSheet}
        footer={
          <NativeActionBar>
            <Button
              label={t.driveField.renameOrMove}
              variant="secondary"
              fullWidth
              leadingIcon={<Pencil size={18} color={tokens.foreground} />}
              onPress={() => drive.startRename("folder", folderPath)}
            />
            <Button
              label={t.driveField.removeFolder}
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => drive.askRemoveFolder(folderPath)}
            />
            {cancel}
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={sheet?.kind === "rename" || sheet?.kind === "newFolder"}
        title={sheet?.kind === "newFolder" ? t.driveField.newFolder : t.driveField.renameOrMove}
        description={
          sheet?.kind === "newFolder"
            ? t.driveField.newFolderDescription
            : sheet?.kind === "rename" && sheet.target === "folder"
              ? t.driveField.folderPathHint
              : t.driveField.filePathHint
        }
        showCloseButton
        onClose={drive.closeSheet}
        footer={
          <NativeActionBar>
            <Button
              label={sheet?.kind === "newFolder" ? t.common.create : t.common.save}
              fullWidth
              onPress={drive.submitSheet}
            />
            {cancel}
          </NativeActionBar>
        }
      >
        {sheet?.kind === "rename" || sheet?.kind === "newFolder" ? (
          <TextInput
            label={sheet.kind === "newFolder" ? t.driveField.folderName : t.driveField.path}
            value={sheet.value}
            error={sheet.error ?? undefined}
            autoFocus
            returnKeyType="done"
            onChangeText={drive.setSheetValue}
            onSubmitEditing={drive.submitSheet}
          />
        ) : null}
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={sheet?.kind === "removeFolder"}
        title={fmt(t.driveField.removeFolderTitle, { folder: fileTreeFileName(folderPath) })}
        description={fmt(t.driveField.removeFolderDescription, { files: folderFiles })}
        showCloseButton
        onClose={drive.closeSheet}
        footer={
          <NativeActionBar>
            <Button
              label={t.driveField.removeFolder}
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => drive.confirmRemoveFolder(folderPath)}
            />
            {cancel}
          </NativeActionBar>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  preview: { width: "100%", height: 220, borderRadius: radius.md },
});
