import { Trash2 } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { NativeActionBar, NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useTokens } from "~/theme/use-tokens";
import type { OpenFile } from "../types/file-tree";

interface FileActionSheetsProps {
  openFile: OpenFile | null;
  saving: boolean;
  actionError: string | null;
  actionsVisible: boolean;
  discardVisible: boolean;
  deleteVisible: boolean;
  deleteMessage: string;
  onClearError: () => void;
  onCloseActions: () => void;
  onProposeDelete: () => void;
  onCloseDiscard: () => void;
  onDiscard: () => void;
  onCloseDelete: () => void;
  onDeleteMessageChange: (message: string) => void;
  onSubmitDelete: () => void;
}

export function FileActionSheets({
  openFile,
  saving,
  actionError,
  actionsVisible,
  discardVisible,
  deleteVisible,
  deleteMessage,
  onClearError,
  onCloseActions,
  onProposeDelete,
  onCloseDiscard,
  onDiscard,
  onCloseDelete,
  onDeleteMessageChange,
  onSubmitDelete,
}: FileActionSheetsProps) {
  const tokens = useTokens();

  return (
    <>
      <NativeBottomSheet
        visible={actionsVisible}
        title="File actions"
        description={openFile?.path}
        showCloseButton
        onClose={onCloseActions}
        footer={
          <NativeActionBar>
            <Button
              label="Propose delete"
              variant="destructive"
              disabled={saving || !openFile || openFile.loading}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={onProposeDelete}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={onCloseActions}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={discardVisible}
        title="Discard changes?"
        description="This closes the file editor and removes the unsaved content and message."
        showCloseButton
        onClose={onCloseDiscard}
        footer={
          <NativeActionBar>
            <Button
              label="Discard changes"
              variant="destructive"
              disabled={saving}
              fullWidth
              onPress={onDiscard}
            />
            <Button
              label="Keep editing"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={onCloseDiscard}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={deleteVisible}
        title="Delete file?"
        description={
          openFile
            ? `Create a delete change request for ${openFile.path}. The file changes only after review and merge.`
            : undefined
        }
        showCloseButton
        onClose={onCloseDelete}
        footer={
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError} onReset={onClearError} />
            ) : null}
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={saving}
              disabled={!openFile || openFile.loading}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={onSubmitDelete}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={saving}
              fullWidth
              onPress={onCloseDelete}
            />
          </NativeActionBar>
        }
      >
        {openFile ? (
          <View style={styles.sheetBody}>
            <TextInput
              label="Change request message"
              value={deleteMessage}
              placeholder={`Delete ${openFile.path}`}
              onChangeText={onDeleteMessageChange}
            />
          </View>
        ) : null}
      </NativeBottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  sheetBody: { paddingTop: 4 },
});
