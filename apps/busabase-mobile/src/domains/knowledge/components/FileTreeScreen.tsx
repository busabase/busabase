import { FilePlus2, Settings2 } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useFileTreeController } from "../hooks/use-file-tree-controller";
import type { FileTreeScreenProps } from "../types/file-tree";
import { getVisibilityLabel } from "../utils/file-tree";
import { FileActionSheets } from "./FileActionSheets";
import { FileEditorSheet } from "./FileEditorSheet";
import { FileTreeList } from "./FileTreeList";
import { FileTreeMetadataSheets } from "./FileTreeMetadataSheets";

export function FileTreeScreen({
  title,
  entityLabel,
  fileTree,
  loading,
  error,
  refreshing,
  onRefresh,
  onReadFile,
  onCreateChangeRequest,
  onChangeRequestCreated,
}: FileTreeScreenProps) {
  const tokens = useTokens();
  const controller = useFileTreeController({
    entityLabel,
    fileTree,
    onReadFile,
    onCreateChangeRequest,
    onChangeRequestCreated,
  });

  return (
    <DrawerScaffold
      title={fileTree?.node.name ?? title}
      titleNumberOfLines={2}
      subtitle={
        fileTree
          ? `${controller.itemSummary} · ${getVisibilityLabel(fileTree.visibility)}`
          : entityLabel
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
      headerAction={
        fileTree ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${entityLabel.toLowerCase()} settings`}
            hitSlop={mobile.hitSlop}
            style={[styles.settingsButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={controller.startMetadataEdit}
          >
            <Settings2 size={20} color={tokens.foreground} />
          </Pressable>
        ) : undefined
      }
      footer={
        fileTree ? (
          <NativeActionBar>
            <Button
              label="New file"
              variant="secondary"
              leadingIcon={<FilePlus2 size={18} color={tokens.foreground} />}
              fullWidth
              onPress={controller.startNewFile}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {loading ? <NativeLoadingState label={`Loading ${entityLabel.toLowerCase()}`} /> : null}
      {error ? <NativeErrorState message={error.message} onRetry={onRefresh} /> : null}
      {!loading && !error && !fileTree ? (
        <NativeEmptyState title={`${entityLabel} not found`} />
      ) : null}

      {fileTree ? (
        <>
          <FileTreeList
            currentFolder={controller.currentFolder}
            fileItems={controller.fileItems}
            totalFileCount={controller.files.length}
            visibleFiles={controller.visibleFiles}
            onOpenFile={(file) => void controller.openFileForPreview(file)}
            onOpenFolder={controller.openFolder}
          />
          {controller.actionError ? (
            <View style={styles.errorWrap}>
              <NativeInlineError
                message={controller.actionError}
                onReset={controller.clearActionError}
              />
            </View>
          ) : null}
        </>
      ) : null}

      <FileEditorSheet
        visible={
          (!!controller.openFile || !!controller.newFile) &&
          !controller.fileActionsOpen &&
          !controller.deleteConfirmOpen &&
          !controller.discardEditorOpen
        }
        openFile={controller.openFile}
        newFile={controller.newFile}
        mode={controller.fileEditorMode}
        saving={controller.saving}
        actionError={controller.actionError}
        message={controller.fileChangeMessage}
        messagePlaceholder={controller.fileEditorMessagePlaceholder}
        summary={controller.fileEditorSummary}
        onClose={controller.closeEditor}
        onClearError={controller.clearActionError}
        onMessageChange={controller.setFileChangeMessage}
        onPathChange={controller.updateNewFilePath}
        onContentChange={controller.updateFileContent}
        onCreate={controller.submitNewFile}
        onSave={controller.submitOpenFile}
        onEdit={controller.startEditingFile}
        onOpenActions={controller.openFileActions}
      />

      <FileActionSheets
        openFile={controller.openFile}
        saving={controller.saving}
        actionError={controller.actionError}
        actionsVisible={controller.fileActionsOpen}
        discardVisible={controller.discardEditorOpen}
        deleteVisible={controller.deleteConfirmOpen}
        deleteMessage={controller.deleteChangeMessage}
        onClearError={controller.clearActionError}
        onCloseActions={controller.closeFileActions}
        onProposeDelete={controller.proposeDelete}
        onCloseDiscard={() => controller.setDiscardEditorOpen(false)}
        onDiscard={controller.discardEditorChanges}
        onCloseDelete={controller.closeDeleteConfirmation}
        onDeleteMessageChange={controller.setDeleteChangeMessage}
        onSubmitDelete={controller.submitDeleteOpenFile}
      />

      <FileTreeMetadataSheets
        entityLabel={entityLabel}
        draft={controller.metadataDraft}
        saving={controller.saving}
        canSubmit={controller.canSubmitMetadata}
        actionError={controller.actionError}
        message={controller.metadataChangeMessage}
        messagePlaceholder={controller.metadataMessagePlaceholder}
        discardVisible={controller.discardMetadataOpen}
        onClose={controller.closeMetadataEditor}
        onClearError={controller.clearActionError}
        onMessageChange={controller.setMetadataChangeMessage}
        onVisibilityChange={controller.updateMetadataVisibility}
        onVersionChange={controller.updateMetadataVersion}
        onEntryFileChange={controller.updateMetadataEntryFile}
        onSubmit={controller.submitMetadataUpdate}
        onCloseDiscard={() => controller.setDiscardMetadataOpen(false)}
        onDiscard={controller.discardMetadataChanges}
      />
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  errorWrap: { marginHorizontal: 20, marginTop: 12 },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
