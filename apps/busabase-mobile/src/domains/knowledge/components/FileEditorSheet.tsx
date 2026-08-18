import { MoreHorizontal, Pencil } from "lucide-react-native";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { FileEditorMode, NewFileDraft, OpenFile } from "../types/file-tree";

interface FileEditorSheetProps {
  visible: boolean;
  openFile: OpenFile | null;
  newFile: NewFileDraft | null;
  mode: FileEditorMode;
  saving: boolean;
  actionError: string | null;
  message: string;
  messagePlaceholder: string;
  summary?: string;
  onClose: () => void;
  onClearError: () => void;
  onMessageChange: (value: string) => void;
  onPathChange: (path: string) => void;
  onContentChange: (content: string) => void;
  onCreate: () => void;
  onSave: () => void;
  onEdit: () => void;
  onOpenActions: () => void;
}

export function FileEditorSheet({
  visible,
  openFile,
  newFile,
  mode,
  saving,
  actionError,
  message,
  messagePlaceholder,
  summary,
  onClose,
  onClearError,
  onMessageChange,
  onPathChange,
  onContentChange,
  onCreate,
  onSave,
  onEdit,
  onOpenActions,
}: FileEditorSheetProps) {
  const tokens = useTokens();
  const fileReady = !openFile?.loading && !openFile?.error;

  return (
    <NativeBottomSheet
      visible={visible}
      title={newFile ? "New file" : openFile?.path}
      description={summary}
      maxHeight="86%"
      showCloseButton
      onClose={onClose}
      footer={
        fileReady ? (
          <NativeActionBar>
            {actionError ? (
              <NativeInlineError message={actionError} onReset={onClearError} />
            ) : null}
            {newFile ? (
              <Button
                label="Create change request"
                loading={saving}
                disabled={saving || newFile.path.trim().length === 0}
                fullWidth
                onPress={onCreate}
              />
            ) : mode === "edit" ? (
              <>
                <Button
                  label="Save as CR"
                  loading={saving}
                  disabled={saving || openFile?.content === openFile?.original}
                  fullWidth
                  onPress={onSave}
                />
                <FileActionsButton saving={saving} openFile={openFile} onPress={onOpenActions} />
              </>
            ) : (
              <>
                <Button
                  label="Edit file"
                  variant="secondary"
                  disabled={saving || !openFile || openFile.loading}
                  fullWidth
                  leadingIcon={<Pencil size={18} color={tokens.foreground} />}
                  onPress={onEdit}
                />
                <FileActionsButton saving={saving} openFile={openFile} onPress={onOpenActions} />
              </>
            )}
          </NativeActionBar>
        ) : undefined
      }
    >
      {openFile?.loading ? (
        <NativeLoadingState label="Reading file" />
      ) : openFile?.error ? (
        <NativeErrorState message={openFile.error} />
      ) : openFile && mode === "preview" && !newFile ? (
        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
          <View style={[styles.previewBody, { backgroundColor: tokens.muted }]}>
            <Text selectable style={[typography.body, styles.code, { color: tokens.foreground }]}>
              {openFile.content || "Empty file."}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>
          {newFile ? (
            <TextInput
              label="Path"
              value={newFile.path}
              placeholder="docs/example.md"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onPathChange}
            />
          ) : null}
          <TextInput
            label="Change request message"
            value={message}
            placeholder={messagePlaceholder}
            onChangeText={onMessageChange}
          />
          <TextInput
            label="Content"
            value={newFile ? newFile.content : (openFile?.content ?? "")}
            multiline
            textAlignVertical="top"
            style={[styles.code, styles.editor]}
            onChangeText={onContentChange}
          />
        </ScrollView>
      )}
    </NativeBottomSheet>
  );
}

interface FileActionsButtonProps {
  saving: boolean;
  openFile: OpenFile | null;
  onPress: () => void;
}

function FileActionsButton({ saving, openFile, onPress }: FileActionsButtonProps) {
  const tokens = useTokens();
  return (
    <Button
      label="File actions"
      variant="ghost"
      disabled={saving || !openFile || openFile.loading}
      fullWidth
      leadingIcon={<MoreHorizontal size={18} color={tokens.foreground} />}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  modalBody: { marginHorizontal: -2 },
  modalBodyContent: { paddingBottom: 12, gap: 12 },
  previewBody: {
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
    lineHeight: 19,
  },
  editor: { minHeight: 240, paddingTop: 12 },
});
